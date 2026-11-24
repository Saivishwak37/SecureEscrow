const escrowRepository = require('../repositories/escrowRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const conditionRepository = require('../repositories/conditionRepository');
const disputeRepository = require('../repositories/disputeRepository');
const accountRepository = require('../repositories/accountRepository');
const transactionRepository = require('../repositories/transactionRepository');
const { AuthenticationError, UnauthorizedError } = require('../utils/errors');

function requireIdentity(auth) {
  if (!auth?.userId || !auth?.role) throw new AuthenticationError();
}

function assertEscrowAccess(escrowId, auth, { roles = ['CLIENT', 'PROVIDER'], allowAdmin = false } = {}) {
  requireIdentity(auth);
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (allowAdmin && auth.role === 'ADMIN') return escrow;
  const clientId = escrow.clientId || escrow.payerId;
  const providerId = escrow.freelancerId || escrow.payeeId;
  const clientAccess = auth.role === 'CLIENT' && roles.includes('CLIENT') && auth.userId === clientId;
  const providerAccess = auth.role === 'PROVIDER' && roles.includes('PROVIDER') && auth.userId === providerId;
  if (!clientAccess && !providerAccess) throw new UnauthorizedError('You are not authorized to access this resource');
  return escrow;
}

function assertMilestoneAccess(milestoneId, auth, options = {}) {
  requireIdentity(auth);
  const milestone = milestoneRepository.getMilestoneById(milestoneId);
  const escrow = assertEscrowAccess(milestone.escrowId, auth, options);
  return { milestone, escrow };
}

function assertConditionAccess(conditionId, auth, options = {}) {
  requireIdentity(auth);
  const condition = conditionRepository.getConditionById(conditionId);
  const escrow = assertEscrowAccess(condition.escrowId, auth, options);
  return { condition, escrow };
}

function assertDisputeAccess(disputeId, auth, { allowAdmin = true } = {}) {
  requireIdentity(auth);
  const dispute = disputeRepository.getDisputeById(disputeId);
  const escrow = assertEscrowAccess(dispute.escrowId, auth, { allowAdmin });
  return { dispute, escrow };
}

function assertAccountAccess(accountId, auth, { allowAdmin = true } = {}) {
  requireIdentity(auth);
  const account = accountRepository.getAccountById(accountId);
  if (allowAdmin && auth.role === 'ADMIN') return account;
  if (account.type !== 'PERSONAL' || account.userId !== auth.userId) {
    throw new UnauthorizedError('You are not authorized to access this account');
  }
  return account;
}

function assertTransactionAccess(transactionId, auth, { allowAdmin = true } = {}) {
  requireIdentity(auth);
  const transaction = transactionRepository.getTransactionById(transactionId);
  if (allowAdmin && auth.role === 'ADMIN') return transaction;
  if (transaction.escrowId) {
    assertEscrowAccess(transaction.escrowId, auth);
    return transaction;
  }
  const fromAccount = accountRepository.getAccountById(transaction.fromAccountId);
  const toAccount = accountRepository.getAccountById(transaction.toAccountId);
  if (![fromAccount, toAccount].some(account => account.type === 'PERSONAL' && account.userId === auth.userId)) {
    throw new UnauthorizedError('You are not authorized to access this transaction');
  }
  return transaction;
}

module.exports = {
  assertEscrowAccess,
  assertMilestoneAccess,
  assertConditionAccess,
  assertDisputeAccess,
  assertAccountAccess,
  assertTransactionAccess
};
