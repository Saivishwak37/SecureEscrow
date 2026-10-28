// Account Repository - Data access layer for virtual accounts/wallets
const { getStore } = require('../data/store');
const { NotFoundError, InsufficientBalanceError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new account
 * @param {Object} accountData - { userId, balance, currency, type }
 * @returns {Object} Created account
 */
function createAccount({ userId, balance, currency, type }) {
  const store = getStore();
  const account = {
    id: uuidv4(),
    userId,
    balance: balance || 0,
    currency: currency || 'INR',
    type: type || 'PERSONAL', // 'PERSONAL' or 'ESCROW'
    createdAt: Date.now()
  };
  return store.add('accounts', account);
}

/**
 * Get account by ID
 * @param {string} id - Account ID
 * @returns {Object} Account
 * @throws {NotFoundError} If account not found
 */
function getAccountById(id) {
  const store = getStore();
  const account = store.findById('accounts', id);
  if (!account) {
    throw new NotFoundError('Account', id);
  }
  return account;
}

/**
 * Get account by user ID
 * @param {string} userId - User ID
 * @returns {Object|null} Account or null
 */
function getAccountByUserId(userId) {
  const store = getStore();
  return store.getAccountByUserId(userId);
}

/**
 * Get the escrow account
 * @returns {Object} Escrow account
 */
function getEscrowAccount() {
  const store = getStore();
  return store.getEscrowAccount();
}

/**
 * Get all accounts
 * @returns {Array} All accounts
 */
function getAllAccounts() {
  const store = getStore();
  return store.findAll('accounts');
}

/**
 * Update account balance
 * @param {string} accountId - Account ID
 * @param {number} amount - Amount to add (can be negative for debit)
 * @returns {Object} Updated account
 */
function updateAccountBalance(accountId, amount) {
  const store = getStore();
  const account = getAccountById(accountId);
  
  // Check if operation would result in negative balance
  if (account.balance + amount < 0) {
    throw new InsufficientBalanceError(accountId, Math.abs(amount), account.balance);
  }
  
  return store.updateAccountBalance(accountId, amount);
}

/**
 * Get current account balance
 * @param {string} accountId - Account ID
 * @returns {number} Current balance
 */
function getAccountBalance(accountId) {
  const account = getAccountById(accountId);
  return account.balance;
}

module.exports = {
  createAccount,
  getAccountById,
  getAccountByUserId,
  getEscrowAccount,
  getAllAccounts,
  updateAccountBalance,
  getAccountBalance
};
