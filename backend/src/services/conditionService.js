const escrowRepository = require('../repositories/escrowRepository');
const conditionRepository = require('../repositories/conditionRepository');
const transactionRepository = require('../repositories/transactionRepository');
const { ValidationError, UnauthorizedError } = require('../utils/errors');
const { assertEscrowParticipantRole } = require('../domain/participantAuthorization');

const { conditionActorRole, satisfactionChanges, reviewChanges } = require('../domain/conditionWorkflow');
const { TYPES, validateCondition } = require('../domain/validateCondition');

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
  const actorRole = conditionActorRole(condition);
  const effectiveRole = ({ PAYER: 'CLIENT', PAYEE: 'PROVIDER', CLIENT: 'CLIENT', PROVIDER: 'PROVIDER' })[actorRole];
  if (effectiveRole) assertEscrowParticipantRole(escrow, actorId, [effectiveRole]);
  const actorIsParticipant = escrow.participants?.some(p => p.userId === actorId && p.role === actorRole)
    || (actorRole === 'PAYER' && actorId === escrow.payerId)
    || (actorRole === 'PAYEE' && actorId === escrow.payeeId);
  if (!actorIsParticipant) throw new UnauthorizedError(`Only an agreement participant with role ${actorRole || 'authorized actor'} may satisfy condition "${condition.title}" (${condition.type})`);
  return conditionRepository.updateCondition(conditionId, satisfactionChanges(condition, actorId, evidence));
}

function reviewWork(conditionId, actorId, decision, feedback = '') {
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = escrowRepository.getEscrowById(condition.escrowId);
  if (!['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(condition.type)) throw new ValidationError('Only provider-submitted work or evidence can be reviewed');
  if (!actorId || actorId !== escrow.payerId) throw new UnauthorizedError('Only the agreement creator may review submitted work or evidence');
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (escrow.disputed || ['DISPUTED', 'CANCELLED', 'EXPIRED', 'RELEASED'].includes(escrow.status)) throw new ValidationError('Blocked or completed escrow cannot review submissions');
  return conditionRepository.updateCondition(conditionId, reviewChanges(condition, actorId, decision, feedback));
}

function findUniqueByType(escrowId, type) {
  const matches = conditionRepository.getConditionsByEscrowId(escrowId).filter(condition => condition.type === type);
  if (matches.length !== 1) throw new ValidationError(matches.length ? 'Condition type is ambiguous; use the condition ID' : `Condition ${type} is not configured`);
  return matches[0];
}

module.exports = { TYPES, validateCondition, createForEscrow, createForActor, listForEscrow, updateForActor, deleteForActor, satisfy, reviewWork, findUniqueByType };
