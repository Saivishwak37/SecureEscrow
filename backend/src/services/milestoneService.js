// Milestone Service - Milestone lifecycle management with state machine enforcement
const milestoneRepository = require('../repositories/milestoneRepository');
const escrowRepository = require('../repositories/escrowRepository');
const { transition, STATES, ACTIONS } = require('../domain/escrowStateMachine');
const { ValidationError, NotFoundError, InvalidStateTransitionError } = require('../utils/errors');
const accountRepository = require('../repositories/accountRepository');
const transactionService = require('./transactionService');

/**
 * Create a new milestone
 * @param {Object} milestoneData - { escrowId, title, description, amount }
 * @returns {Object} Created milestone
 */
function createMilestone({ escrowId, title, description, amount }) {
  // Verify escrow exists
  const escrow = escrowRepository.getEscrowById(escrowId);
  
  // Validate amount
  if (!amount || amount <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  // Get current milestone count for order
  const existingMilestones = milestoneRepository.getMilestonesByEscrowId(escrowId);
  const order = existingMilestones.length + 1;

  return milestoneRepository.createMilestone({
    escrowId,
    title,
    description: description || '',
    amount,
    status: STATES.CREATED,
    order
  });
}

/**
 * Get milestone by ID
 * @param {string} milestoneId
 * @returns {Object} Milestone
 */
function getMilestone(milestoneId) {
  return milestoneRepository.getMilestoneById(milestoneId);
}

/**
 * Get all milestones for an escrow
 * @param {string} escrowId
 * @returns {Array} Milestones sorted by order
 */
function getMilestonesByEscrow(escrowId) {
  return milestoneRepository.getMilestonesByEscrowId(escrowId);
}

/**
 * Update milestone status using state machine
 * @param {string} milestoneId
 * @param {string} action - Action to perform
 * @returns {Object} Updated milestone
 */
function updateMilestoneStatus(milestoneId, action) {
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  
  try {
    const newStatus = transition(milestone.status, action);
    return milestoneRepository.updateMilestoneStatus(milestoneId, newStatus);
  } catch (error) {
    if (error instanceof InvalidStateTransitionError) {
      throw error;
    }
    throw new ValidationError(`Failed to update milestone status: ${error.message}`);
  }
}

/**
 * Get valid actions for current milestone status
 * @param {string} milestoneId
 * @returns {Array} Valid actions
 */
function getValidMilestoneActions(milestoneId) {
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  const { getValidActions } = require('../domain/escrowStateMachine');
  return getValidActions(milestone.status);
}

/** Approve-and-release financial operation for a milestone. */
function releaseMilestone(milestoneId) {
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  const escrow = escrowRepository.getEscrowById(milestone.escrowId);
  const approvedStatus = transition(milestone.status, ACTIONS.RELEASE);
  const escrowAccount = accountRepository.getEscrowAccount();
  const freelancerAccount = accountRepository.getAccountByUserId(escrow.freelancerId);
  const transaction = transactionService.createTransaction({
    type: 'RELEASE', amount: milestone.amount, escrowId: escrow.id, milestoneId,
    fromAccountId: escrowAccount.id, toAccountId: freelancerAccount.id
  });
  const updatedMilestone = milestoneRepository.updateMilestoneStatus(milestoneId, approvedStatus);
  return { transaction, milestone: updatedMilestone };
}

module.exports = {
  createMilestone,
  getMilestone,
  getMilestonesByEscrow,
  updateMilestoneStatus,
  getValidMilestoneActions,
  releaseMilestone,
  STATES,
  ACTIONS
};
