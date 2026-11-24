// Escrow Service - Escrow lifecycle management
const escrowRepository = require('../repositories/escrowRepository');
const userRepository = require('../repositories/userRepository');
const { transition, STATES, ACTIONS } = require('../domain/escrowStateMachine');
const { ValidationError, NotFoundError, InvalidStateTransitionError } = require('../utils/errors');
const accountRepository = require('../repositories/accountRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const transactionService = require('./transactionService');
const conditionService = require('./conditionService');
const conditionRepository = require('../repositories/conditionRepository');
const { assertEscrowNotDisputed } = require('../domain/escrowGuards');
const { assertActorRole, assertEscrowParticipantRole } = require('../domain/participantAuthorization');

/**
 * Create a new escrow
 * @param {Object} escrowData - { title, description, clientId, freelancerId, totalAmount }
 * @returns {Object} Created escrow
 */
function createEscrow({ title, description, clientId, freelancerId, payerId, payeeId, totalAmount, releaseModel, conditions = [], deadline, agreementType, terms, metadata, participants = [], milestones = [] }) {
  if (!Array.isArray(participants)) throw new ValidationError('Participants must be an array');
  const payer = participants.find(p => ['PAYER', 'CLIENT'].includes(p.role));
  const payee = participants.find(p => ['PAYEE', 'PROVIDER'].includes(p.role));
  if (participants.length && (!payer || !payee)) throw new ValidationError('Participants must include PAYER and PAYEE roles');
  if (participants.length && ((clientId || payerId) && (clientId || payerId) !== payer.userId || (freelancerId || payeeId) && (freelancerId || payeeId) !== payee.userId)) throw new ValidationError('Participant roles conflict with payer/payee IDs');
  clientId = clientId || payerId || payer?.userId;
  freelancerId = freelancerId || payeeId || payee?.userId;
  // Validate both users exist
  const client = userRepository.getUserById(clientId);
  const provider = userRepository.getUserById(freelancerId);
  assertActorRole(clientId, ['CLIENT']);
  assertActorRole(freelancerId, ['PROVIDER']);
  
  if (!client || !provider) {
    throw new ValidationError('Agreement payer and payee must be existing users');
  }
  if (participants.some(p => !p.userId || !userRepository.getUserById(p.userId) || !p.role)) throw new ValidationError('Each agreement participant needs an existing user and a role');

  // Validate amount
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new ValidationError('Total amount must be greater than 0');
  }

  const normalizedModel = ({ 'Milestone Based': 'MILESTONE_BASED', 'Condition Based': 'CONDITION_BASED' })[releaseModel] || releaseModel || 'MILESTONE_BASED';
  if (!['MILESTONE_BASED', 'CONDITION_BASED'].includes(normalizedModel)) throw new ValidationError('Invalid release model');
  if (!Array.isArray(milestones)) throw new ValidationError('Milestones must be an array');
  if (normalizedModel === 'MILESTONE_BASED') {
    if (milestones.some(m => !Number.isFinite(m.amount) || m.amount <= 0 || !String(m.title || '').trim() || !String(m.description || '').trim())) throw new ValidationError('Every milestone needs a title, description, and positive amount');
    if (milestones.length && Math.abs(milestones.reduce((sum, m) => sum + m.amount, 0) - totalAmount) > 0.000001) throw new ValidationError('Milestone amounts must sum to the escrow total');
  } else {
    if (milestones.length) throw new ValidationError('Condition-based agreements do not use milestones');
    if (!Array.isArray(conditions)) throw new ValidationError('Conditions must be an array');
    const configured = deadline ? [...conditions, { type: 'DEADLINE_REACHED', title: 'Deadline reached', description: 'Configured deadline has passed.', config: { deadline } }] : conditions;
    conditions = configured.map(condition => conditionService.validateCondition(condition, { allowLegacy: true })).filter(Boolean);
    if (!conditions.length) throw new ValidationError('Configure at least one release condition');
  }

  const escrow = escrowRepository.createEscrow({
    title,
    description: description || '',
    clientId,
    freelancerId,
    totalAmount,
    status: STATES.CREATED, releaseModel: normalizedModel, releasePolicy: 'ALL_REQUIRED', payerId: clientId, payeeId: freelancerId,
    agreementType: agreementType || 'GENERAL', terms: terms || '', metadata: metadata || {}, participants: participants || []
  });
  if (normalizedModel === 'MILESTONE_BASED') milestones.forEach((m, index) => milestoneRepository.createMilestone({ escrowId: escrow.id, title: m.title || `Milestone ${index + 1}`, description: m.description || '', amount: m.amount, status: STATES.CREATED, order: index + 1 }));
  else conditions.forEach(condition => conditionRepository.createCondition({ escrowId: escrow.id, ...condition }));
  return { ...escrow, conditions: normalizedModel === 'CONDITION_BASED' ? conditionRepository.getConditionsByEscrowId(escrow.id) : [] };
}

