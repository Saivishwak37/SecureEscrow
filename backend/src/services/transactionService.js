// Transaction Service - Transaction creation and management
const transactionRepository = require('../repositories/transactionRepository');
const accountRepository = require('../repositories/accountRepository');
const escrowRepository = require('../repositories/escrowRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const { ValidationError, DuplicateTransactionError } = require('../utils/errors');
const ledgerService = require('./ledgerService');
const { assertEscrowNotDisputed } = require('../domain/escrowGuards');

/**
 * Create a new transaction
 * @param {Object} transactionData
 * @returns {Object} Created transaction
 */
function createTransaction({ type, amount, escrowId, milestoneId, fromAccountId, toAccountId }) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (['FUND', 'RELEASE', 'REFUND'].includes(type)) assertEscrowNotDisputed(escrow, type.toLowerCase());
  if (milestoneId) milestoneRepository.getMilestoneById(milestoneId);
  accountRepository.getAccountById(fromAccountId);
  accountRepository.getAccountById(toAccountId);

  if (!['FUND', 'RELEASE', 'REFUND', 'DEPOSIT', 'WITHDRAWAL'].includes(type)) {
    throw new ValidationError(`Invalid transaction type: ${type}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  if (milestoneId) {
    const existing = transactionRepository.getTransactionsByMilestoneId(milestoneId);
    if (existing.some(t => t.type === type && t.status === 'COMPLETED')) {
      throw new DuplicateTransactionError(type, milestoneId);
    }
  }

  if (type === 'RELEASE' && !milestoneId) {
    const existing = transactionRepository.getTransactionsByEscrowId(escrowId);
    if (existing.some(t => t.type === 'RELEASE' && t.status === 'COMPLETED')) throw new DuplicateTransactionError(type, escrowId);
  }

  if (type === 'FUND' && milestoneId) {
    const funded = transactionRepository.getTransactionsByEscrowId(escrowId).filter(t => t.type === 'FUND' && t.status === 'COMPLETED').reduce((sum, t) => sum + t.amount, 0);
    if (funded + amount > escrow.totalAmount) throw new ValidationError('Funding would exceed the escrow agreement amount');
  }

  const transaction = transactionRepository.createTransaction({
    type, amount, status: 'PENDING', escrowId, milestoneId, fromAccountId, toAccountId
  });

  try {
    // Ledger updates are synchronous in the in-memory implementation.
    ledgerService.recordTransaction(transaction.id, fromAccountId, toAccountId, amount);
    return transactionRepository.updateTransactionStatus(transaction.id, 'COMPLETED');
  } catch (error) {
    transactionRepository.updateTransactionStatus(transaction.id, 'FAILED');
    throw error;
  }
}

function createDisputeResolutionTransaction({ type, amount, escrowId, disputeId, resolutionId, actorId, toAccountId, milestoneId = null }) {
  const { getStore } = require('../data/store');
  const store = getStore();
  const dispute = disputeRepositoryForResolution(disputeId);
  const escrow = escrowRepository.getEscrowById(escrowId);
  const actor = store.findById('users', actorId);
  const resolution = store.findById('disputeResolutions', resolutionId);
  if (actor?.isActive === false || (actor?.role || actor?.type) !== 'ADMIN') throw new (require('../utils/errors').UnauthorizedError)('Only an admin may execute dispute resolution');
  if (!resolution || resolution.disputeId !== disputeId || resolution.resolvedBy !== actorId
    || dispute.escrowId !== escrow.id || dispute.status === 'RESOLVED' || escrow.status !== 'DISPUTED' || !escrow.disputed) {
    throw new ValidationError('Dispute or escrow is not eligible for financial resolution');
  }
  if (milestoneId !== (resolution.milestoneId || null)) throw new ValidationError('Resolution transfer milestone must match the resolution scope');
  if (milestoneId && require('../repositories/milestoneRepository').getMilestoneById(milestoneId).escrowId !== escrow.id) throw new ValidationError('Resolution milestone must belong to the disputed escrow');
  const recipient = accountRepository.getAccountById(toAccountId);
  const allowedUser = type === 'RELEASE' ? escrow.payeeId || escrow.freelancerId
    : type === 'REFUND' ? escrow.payerId || escrow.clientId : null;
  const allowedRole = type === 'RELEASE' ? ['PAYEE', 'PROVIDER'] : ['PAYER', 'CLIENT'];
  if (!escrow.participants?.some(participant => participant.userId === allowedUser && allowedRole.includes(participant.role))) throw new ValidationError('Resolution recipient is not a participant in this escrow');
  if (!allowedUser || recipient.userId !== allowedUser || recipient.type !== 'PERSONAL') throw new ValidationError('Resolution recipient must be the associated Client or Provider account');
  const escrowAccount = accountRepository.getEscrowAccount();
  if (!escrowAccount || escrowAccount.currency !== recipient.currency) throw new ValidationError('Resolution account currencies must match');
  if (recipient.status === 'INACTIVE' || escrowAccount.status === 'INACTIVE') throw new ValidationError('Resolution accounts must be active');
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Resolution allocation must be greater than zero');
  const transaction = transactionRepository.createTransaction({ type, amount, status: 'PENDING', escrowId, milestoneId, fromAccountId: escrowAccount.id, toAccountId, disputeId, resolutionId });
  try {
    ledgerService.recordDisputeResolutionTransaction(transaction.id, disputeId, actorId);
    return transactionRepository.updateTransactionStatus(transaction.id, 'COMPLETED');
  } catch (error) {
    transactionRepository.updateTransactionStatus(transaction.id, 'FAILED');
    throw error;
  }
}

function disputeRepositoryForResolution(disputeId) {
  return require('../repositories/disputeRepository').getDisputeById(disputeId);
}

/**
 * Get all transactions for an escrow
 * @param {string} escrowId
 * @returns {Array} Transactions
 */
function getTransactionsByEscrow(escrowId) {
  return transactionRepository.getTransactionsByEscrowId(escrowId);
}

/**
 * Get all transactions for a milestone
 * @param {string} milestoneId
 * @returns {Array} Transactions
 */
function getTransactionsByMilestone(milestoneId) {
  return transactionRepository.getTransactionsByMilestoneId(milestoneId);
}

/**
 * Get transaction by ID
 * @param {string} transactionId
 * @returns {Object} Transaction
 */
function getTransactionById(transactionId) {
  return transactionRepository.getTransactionById(transactionId);
}

/**
 * Update transaction status
 * @param {string} transactionId
 * @param {string} newStatus
 * @returns {Object} Updated transaction
 */
function updateTransactionStatus(transactionId, newStatus) {
  return transactionRepository.updateTransactionStatus(transactionId, newStatus);
}

module.exports = {
  createTransaction,
  createDisputeResolutionTransaction,
  getTransactionsByEscrow,
  getTransactionsByMilestone,
  getTransactionById,
  updateTransactionStatus
};
