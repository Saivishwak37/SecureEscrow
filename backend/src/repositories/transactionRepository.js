// Transaction Repository - Data access layer for high-level transactions
const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new transaction record
 * @param {Object} transactionData - { type, amount, status, escrowId, milestoneId, fromAccountId, toAccountId }
 * @returns {Object} Created transaction
 */
function createTransaction({ type, amount, status = 'PENDING', escrowId, milestoneId = null, fromAccountId, toAccountId }) {
  const store = getStore();
  const transaction = {
    id: uuidv4(),
    type,
    amount,
    status,
    escrowId,
    milestoneId,
    fromAccountId,
    toAccountId,
    createdAt: Date.now()
  };
  return store.add('transactions', transaction);
}

/**
 * Get transaction by ID
 * @param {string} id - Transaction ID
 * @returns {Object} Transaction
 * @throws {NotFoundError} If transaction not found
 */
function getTransactionById(id) {
  const store = getStore();
  const txn = store.findById('transactions', id);
  if (!txn) {
    throw new NotFoundError('Transaction', id);
  }
  return txn;
}

/**
 * Get all transactions
 * @returns {Array} All transactions
 */
function getAllTransactions() {
  const store = getStore();
  return store.findAll('transactions');
}

/**
 * Get transactions by escrow ID
 * @param {string} escrowId - Escrow ID
 * @returns {Array} List of transactions
 */
function getTransactionsByEscrowId(escrowId) {
  const store = getStore();
  return store.findByField('transactions', 'escrowId', escrowId);
}

/**
 * Get transactions by milestone ID
 * @param {string} milestoneId - Milestone ID
 * @returns {Array} List of transactions
 */
function getTransactionsByMilestoneId(milestoneId) {
  const store = getStore();
  return store.findByField('transactions', 'milestoneId', milestoneId);
}

/**
 * Update transaction status
 * @param {string} id - Transaction ID
 * @param {string} newStatus - New status ('COMPLETED', 'FAILED', etc.)
 * @returns {Object} Updated transaction
 */
function updateTransactionStatus(id, newStatus) {
  const store = getStore();
  getTransactionById(id); // Ensure it exists
  return store.update('transactions', id, { status: newStatus, updatedAt: Date.now() });
}

module.exports = {
  createTransaction,
  getTransactionById,
  getAllTransactions,
  getTransactionsByEscrowId,
  getTransactionsByMilestoneId,
  updateTransactionStatus
};
