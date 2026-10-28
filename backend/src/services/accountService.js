// Account Service - Account and balance management
const accountRepository = require('../repositories/accountRepository');
const userRepository = require('../repositories/userRepository');
const { NotFoundError } = require('../utils/errors');

/**
 * Get account for a user
 * @param {string} userId - User ID
 * @returns {Object} Account
 */
function getAccountByUserId(userId) {
  userRepository.getUserById(userId); // Will throw if user doesn't exist
  const account = accountRepository.getAccountByUserId(userId);
  if (!account) {
    throw new NotFoundError('Account', userId);
  }
  return account;
}

/**
 * Get account balance for a user
 * @param {string} userId - User ID
 * @returns {number} Balance
 */
function getAccountBalance(userId) {
  const account = getAccountByUserId(userId);
  return account.balance;
}

/**
 * Create account for a user
 * @param {Object} data - { userId, currency }
 * @returns {Object} Account
 */
function createAccountForUser({ userId, currency = 'INR' }) {
  userRepository.getUserById(userId);
  return accountRepository.createAccount({
    userId,
    balance: 0,
    currency,
    type: 'PERSONAL'
  });
}

/**
 * Get the escrow account
 * @returns {Object} Escrow account
 */
function getEscrowAccount() {
  return accountRepository.getEscrowAccount();
}

/**
 * Get full account details
 * @param {string} accountId - Account ID
 * @returns {Object} Account details
 */
function getAccountDetails(accountId) {
  const account = accountRepository.getAccountById(accountId);
  return {
    id: account.id,
    userId: account.userId,
    balance: account.balance,
    currency: account.currency,
    type: account.type,
    createdAt: account.createdAt
  };
}

module.exports = {
  getAccountByUserId,
  getAccountBalance,
  createAccountForUser,
  getEscrowAccount,
  getAccountDetails
};