function getReleaseEligibility(escrowId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Condition eligibility is only available for condition-based agreements');
  const conditions = conditionService.listForEscrow(escrowId);
  if (escrow.disputed || [STATES.DISPUTED, STATES.CANCELLED, STATES.EXPIRED].includes(escrow.status)) return { eligible: false, reason: 'Escrow is disputed, blocked, cancelled, or expired', conditions };
  if (escrow.status === STATES.RELEASED) return { eligible: false, reason: 'Funds have already been released', conditions };
  const unmet = conditions.filter(c => c.required && c.status !== 'SATISFIED');
  const funded = transactionService.getTransactionsByEscrow(escrowId).filter(t => t.type === 'FUND' && t.status === 'COMPLETED').reduce((sum, t) => sum + t.amount, 0);
  return { eligible: unmet.length === 0 && funded >= escrow.totalAmount, reason: unmet.length ? `Unmet conditions: ${unmet.map(c => c.type).join(', ')}` : funded < escrow.totalAmount ? 'Escrow is not fully funded' : null, conditions };
}

function satisfyCondition(escrowId, type, actorId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  const condition = conditionService.findUniqueByType(escrowId, type);
  conditionService.satisfy(condition.id, actorId);
  return getReleaseEligibility(escrowId);
}

function satisfyConditionById(conditionId, actorId, evidence) {
  const condition = conditionService.satisfy(conditionId, actorId, evidence);
  return { condition, eligibility: getReleaseEligibility(condition.escrowId) };
}

function reviewWorkCondition(conditionId, actorId, decision, feedback) {
  const condition = conditionService.reviewWork(conditionId, actorId, decision, feedback);
  return { condition, eligibility: getReleaseEligibility(condition.escrowId) };
}

function createCondition(escrowId, condition, actorId) { return conditionService.createForActor(escrowId, condition, actorId); }
function updateCondition(conditionId, updates, actorId) { return conditionService.updateForActor(conditionId, updates, actorId); }
function deleteCondition(conditionId, actorId) { return conditionService.deleteForActor(conditionId, actorId); }
function getConditions(escrowId) { return conditionService.listForEscrow(escrowId); }

function releaseConditionEscrow(escrowId, actorId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  assertEscrowNotDisputed(escrow, 'Condition-based release');
  if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Condition release is only available for condition-based agreements');
  if (actorId !== escrow.clientId) throw new (require('../utils/errors').UnauthorizedError)('Only the agreement client may release funds');
  const eligibility = getReleaseEligibility(escrowId);
  if (!eligibility.eligible) throw new ValidationError(eligibility.reason || 'Release conditions are not satisfied');
  const release = transactionService.createTransaction({ type: 'RELEASE', amount: escrow.totalAmount, escrowId, fromAccountId: accountRepository.getEscrowAccount().id, toAccountId: accountRepository.getAccountByUserId(escrow.freelancerId).id });
  escrowRepository.updateEscrow(escrowId, { status: STATES.RELEASED });
  return { transaction: release, escrow: escrowRepository.getEscrowById(escrowId) };
}

function raiseDispute(escrowId, actorId, reason = '') {
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT', 'PROVIDER']);
  if (![escrow.payerId, escrow.payeeId].includes(actorId)) throw new (require('../utils/errors').UnauthorizedError)('Only an agreement participant may raise a dispute');
  if ([STATES.RELEASED, STATES.CANCELLED, STATES.EXPIRED].includes(escrow.status)) throw new ValidationError('A completed or cancelled escrow cannot be disputed');
  if (escrow.disputed) throw new ValidationError('Escrow is already disputed');
  return escrowRepository.updateEscrow(escrowId, { statusBeforeDispute: escrow.status, status: STATES.DISPUTED, disputed: true, dispute: { reason, raisedBy: actorId, raisedAt: Date.now() } });
}

