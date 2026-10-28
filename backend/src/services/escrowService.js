// Escrow Service - Escrow lifecycle management
const escrowRepository = require('../repositories/escrowRepository');
const userRepository = require('../repositories/userRepository');
const { transition, STATES, ACTIONS } = require('../domain/escrowStateMachine');
const { ValidationError, NotFoundError, InvalidStateTransitionError } = require('../utils/errors');
const accountRepository = require('../repositories/accountRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const transactionService = require('./transactionService');

/**
 * Create a new escrow
 * @param {Object} escrowData - { title, description, clientId, freelancerId, totalAmount }
 * @returns {Object} Created escrow
 */
function createEscrow({ title, description, clientId, freelancerId, totalAmount }) {
  // Validate both users exist
  const client = userRepository.getUserById(clientId);
  const freelancer = userRepository.getUserById(freelancerId);
  
  if (!client || !freelancer) {
    throw new ValidationError('Both client and freelancer must exist');
  }

  // Validate amount
  if (!totalAmount || totalAmount <= 0) {
    throw new ValidationError('Total amount must be greater than 0');
  }

  return escrowRepository.createEscrow({
    title,
    description: description || '',
    clientId,
    freelancerId,
    totalAmount,
    status: STATES.CREATED
  });
}

/**
 * Get escrow by ID
 * @param {string} escrowId
 * @returns {Object} Escrow
 */
function getEscrow(escrowId) {
  return escrowRepository.getEscrowById(escrowId);
}

/**
 * Get all escrows
 * @returns {Array} All escrows
 */
function getAllEscrows() {
  return escrowRepository.getAllEscrows();
}

/**
 * Get escrows by client
 * @param {string} clientId
 * @returns {Array} Client's escrows
 */
function getEscrowsByClient(clientId) {
  return escrowRepository.getEscrowsByClientId(clientId);
}

/**
 * Get escrows by freelancer
 * @param {string} freelancerId
 * @returns {Array} Freelancer's escrows
 */
function getEscrowsByFreelancer(freelancerId) {
  return escrowRepository.getEscrowsByFreelancerId(freelancerId);
}

/**
 * Update escrow status using state machine
 * @param {string} escrowId
 * @param {string} action - Action to perform (e.g., 'FUND', 'START', 'CANCEL')
 * @returns {Object} Updated escrow
 */
function updateEscrowStatus(escrowId, action) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  
  try {
    const newStatus = transition(escrow.status, action);
    return escrowRepository.updateEscrowStatus(escrowId, newStatus);
  } catch (error) {
    if (error instanceof InvalidStateTransitionError) {
      throw error;
    }
    throw new ValidationError(`Failed to update escrow status: ${error.message}`);
  }
}

/**
 * Get valid actions for current escrow status
 * @param {string} escrowId
 * @returns {Array} Valid actions
 */
function getValidEscrowActions(escrowId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  const { getValidActions } = require('../domain/escrowStateMachine');
  return getValidActions(escrow.status);
}

/** Fund a milestone from the escrow's client account into the escrow account. */
function fundEscrow(escrowId, milestoneId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (!milestoneId) throw new ValidationError('milestoneId is required to fund an escrow milestone');
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  if (milestone.escrowId !== escrowId) throw new ValidationError('Milestone does not belong to this escrow');
  if (milestone.amount > escrow.totalAmount) throw new ValidationError('Milestone amount exceeds escrow total');

  const clientAccount = accountRepository.getAccountByUserId(escrow.clientId);
  const escrowAccount = accountRepository.getEscrowAccount();
  const transaction = transactionService.createTransaction({
    type: 'FUND', amount: milestone.amount, escrowId, milestoneId,
    fromAccountId: clientAccount.id, toAccountId: escrowAccount.id
  });
  const updatedMilestone = milestoneRepository.updateMilestoneStatus(milestoneId, STATES.FUNDED);
  return { transaction, milestone: updatedMilestone };
}

/** Start work on a funded milestone. */
function startEscrow(escrowId, milestoneId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (!milestoneId) throw new ValidationError('milestoneId is required to start a milestone');
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  if (milestone.escrowId !== escrowId) throw new ValidationError('Milestone does not belong to this escrow');
  const newStatus = transition(milestone.status, ACTIONS.START);
  return milestoneRepository.updateMilestoneStatus(milestoneId, newStatus);
}

module.exports = {
  createEscrow,
  getEscrow,
  getAllEscrows,
  getEscrowsByClient,
  getEscrowsByFreelancer,
  updateEscrowStatus,
  getValidEscrowActions,
  fundEscrow,
  startEscrow,
  STATES,
  ACTIONS
};
