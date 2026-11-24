// Account Service - Account and balance management
const accountRepository = require('../repositories/accountRepository');
const userRepository = require('../repositories/userRepository');
const { ValidationError, UnauthorizedError } = require('../utils/errors');
const transactionRepository = require('../repositories/transactionRepository');
const ledgerService = require('./ledgerService');
const { assertActorRole } = require('../domain/participantAuthorization');

const CLEARING_ACCOUNT_ID = 'account-clearing';

function transferFunds(accountId, actorId, amount, operation) {
  assertActorRole(actorId, ['CLIENT', 'PROVIDER']);
  const account = accountRepository.getAccountById(accountId);
  if (account.type !== 'PERSONAL' || account.userId !== actorId) throw new UnauthorizedError('You can only move funds in your own personal account');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new ValidationError('Enter an amount greater than zero with no more than two decimal places');
  }

  const clearing = accountRepository.getAccountById(CLEARING_ACCOUNT_ID);
  const isDeposit = operation === 'DEPOSIT';
  const fromAccountId = isDeposit ? clearing.id : account.id;
  const toAccountId = isDeposit ? account.id : clearing.id;
  const transaction = transactionRepository.createTransaction({
    type: operation, amount, status: 'PENDING', escrowId: null, milestoneId: null, fromAccountId, toAccountId,
  });

  try {
    ledgerService.recordTransaction(transaction.id, fromAccountId, toAccountId, amount);
    const completed = transactionRepository.updateTransactionStatus(transaction.id, 'COMPLETED');
    return { transaction: completed, account: accountRepository.getAccountById(accountId) };
  } catch (error) {
    transactionRepository.updateTransactionStatus(transaction.id, 'FAILED');
    throw error;
  }
}

function addFunds(accountId, actorId, amount) {
  return transferFunds(accountId, actorId, amount, 'DEPOSIT');
}

function withdrawFunds(accountId, actorId, amount) {
  return transferFunds(accountId, actorId, amount, 'WITHDRAWAL');
}

function getAccountTransactions(accountId) {
  accountRepository.getAccountById(accountId);
  return transactionRepository.getTransactionsByAccountId(accountId);
}

/**
 * Get account for a user
 * @param {string} userId - User ID
 * @returns {Object} Account
 */
function getAccountByUserId(userId) {
  userRepository.getUserById(userId); // Will throw if user doesn't exist
  const account = accountRepository.getAccountByUserId(userId);
  if (!account) {
    // Older in-memory sessions can contain a registered user created before
    // wallet provisioning was added to registration. Repair that state on
    // the authenticated self-account lookup so the user can enter the app.
    // createAccountForUser enforces the CLIENT/PROVIDER role and creates a
    // zero-balance PERSONAL account using only the server-verified user ID.
    return createAccountForUser({ userId });
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
  assertActorRole(userId, ['CLIENT', 'PROVIDER']);
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
  getAccountDetails,
  addFunds,
  withdrawFunds,
  getAccountTransactions
};
