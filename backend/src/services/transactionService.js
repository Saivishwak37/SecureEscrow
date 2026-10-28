// Transaction Service - Transaction creation and management
const transactionRepository = require('../repositories/transactionRepository');
const accountRepository = require('../repositories/accountRepository');
const escrowRepository = require('../repositories/escrowRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const { ValidationError, DuplicateTransactionError } = require('../utils/errors');
const ledgerService = require('./ledgerService');

/**
 * Create a new transaction
 * @param {Object} transactionData
 * @returns {Object} Created transaction
 */
function createTransaction({ type, amount, escrowId, milestoneId, fromAccountId, toAccountId }) {
  const escrow = escrowRepository.getEscrowById(escrowId);
  if (milestoneId) milestoneRepository.getMilestoneById(milestoneId);
  accountRepository.getAccountById(fromAccountId);
  accountRepository.getAccountById(toAccountId);

  if (!['FUND', 'RELEASE', 'REFUND'].includes(type)) {
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

  const transaction = transactionRepository.createTransaction({
    type, amount, status: 'PENDING', escrowId, milestoneId, fromAccountId, toAccountId
  });

  try {
    ledgerService.recordTransaction(transaction.id, fromAccountId, toAccountId, amount);
    return transactionRepository.updateTransactionStatus(transaction.id, 'COMPLETED');
  } catch (error) {
    transactionRepository.updateTransactionStatus(transaction.id, 'FAILED');
    throw error;
  }
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
  getTransactionsByEscrow,
  getTransactionsByMilestone,
  getTransactionById,
  updateTransactionStatus
};
