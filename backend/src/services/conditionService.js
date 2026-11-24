const escrowRepository = require('../repositories/escrowRepository');
const conditionRepository = require('../repositories/conditionRepository');
const transactionRepository = require('../repositories/transactionRepository');
const { ValidationError, UnauthorizedError } = require('../utils/errors');
const { assertEscrowParticipantRole } = require('../domain/participantAuthorization');

const TYPES = new Set([
  'CLIENT_APPROVAL', 'WORK_SUBMITTED', 'DEADLINE_REACHED', 'PARTICIPANT_APPROVAL',
  'EVIDENCE_SUBMITTED', 'DELIVERY_CONFIRMED', 'EXTERNAL_VERIFICATION', 'CUSTOM',
]);
const LEGACY_ALL = 'ALL_CONDITIONS_MET';

function validateCondition(input, { allowLegacy = false, requireText = false } = {}) {
  if (!input || typeof input !== 'object') throw new ValidationError('Condition details are required');
  if (allowLegacy && input.type === LEGACY_ALL) return null;
  if (!TYPES.has(input.type)) throw new ValidationError(`Unsupported condition type: ${input.type}`);
  const title = String(input.title || (requireText ? '' : input.type.replaceAll('_', ' '))).trim();
  const description = String(input.description || (requireText ? '' : `Satisfy the ${title.toLowerCase()} requirement.`)).trim();
  if (!title || !description) throw new ValidationError('Condition title and description are required');
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? { ...input.config } : {};
  // These condition types are provider submissions; store their intended role
  // explicitly as well as enforcing it in satisfy().
  if (['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(input.type)) config.actorRole = 'PAYEE';
  const required = input.required === undefined ? true : input.required;
  if (typeof required !== 'boolean') throw new ValidationError('Condition required must be true or false');
  if (input.type === 'DEADLINE_REACHED') {
    const deadline = config.deadline || input.deadline;
    if (!deadline || !Number.isFinite(Date.parse(deadline))) throw new ValidationError('DEADLINE_REACHED requires a valid deadline');
    config.deadline = new Date(deadline).toISOString();
  }
  if (input.type === 'EXTERNAL_VERIFICATION' && !String(config.verificationSource || '').trim()) throw new ValidationError('EXTERNAL_VERIFICATION requires a verificationSource');
  if (input.type === 'EVIDENCE_SUBMITTED' && !String(config.evidenceRequirement || '').trim()) throw new ValidationError('EVIDENCE_SUBMITTED requires an evidenceRequirement');
  if (input.type === 'EXTERNAL_VERIFICATION' && !String(config.verifierRole || '').trim()) throw new ValidationError('EXTERNAL_VERIFICATION requires a verifierRole');
  if (input.type === 'PARTICIPANT_APPROVAL' && !String(config.actorRole || '').trim()) throw new ValidationError('PARTICIPANT_APPROVAL requires an actorRole');
  if (input.type === 'CUSTOM' && !String(config.actorRole || '').trim()) throw new ValidationError('CUSTOM conditions require an actorRole');
  return { title, description, type: input.type, config, required };
}

function canEdit(escrow) {
  if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Conditions are only available for condition-based agreements');
  if (escrow.disputed || escrow.status !== 'CREATED' || transactionRepository.getTransactionsByEscrowId(escrow.id).some(t => t.type === 'FUND' && t.status === 'COMPLETED')) {
    throw new ValidationError('Release conditions cannot be changed after funding or while the escrow is blocked');
  }
}

function authorizePayer(escrow, actorId) {
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (!actorId || actorId !== escrow.payerId) throw new UnauthorizedError('Only the agreement payer may manage release conditions');
}

function createForEscrow(escrowId, inputs) {
  const normalized = inputs.map(input => validateCondition(input, { allowLegacy: true })).filter(Boolean);
  if (!normalized.length) throw new ValidationError('Configure at least one release condition');
  return normalized.map(condition => conditionRepository.createCondition({ escrowId, ...condition }));
}

function listForEscrow(escrowId) {
  escrowRepository.getEscrowById(escrowId);
  return evaluateDeadlines(conditionRepository.getConditionsByEscrowId(escrowId));
}

function evaluateDeadlines(conditions) {
  const now = Date.now();
  return conditions.map(condition => {
    if (condition.type === 'DEADLINE_REACHED' && condition.status === 'PENDING' && Date.parse(condition.config.deadline) <= now) {
      return conditionRepository.updateCondition(condition.id, { status: 'SATISFIED', satisfiedAt: Date.parse(condition.config.deadline), satisfiedBy: 'SYSTEM', verificationDetails: { source: 'deadline' } });
    }
    return condition;
  });
}

function createForActor(escrowId, input, actorId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  authorizePayer(escrow, actorId);
  canEdit(escrow);
  const condition = validateCondition(input, { requireText: true });
  return conditionRepository.createCondition({ escrowId, ...condition });
}

function updateForActor(conditionId, updates, actorId) {
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = escrowRepository.getEscrowById(condition.escrowId);
  authorizePayer(escrow, actorId);
  canEdit(escrow);
  const normalized = validateCondition({ ...condition, ...updates, config: { ...condition.config, ...(updates.config || {}) } }, { requireText: true });
  return conditionRepository.updateCondition(conditionId, normalized);
}

function deleteForActor(conditionId, actorId) {
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = escrowRepository.getEscrowById(condition.escrowId);
  authorizePayer(escrow, actorId);
  canEdit(escrow);
  const others = conditionRepository.getConditionsByEscrowId(escrow.id).filter(item => item.id !== conditionId);
  if (!others.length) throw new ValidationError('An agreement must have at least one release condition');
  conditionRepository.deleteCondition(conditionId);
  return { deleted: true, id: conditionId };
}

function satisfy(conditionId, actorId, evidence) {
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = escrowRepository.getEscrowById(condition.escrowId);
  if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Conditions are only available for condition-based agreements');
  if (escrow.disputed || ['DISPUTED', 'CANCELLED', 'EXPIRED', 'RELEASED'].includes(escrow.status)) throw new ValidationError('Blocked or completed escrow cannot satisfy conditions');
  if (!transactionRepository.getTransactionsByEscrowId(escrow.id).some(t => t.type === 'FUND' && t.status === 'COMPLETED')) throw new ValidationError('Fund the escrow before satisfying release conditions');
  if (condition.status === 'SATISFIED') return condition;
  if (condition.type === 'DEADLINE_REACHED') throw new UnauthorizedError('Deadline conditions are evaluated by the system');
  const defaultRole = {
    CLIENT_APPROVAL: 'PAYER', PARTICIPANT_APPROVAL: 'PAYER', DELIVERY_CONFIRMED: 'PAYER',
    WORK_SUBMITTED: 'PAYEE', EVIDENCE_SUBMITTED: 'PAYEE',
    EXTERNAL_VERIFICATION: condition.config.verifierRole,
  }[condition.type];
  // Work and evidence submissions belong to the provider even if stale/custom
  // condition configuration says otherwise. The client reviews work separately.
  const actorRole = ['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(condition.type)
    ? 'PAYEE'
    : condition.config.actorRole || defaultRole;
  const effectiveRole = ({ PAYER: 'CLIENT', PAYEE: 'PROVIDER', CLIENT: 'CLIENT', PROVIDER: 'PROVIDER' })[actorRole];
  if (effectiveRole) assertEscrowParticipantRole(escrow, actorId, [effectiveRole]);
  const actorIsParticipant = escrow.participants?.some(p => p.userId === actorId && p.role === actorRole)
    || (actorRole === 'PAYER' && actorId === escrow.payerId)
    || (actorRole === 'PAYEE' && actorId === escrow.payeeId);
  if (!actorIsParticipant) throw new UnauthorizedError(`Only an agreement participant with role ${actorRole || 'authorized actor'} may satisfy condition "${condition.title}" (${condition.type})`);
  if ((['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED', 'EXTERNAL_VERIFICATION'].includes(condition.type) || condition.config.evidenceRequired) && !String(evidence || '').trim()) throw new ValidationError('Evidence or verification details are required to satisfy this condition');
  if (['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(condition.type)) {
    if (!['PENDING', 'REJECTED'].includes(condition.status)) throw new ValidationError('Submission is already awaiting creator review');
    return conditionRepository.updateCondition(conditionId, {
      status: 'SUBMITTED', submittedAt: Date.now(), submittedBy: actorId,
      verificationDetails: { evidence: String(evidence).trim() },
    });
  }
  return conditionRepository.updateCondition(conditionId, {
    status: 'SATISFIED', satisfiedAt: Date.now(), satisfiedBy: actorId,
    verificationDetails: evidence ? { evidence: String(evidence).trim() } : { source: 'participant_action' },
  });
}

function reviewWork(conditionId, actorId, decision, feedback = '') {
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = escrowRepository.getEscrowById(condition.escrowId);
  if (!['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(condition.type)) throw new ValidationError('Only provider-submitted work or evidence can be reviewed');
  if (!actorId || actorId !== escrow.payerId) throw new UnauthorizedError('Only the agreement creator may review submitted work or evidence');
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (escrow.disputed || ['DISPUTED', 'CANCELLED', 'EXPIRED', 'RELEASED'].includes(escrow.status)) throw new ValidationError('Blocked or completed escrow cannot review submissions');
  if (condition.status !== 'SUBMITTED') throw new ValidationError('Work or evidence must be submitted before the creator can review it');
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new ValidationError('Review decision must be APPROVE or REJECT');
  if (decision === 'REJECT' && !feedback.trim()) throw new ValidationError('Provide feedback explaining why the submission was rejected');
  const details = { ...(condition.verificationDetails || {}), reviewedBy: actorId, reviewedAt: Date.now() };
  if (feedback.trim()) details.reviewFeedback = feedback.trim();
  return conditionRepository.updateCondition(conditionId, {
    status: decision === 'APPROVE' ? 'SATISFIED' : 'REJECTED',
    ...(decision === 'APPROVE' ? { satisfiedAt: Date.now(), satisfiedBy: actorId } : { satisfiedAt: null, satisfiedBy: null }),
    verificationDetails: details,
  });
}

function findUniqueByType(escrowId, type) {
  const matches = conditionRepository.getConditionsByEscrowId(escrowId).filter(condition => condition.type === type);
  if (matches.length !== 1) throw new ValidationError(matches.length ? 'Condition type is ambiguous; use the condition ID' : `Condition ${type} is not configured`);
  return matches[0];
}

module.exports = { TYPES, validateCondition, createForEscrow, createForActor, listForEscrow, updateForActor, deleteForActor, satisfy, reviewWork, findUniqueByType };
