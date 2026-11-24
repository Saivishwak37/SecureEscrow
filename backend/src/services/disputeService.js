const escrowRepository = require('../repositories/escrowRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const disputeRepository = require('../repositories/disputeRepository');
const disputeStatusHistoryRepository = require('../repositories/disputeStatusHistoryRepository');
const { getStore } = require('../data/store');
const { ValidationError, UnauthorizedError, BaseError } = require('../utils/errors');
const { assertEscrowParticipantRole } = require('../domain/participantAuthorization');

const CATEGORIES = new Set([
  'NON_DELIVERY', 'INCOMPLETE_DELIVERY', 'QUALITY_ISSUE', 'PAYMENT_ISSUE',
  'CONDITION_NOT_FULFILLED', 'AGREEMENT_VIOLATION', 'OTHER',
]);
const REQUESTED_RESOLUTIONS = new Set([
  'RELEASE_TO_PROVIDER', 'REFUND_TO_CLIENT', 'PARTIAL_RELEASE', 'SPLIT_FUNDS', 'OTHER',
]);

class DuplicateActiveDisputeError extends BaseError {
  constructor(escrowId) {
    super('An active dispute already exists for this escrow', 409, 'DUPLICATE_ACTIVE_DISPUTE', { escrowId });
  }
}

function validateMilestoneReference(id, escrowId) {
  if (id === undefined || id === null || id === '') return null;
  if (typeof id !== 'string') throw new ValidationError('milestoneId must be a string');
  const related = milestoneRepository.getMilestoneById(id);
  if (related.escrowId !== escrowId) throw new ValidationError('milestoneId must belong to the specified escrow');
  return id;
}

function createDispute(escrowId, actorId, input = {}) {
  if (!actorId || typeof actorId !== 'string') throw new UnauthorizedError('A participant identity is required');
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT', 'PROVIDER']);
  const participantIds = escrow.participants?.length
    ? escrow.participants.filter(item => ['PAYER', 'PAYEE', 'CLIENT', 'PROVIDER'].includes(item.role)).map(item => item.userId)
    : [escrow.payerId || escrow.clientId, escrow.payeeId || escrow.freelancerId];
  const participant = participantIds.includes(actorId);
  if (!participant) throw new UnauthorizedError('Only an escrow participant may raise a dispute');

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const reason = typeof input.description === 'string' ? input.description.trim() : '';
  if (!title) throw new ValidationError('Dispute title is required');
  if (!reason) throw new ValidationError('Dispute description is required');
  if (!CATEGORIES.has(input.category)) throw new ValidationError('A valid dispute category is required');
  if (!REQUESTED_RESOLUTIONS.has(input.requestedResolution)) throw new ValidationError('A valid requested resolution is required');
  if (title.length > 160) throw new ValidationError('Dispute title must be 160 characters or fewer');

  const milestoneId = validateMilestoneReference(input.milestoneId, escrowId);
  if (disputeRepository.getDisputesByEscrowId(escrowId).some(dispute => dispute.status === 'OPEN')) {
    throw new DuplicateActiveDisputeError(escrowId);
  }
  if (escrow.status === 'DISPUTED' || escrow.disputed) {
    throw new ValidationError('Escrow is marked DISPUTED without an active dispute; resolve the inconsistent state before creating another dispute');
  }
  if (['RELEASED', 'CANCELLED', 'EXPIRED'].includes(escrow.status)) {
    throw new ValidationError('A released, cancelled, or expired escrow cannot be disputed');
  }

  const dispute = disputeRepository.createDispute({ escrowId, milestoneId, raisedBy: actorId, title, category: input.category, reason, requestedResolution: input.requestedResolution });
  let statusHistory;
  try {
    escrowRepository.freezeEscrowForDispute(escrowId, actorId, `Dispute opened: ${title}`);
    statusHistory = disputeStatusHistoryRepository.createHistory({ disputeId: dispute.id, changedBy: actorId, fromStatus: null, toStatus: 'OPEN', reason: 'Dispute created', eventType: 'STATUS_TRANSITION' });
    return dispute;
  } catch (error) {
    disputeRepository.deleteDispute(dispute.id);
    if (statusHistory) getStore().delete('disputeStatusHistory', statusHistory.id);
    const currentEscrow = getStore().findById('escrows', escrowId);
    if (currentEscrow?.status === 'DISPUTED') {
      try { getStore().update('escrows', escrowId, { status: escrow.status, disputed: escrow.disputed, statusBeforeDispute: escrow.statusBeforeDispute ?? null }); } catch { /* retain the original failure */ }
    }
    throw error;
  }
}

function getDisputesByEscrow(escrowId) {
  escrowRepository.getEscrowById(escrowId);
  return disputeRepository.getDisputesByEscrowId(escrowId);
}

module.exports = { createDispute, getDisputesByEscrow, CATEGORIES, REQUESTED_RESOLUTIONS };