function resolveDispute(escrowId, actorId, resolution = '') {
  escrowRepository.getEscrowById(escrowId);
  throw new ValidationError('Disputes must be closed through the Admin dispute resolution workflow with financial allocation');
}

/**
 * Get escrow by ID
 * @param {string} escrowId
 * @returns {Object} Escrow
 */
function getEscrow(escrowId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  return { ...escrow, conditions: escrow.releaseModel === 'CONDITION_BASED' ? conditionService.listForEscrow(escrowId) : [] };
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
 * Get escrows assigned to a provider
 * @param {string} providerId
 * @returns {Array} Provider's escrows
 */
function getEscrowsByProvider(providerId) {
  return escrowRepository.getEscrowsByProviderId(providerId);
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
function fundEscrow(escrowId, milestoneId, actorId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['CLIENT']);
  if (!actorId || actorId !== escrow.clientId) throw new (require('../utils/errors').UnauthorizedError)('Only the agreement client may fund escrow');
  assertEscrowNotDisputed(escrow, 'Funding');
  if ([STATES.CANCELLED, STATES.EXPIRED].includes(escrow.status)) throw new ValidationError('Blocked escrow cannot be funded');
  if (escrow.releaseModel === 'CONDITION_BASED' && !milestoneId) {
    const alreadyFunded = transactionService.getTransactionsByEscrow(escrowId).filter(t => t.type === 'FUND' && t.status === 'COMPLETED').reduce((sum, t) => sum + t.amount, 0);
    const amount = escrow.totalAmount - alreadyFunded;
    if (amount <= 0) throw new ValidationError('Escrow is already fully funded');
    const result = transactionService.createTransaction({ type: 'FUND', amount, escrowId, fromAccountId: accountRepository.getAccountByUserId(escrow.clientId).id, toAccountId: accountRepository.getEscrowAccount().id });
    escrowRepository.updateEscrow(escrowId, { status: STATES.FUNDED });
    return { transaction: result, escrow: escrowRepository.getEscrowById(escrowId) };
  }
  if (!milestoneId) throw new ValidationError('milestoneId is required to fund an escrow milestone');
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  if (milestone.escrowId !== escrowId) throw new ValidationError('Milestone does not belong to this escrow');
  const milestones = milestoneRepository.getMilestonesByEscrowId(escrowId);
  if (Math.abs(milestones.reduce((sum, item) => sum + item.amount, 0) - escrow.totalAmount) > 0.000001) throw new ValidationError('Milestone amounts must sum to the escrow total before funding');
  if (milestone.amount > escrow.totalAmount) throw new ValidationError('Milestone amount exceeds escrow total');

  const clientAccount = accountRepository.getAccountByUserId(escrow.clientId);
  const escrowAccount = accountRepository.getEscrowAccount();
  const transaction = transactionService.createTransaction({
    type: 'FUND', amount: milestone.amount, escrowId, milestoneId,
    fromAccountId: clientAccount.id, toAccountId: escrowAccount.id
  });
  const updatedMilestone = milestoneRepository.updateMilestoneStatus(milestoneId, STATES.FUNDED);
  if (escrow.status === STATES.CREATED) escrowRepository.updateEscrow(escrowId, { status: STATES.FUNDED });
  return { transaction, milestone: updatedMilestone };
}

/** Start work on a funded milestone. */
function startEscrow(escrowId, milestoneId, actorId) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  assertEscrowParticipantRole(escrow, actorId, ['PROVIDER']);
  if (!actorId || actorId !== escrow.freelancerId) throw new (require('../utils/errors').UnauthorizedError)('Only the agreement provider may start work');
  if (!milestoneId) throw new ValidationError('milestoneId is required to start a milestone');
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  if (milestone.escrowId !== escrowId) throw new ValidationError('Milestone does not belong to this escrow');
  return require('./milestoneService').updateMilestoneStatus(milestoneId, ACTIONS.START, actorId);
}

module.exports = {
  createEscrow,
  getEscrow,
  getAllEscrows,
  getEscrowsByClient,
  getEscrowsByProvider,
  updateEscrowStatus,
  getValidEscrowActions,
  getReleaseEligibility,
  satisfyCondition,
  satisfyConditionById,
  reviewWorkCondition,
  createCondition,
  updateCondition,
  deleteCondition,
  getConditions,
  releaseConditionEscrow,
  raiseDispute,
  resolveDispute,
  fundEscrow,
  startEscrow,
  STATES,
  ACTIONS
};
