// Milestone Service - Milestone lifecycle management with state machine enforcement
const milestoneRepository = require('../repositories/milestoneRepository');
const escrowRepository = require('../repositories/escrowRepository');
const { transition, STATES, ACTIONS } = require('../domain/escrowStateMachine');
const { ValidationError, NotFoundError, InvalidStateTransitionError } = require('../utils/errors');
const accountRepository = require('../repositories/accountRepository');
const transactionService = require('./transactionService');
const { assertEscrowNotDisputed } = require('../domain/escrowGuards');
const { assertEscrowParticipantRole } = require('../domain/participantAuthorization');

function syncEscrowStatus(escrowId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (escrow.disputed || escrow.status === STATES.DISPUTED) return escrow;
  const milestones = milestoneRepository.getMilestonesByEscrowId(escrowId);
  const terminalStatuses = [STATES.RELEASED, STATES.CANCELLED, STATES.RESOLVED];
  const next = milestones.find(m => !terminalStatuses.includes(m.status));
  const status = next ? next.status
    : milestones.every(m => m.status === STATES.RELEASED) ? STATES.RELEASED
      : milestones.every(m => m.status === STATES.CANCELLED) ? STATES.CANCELLED : STATES.RESOLVED;
  escrowRepository.updateEscrow(escrowId, { status });
}

/**
 * Create a new milestone
 * @param {Object} milestoneData - { escrowId, title, description, amount }
 * @returns {Object} Created milestone
 */
function createMilestone({ escrowId, title, description, amount, actorId }) {
  // Verify escrow exists
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (escrow.releaseModel === 'CONDITION_BASED') throw new ValidationError('Condition-based agreements cannot have milestones');
  
  // Validate amount
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }
  if (!String(title || '').trim() || !String(description || '').trim()) throw new ValidationError('Milestone title and description are required');

  // Get current milestone count for order
  const existingMilestones = milestoneRepository.getMilestonesByEscrowId(escrowId);
  if (existingMilestones.reduce((sum, milestone) => sum + milestone.amount, 0) + amount > escrow.totalAmount) throw new ValidationError('Milestone allocations cannot exceed the agreement amount');
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
function updateMilestoneStatus(milestoneId, action, actorId, submission = {}) {
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  const escrow = escrowRepository.getEscrowById(milestone.escrowId);
  const actorForAction = { START: escrow.freelancerId, SUBMIT: escrow.freelancerId, REVIEW: escrow.clientId, APPROVE: escrow.clientId, REJECT: escrow.clientId }[action];
  const actorRole = ['START', 'SUBMIT'].includes(action) ? 'PROVIDER' : 'CLIENT';
  assertEscrowParticipantRole(escrow, actorId, [actorRole]);
  if (!actorForAction || actorId !== actorForAction) throw new (require('../utils/errors').UnauthorizedError)('This participant is not authorized for the requested milestone action');
  if (escrow.disputed || [STATES.DISPUTED, STATES.CANCELLED, STATES.EXPIRED].includes(escrow.status)) throw new ValidationError('Blocked escrow cannot change milestone status');
  
  try {
    const newStatus = transition(milestone.status, action);
    const updates = { status: newStatus };
    if (action === ACTIONS.SUBMIT) {
      const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
      if (!attachments.length) throw new ValidationError('Attach at least one file with your submission');
      if (attachments.length > 5) throw new ValidationError('You can attach up to 5 files per submission');
      const normalized = attachments.map(file => {
        if (!file || typeof file.name !== 'string' || typeof file.data !== 'string' || typeof file.type !== 'string') throw new ValidationError('Each attachment must include a name, type, and file data');
        if (!file.data.startsWith('data:')) throw new ValidationError('Attachment data is invalid');
        if (file.data.length > 7_000_000) throw new ValidationError('Each file must be 5 MB or smaller');
        return { name: file.name.slice(0, 255), type: file.type || 'application/octet-stream', data: file.data };
      });
      if (normalized.reduce((total, file) => total + file.data.length, 0) > 9_000_000) throw new ValidationError('The combined submission files must be smaller than 7 MB');
      updates.submissions = [...(milestone.submissions || []), { attachments: normalized, submittedAt: Date.now(), submittedBy: actorId }];
      updates.reviewFeedback = null;
    }
    if (action === ACTIONS.REJECT) {
      updates.reviewFeedback = String(submission.feedback || '').trim();
      if (!updates.reviewFeedback) throw new ValidationError('Provide feedback explaining what the provider should revise');
    }
    const updated = milestoneRepository.updateMilestone(milestoneId, updates);
    syncEscrowStatus(escrow.id);
    return updated;
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
function releaseMilestone(milestoneId, actorId) {
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  const escrow = escrowRepository.getEscrowById(milestone.escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (actorId !== escrow.clientId) throw new (require('../utils/errors').UnauthorizedError)('Only the agreement client may release milestone funds');
  assertEscrowNotDisputed(escrow, 'Milestone release');
  if ([STATES.CANCELLED, STATES.EXPIRED].includes(escrow.status)) throw new ValidationError('Blocked escrow cannot release funds');
  if (milestone.status !== STATES.APPROVED) throw new InvalidStateTransitionError(milestone.status, ACTIONS.RELEASE, [STATES.APPROVED]);
  const approvedStatus = transition(milestone.status, ACTIONS.RELEASE);
  const escrowAccount = accountRepository.getEscrowAccount();
  const providerAccount = accountRepository.getAccountByUserId(escrow.freelancerId);
  const transaction = transactionService.createTransaction({
    type: 'RELEASE', amount: milestone.amount, escrowId: escrow.id, milestoneId,
    fromAccountId: escrowAccount.id, toAccountId: providerAccount.id
  });
  const updatedMilestone = milestoneRepository.updateMilestoneStatus(milestoneId, approvedStatus);
  syncEscrowStatus(escrow.id);
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
