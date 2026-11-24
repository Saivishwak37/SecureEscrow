const { getStore } = require('../data/store');
const accountRepository = require('../repositories/accountRepository');
const disputeRepository = require('../repositories/disputeRepository');
const resolutionRepository = require('../repositories/disputeResolutionRepository');
const historyRepository = require('../repositories/disputeStatusHistoryRepository');
const transactionRepository = require('../repositories/transactionRepository');
const escrowStatusHistoryRepository = require('../repositories/escrowStatusHistoryRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const transactionService = require('./transactionService');
const { ValidationError, UnauthorizedError } = require('../utils/errors');

const DECISIONS = new Set(['RELEASE_TO_PROVIDER', 'REFUND_TO_CLIENT', 'SPLIT_FUNDS', 'PARTIAL_RELEASE']);
const COLLECTIONS = ['users', 'accounts', 'escrows', 'milestones', 'conditions', 'transactions', 'ledgerEntries', 'disputes', 'disputeEvidence', 'disputeMessages', 'disputeResolutions', 'disputeResolutionAllocations', 'disputeStatusHistory', 'escrowStatusHistory'];

function snapshotStore(store) {
  return Object.fromEntries(COLLECTIONS.map(key => [key, JSON.parse(JSON.stringify(store[key]))]));
}
function restoreStore(store, snapshot) { for (const key of COLLECTIONS) store[key] = snapshot[key]; }
function assertAdmin(actorId) {
  const user = getStore().findById('users', actorId);
  if (!user || user.isActive === false || (user.role || user.type) !== 'ADMIN') throw new UnauthorizedError('Only an admin may manage dispute resolution');
  return user;
}
function currentAvailable(escrowId, milestoneId = null) {
  const transactions = transactionRepository.getTransactionsByEscrowId(escrowId)
    .filter(tx => tx.status === 'COMPLETED' && (milestoneId ? tx.milestoneId === milestoneId : true));
  const funded = transactions.filter(tx => tx.type === 'FUND').reduce((sum, tx) => sum + tx.amount, 0);
  const paid = transactions.filter(tx => ['RELEASE', 'REFUND'].includes(tx.type)).reduce((sum, tx) => sum + tx.amount, 0);
  return Math.round((funded - paid) * 1e8) / 1e8;
}
function validateAccounts(escrow) {
  const clientId = escrow.payerId || escrow.clientId;
  const providerId = escrow.payeeId || escrow.freelancerId;
  const participants = escrow.participants || [];
  if (!participants.some(person => person.userId === clientId && ['PAYER', 'CLIENT'].includes(person.role))
    || !participants.some(person => person.userId === providerId && ['PAYEE', 'PROVIDER'].includes(person.role))) {
    throw new ValidationError('Escrow must identify its Client and Provider participants');
  }
  const clientAccount = accountRepository.getAccountByUserId(clientId);
  const providerAccount = accountRepository.getAccountByUserId(providerId);
  const escrowAccount = accountRepository.getEscrowAccount();
  if (!clientAccount || !providerAccount || !escrowAccount) throw new ValidationError('Client, Provider, and escrow accounts must exist');
  if (clientAccount.userId !== clientId || providerAccount.userId !== providerId) throw new ValidationError('Recipient accounts must belong to escrow participants');
  if (clientAccount.type !== 'PERSONAL' || providerAccount.type !== 'PERSONAL' || escrowAccount.type !== 'ESCROW') throw new ValidationError('Resolution account types are invalid');
  if ([clientAccount, providerAccount].some(account => account.currency !== escrowAccount.currency)) throw new ValidationError('Resolution account currencies must match');
  if ([clientAccount, providerAccount, escrowAccount].some(account => account.status === 'INACTIVE')) throw new ValidationError('Resolution accounts must be active');
  return { clientAccount, providerAccount, escrowAccount };
}

function executeResolution(disputeId, input = {}) {
  assertAdmin(input.actorId);
  const dispute = disputeRepository.getDisputeById(disputeId);
  const store = getStore();
  const escrow = require('../repositories/escrowRepository').getEscrowById(dispute.escrowId);
  const { decision, reasoning, idempotencyKey } = input;
  const resolutionMilestoneId = dispute.milestoneId || null;
  if (input.milestoneId !== undefined && (input.milestoneId || null) !== resolutionMilestoneId) {
    throw new ValidationError('Resolution scope is fixed by the scope selected when the dispute was raised');
  }
  if (resolutionMilestoneId) {
    const scopedMilestone = milestoneRepository.getMilestoneById(resolutionMilestoneId);
    if (scopedMilestone.escrowId !== escrow.id) throw new ValidationError('Resolution milestone must belong to the disputed escrow');
  }
  if (!DECISIONS.has(decision)) throw new ValidationError('A supported resolution decision is required');
  if (typeof reasoning !== 'string' || !reasoning.trim() || reasoning.trim().length > 4000) throw new ValidationError('Reasoning is required and must be 4000 characters or fewer');
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new ValidationError('A unique idempotencyKey is required');
  const requestShape = JSON.stringify({ decision, reasoning: reasoning.trim(), providerAmount: input.providerAmount ?? null, clientAmount: input.clientAmount ?? null, milestoneId: resolutionMilestoneId });
  const prior = resolutionRepository.getResolutionByIdempotencyKey(disputeId, idempotencyKey);
  if (prior) {
    if (prior.resolvedBy !== input.actorId) throw new UnauthorizedError('Idempotency key belongs to another admin request');
    if (prior.requestShape !== requestShape) throw new ValidationError('Idempotency key was already used with different resolution details');
    return { ...prior, allocations: resolutionRepository.getAllocationsByResolutionId(prior.id), transactions: prior.transactionIds.map(id => transactionRepository.getTransactionById(id)), replayed: true };
  }
  if (dispute.status === 'RESOLVED' || !['OPEN', 'EVIDENCE_SUBMISSION', 'UNDER_REVIEW'].includes(dispute.status)) throw new ValidationError('Dispute is not eligible for resolution');
  if (!escrow.disputed || escrow.status !== 'DISPUTED') throw new ValidationError('The associated escrow must be DISPUTED');
  const { clientAccount, providerAccount, escrowAccount } = validateAccounts(escrow);
  const available = currentAvailable(escrow.id, resolutionMilestoneId);
  if (available <= 0 || escrowAccount.balance < available) throw new ValidationError('Escrow has insufficient available funds');

  let allocations;
  if (decision === 'RELEASE_TO_PROVIDER') allocations = [{ recipient: providerAccount, amount: available, type: 'RELEASE' }];
  else if (decision === 'REFUND_TO_CLIENT') allocations = [{ recipient: clientAccount, amount: available, type: 'REFUND' }];
  else if (decision === 'SPLIT_FUNDS') {
    const providerAmount = input.providerAmount;
    const clientAmount = input.clientAmount;
    if (!Number.isFinite(providerAmount) || providerAmount <= 0 || !Number.isFinite(clientAmount) || clientAmount <= 0) throw new ValidationError('Client and Provider allocations must both be greater than zero');
    if (Math.round((providerAmount + clientAmount) * 1e8) !== Math.round(available * 1e8)) throw new ValidationError('Split allocations must equal the available escrow balance');
    allocations = [{ recipient: providerAccount, amount: providerAmount, type: 'RELEASE' }, { recipient: clientAccount, amount: clientAmount, type: 'REFUND' }];
  } else {
    const providerAmount = input.providerAmount;
    if (!Number.isFinite(providerAmount) || providerAmount <= 0 || providerAmount >= available) throw new ValidationError('Partial release must be positive and leave an unresolved escrow balance');
    if (input.clientAmount !== undefined && input.clientAmount !== 0) throw new ValidationError('Partial release can only allocate funds to the Provider');
    allocations = [{ recipient: providerAccount, amount: providerAmount, type: 'RELEASE' }];
  }

  const snapshot = snapshotStore(store);
  const fromStatus = dispute.status;
  try {
    const resolution = resolutionRepository.createResolution({
      disputeId, resolvedBy: input.actorId, transactionId: null, transactionIds: [], decision, milestoneId: resolutionMilestoneId,
      reasoning: reasoning.trim(), idempotencyKey, requestShape, executionStatus: 'PENDING',
    });
    const completedTransactions = [];
    for (const allocation of allocations) {
      completedTransactions.push(transactionService.createDisputeResolutionTransaction({
        type: allocation.type, amount: allocation.amount, escrowId: escrow.id, disputeId,
        resolutionId: resolution.id, actorId: input.actorId, toAccountId: allocation.recipient.id,
        milestoneId: resolutionMilestoneId,
      }));
    }
    allocations.forEach((allocation, index) => resolutionRepository.createAllocation({
      resolutionId: resolution.id, recipientAccountId: allocation.recipient.id,
      amount: allocation.amount, currency: allocation.recipient.currency,
      transactionId: completedTransactions[index].id,
    }));
    const remaining = currentAvailable(escrow.id, resolutionMilestoneId);
    const isFinal = remaining === 0;
    let finalStatus = decision === 'RELEASE_TO_PROVIDER' ? 'RELEASED'
      : decision === 'REFUND_TO_CLIENT' ? 'CANCELLED'
        : decision === 'SPLIT_FUNDS' ? 'RESOLVED' : null;
    const updatedResolution = store.update('disputeResolutions', resolution.id, {
      transactionId: completedTransactions[0].id,
      transactionIds: completedTransactions.map(transaction => transaction.id),
      executionStatus: isFinal ? 'COMPLETED' : 'PARTIAL',
      remainingEscrowBalance: remaining,
    });
    const nextDisputeStatus = isFinal ? 'RESOLVED' : 'UNDER_REVIEW';
    if (isFinal) {
      if (resolutionMilestoneId) {
        milestoneRepository.updateMilestoneStatus(resolutionMilestoneId, finalStatus);
        const milestones = milestoneRepository.getMilestonesByEscrowId(escrow.id);
        const activeMilestone = milestones.find(item => !['RELEASED', 'CANCELLED', 'RESOLVED'].includes(item.status));
        if (activeMilestone) finalStatus = activeMilestone.status;
        else if (milestones.every(item => item.status === 'RELEASED')) finalStatus = 'RELEASED';
        else if (milestones.every(item => item.status === 'CANCELLED')) finalStatus = 'CANCELLED';
        else finalStatus = 'RESOLVED';
      } else if (escrow.releaseModel !== 'CONDITION_BASED') {
        const milestoneStatus = decision === 'RELEASE_TO_PROVIDER' ? 'RELEASED'
          : decision === 'REFUND_TO_CLIENT' ? 'CANCELLED' : 'RESOLVED';
        milestoneRepository.getMilestonesByEscrowId(escrow.id).forEach(item => {
          if (!['RELEASED', 'CANCELLED', 'RESOLVED'].includes(item.status)) milestoneRepository.updateMilestoneStatus(item.id, milestoneStatus);
        });
      }
      store.update('escrows', escrow.id, { status: finalStatus, disputed: false, statusBeforeDispute: null });
      escrowStatusHistoryRepository.createEscrowStatusHistory({ escrowId: escrow.id, changedBy: input.actorId, fromStatus: 'DISPUTED', toStatus: finalStatus, reason: `Dispute resolution executed: ${decision}` });
      disputeRepository.updateDispute(disputeId, { status: 'RESOLVED', resolvedAt: Date.now() });
    } else if (dispute.status !== 'UNDER_REVIEW') {
      disputeRepository.updateDispute(disputeId, { status: 'UNDER_REVIEW' });
    }
    if (fromStatus !== nextDisputeStatus) historyRepository.createHistory({
      disputeId, changedBy: input.actorId, fromStatus, toStatus: nextDisputeStatus,
      reason: isFinal ? `Resolution executed: ${decision}` : `Partial release executed; ${remaining} ${escrowAccount.currency} remains in dispute`,
      eventType: 'STATUS_TRANSITION', resolutionId: resolution.id,
    });
    historyRepository.createHistory({
      disputeId, changedBy: input.actorId, fromStatus: nextDisputeStatus, toStatus: nextDisputeStatus,
      reason: `Resolution executed: ${decision}`, eventType: 'RESOLUTION_EXECUTED', resolutionId: resolution.id,
    });
    return { ...updatedResolution, status: nextDisputeStatus, remainingEscrowBalance: remaining, allocations: resolutionRepository.getAllocationsByResolutionId(resolution.id), transactions: completedTransactions };
  } catch (error) {
    restoreStore(store, snapshot);
    throw error;
  }
}

function resolveDispute(disputeId, input = {}) {
  assertAdmin(input.actorId);
  const dispute = disputeRepository.getDisputeById(disputeId);
  try { return executeResolution(disputeId, input); }
  catch (error) {
    historyRepository.createHistory({
      disputeId, changedBy: input.actorId, fromStatus: dispute.status, toStatus: dispute.status,
      reason: `Resolution attempt failed: ${error.message}`, eventType: 'RESOLUTION_FAILED',
    });
    throw error;
  }
}

function changeDisputeStatus(disputeId, actorId, toStatus, reason) {
  assertAdmin(actorId);
  const dispute = disputeRepository.getDisputeById(disputeId);
  const allowed = {
    OPEN: ['EVIDENCE_SUBMISSION', 'UNDER_REVIEW'],
    EVIDENCE_SUBMISSION: ['UNDER_REVIEW'],
    UNDER_REVIEW: ['EVIDENCE_SUBMISSION'],
  };
  if (!allowed[dispute.status]?.includes(toStatus)) throw new ValidationError(`Invalid dispute status transition from ${dispute.status} to ${toStatus}`);
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw new ValidationError('A transition reason is required and must be 2000 characters or fewer');
  const history = historyRepository.createHistory({ disputeId, changedBy: actorId, fromStatus: dispute.status, toStatus, reason: reason.trim(), eventType: 'STATUS_TRANSITION' });
  try {
    const updated = disputeRepository.updateDispute(disputeId, { status: toStatus });
    if (!updated) throw new Error('Dispute status update failed');
    return { dispute: updated, history };
  } catch (error) {
    const records = storeHistory();
    const index = records.findIndex(item => item.id === history.id);
    if (index >= 0) records.splice(index, 1);
    throw error;
  }
}
function storeHistory() { return getStore().disputeStatusHistory; }
function authorizeDisputeRead(disputeId, actorId) {
  if (typeof actorId !== 'string' || !actorId) throw new UnauthorizedError('A participant identity is required');
  const dispute = disputeRepository.getDisputeById(disputeId);
  const store = getStore();
  const user = store.findById('users', actorId);
  if (user && user.isActive !== false && (user.role || user.type) === 'ADMIN') return dispute;
  const escrow = require('../repositories/escrowRepository').getEscrowById(dispute.escrowId);
  const participantIds = escrow.participants?.length
    ? escrow.participants.filter(person => ['PAYER', 'PAYEE', 'CLIENT', 'PROVIDER'].includes(person.role)).map(person => person.userId)
    : [escrow.payerId || escrow.clientId, escrow.payeeId || escrow.freelancerId];
  if (!participantIds.includes(actorId)) throw new UnauthorizedError('Only an escrow participant or admin may view dispute activity');
  return dispute;
}
function getStatusHistory(disputeId, actorId) { authorizeDisputeRead(disputeId, actorId); return require('../repositories/disputeStatusHistoryRepository').getHistoryByDisputeId(disputeId); }
function getResolutions(disputeId, actorId) {
  authorizeDisputeRead(disputeId, actorId);
  return resolutionRepository.getResolutionsByDisputeId(disputeId).map(resolution => ({
    id: resolution.id, disputeId: resolution.disputeId, decision: resolution.decision,
    reasoning: resolution.reasoning, executionStatus: resolution.executionStatus,
    remainingEscrowBalance: resolution.remainingEscrowBalance, milestoneId: resolution.milestoneId || null, createdAt: resolution.createdAt,
    allocations: resolutionRepository.getAllocationsByResolutionId(resolution.id),
  }));
}

module.exports = { resolveDispute, changeDisputeStatus, getStatusHistory, getResolutions, currentAvailable };
