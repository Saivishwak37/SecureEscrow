// Ledger Service - Double-entry ledger operations with financial correctness
const ledgerRepository = require('../repositories/ledgerRepository');
const accountRepository = require('../repositories/accountRepository');
const { createLedgerEntries, validateAccountBalance } = require('../domain/ledgerRules');
const { LedgerImbalanceError, InsufficientBalanceError } = require('../utils/errors');

/**
 * Record a double-entry transaction in the ledger
 * @param {string} transactionId - Unique transaction ID
 * @param {string} fromAccountId - Account to debit (decrease)
 * @param {string} toAccountId - Account to credit (increase)
 * @param {number} amount - Transaction amount
 * @returns {Object} Created ledger entries
 */
async function recordTransaction(transactionId, fromAccountId, toAccountId, amount) {
  // 1. Validate accounts exist
  const fromAccount = accountRepository.getAccountById(fromAccountId);
  const toAccount = accountRepository.getAccountById(toAccountId);

  // 2. Validate sufficient balance
  validateAccountBalance(fromAccount, amount);

  // 3. Create ledger entries using domain rules
  const { debitEntry, creditEntry } = createLedgerEntries(
    transactionId,
    fromAccountId,
    toAccountId,
    amount
  );

  // 4. Calculate new balances after transaction
  const newFromBalance = fromAccount.balance - amount;
  const newToBalance = toAccount.balance + amount;

  // 5. Append entries to ledger (append-only)
  const persistedDebit = ledgerRepository.addLedgerEntry({
    ...debitEntry,
    balance: newFromBalance
  });

  const persistedCredit = ledgerRepository.addLedgerEntry({
    ...creditEntry,
    balance: newToBalance
  });

  // 6. Update account balances
  accountRepository.updateAccountBalance(fromAccountId, -amount);
  accountRepository.updateAccountBalance(toAccountId, amount);

  return {
    transactionId,
    debitEntry: persistedDebit,
    creditEntry: persistedCredit,
    fromAccountId,
    toAccountId,
    amount
  };
}

/**
 * Get full ledger history for an account
 * @param {string} accountId - Account ID
 * @returns {Array} Chronological ledger entries
 */
function getAccountLedger(accountId) {
  return ledgerRepository.getAccountLedger(accountId);
}

/**
 * Get ledger entries for a transaction
 * @param {string} transactionId - Transaction ID
 * @returns {Array} Debit and credit entries
 */
function getLedgerEntriesByTransaction(transactionId) {
  return ledgerRepository.getLedgerEntriesByTransactionId(transactionId);
}

/**
 * Get current account balance
 * @param {string} accountId - Account ID
 * @returns {number} Current balance
 */
function getAccountBalance(accountId) {
  const account = accountRepository.getAccountById(accountId);
  return account.balance;
}

/**
 * Validate all ledger entries are balanced
 * @returns {Object} Validation result
 */
function validateAllLedgers() {
  const allEntries = ledgerRepository.getAllLedgerEntries();
  
  // Group entries by transaction
  const entriesByTransaction = {};
  allEntries.forEach(entry => {
    if (!entriesByTransaction[entry.transactionId]) {
      entriesByTransaction[entry.transactionId] = [];
    }
    entriesByTransaction[entry.transactionId].push(entry);
  });

  const results = [];
  for (const [transactionId, entries] of Object.entries(entriesByTransaction)) {
    try {
      const totalDebits = entries.filter(e => e.type === 'DEBIT').reduce((sum, e) => sum + e.amount, 0);
      const totalCredits = entries.filter(e => e.type === 'CREDIT').reduce((sum, e) => sum + e.amount, 0);
      
      results.push({
        transactionId,
        balanced: totalDebits === totalCredits,
        totalDebits,
        totalCredits
      });
    } catch (error) {
      results.push({
        transactionId,
        balanced: false,
        error: error.message
      });
    }
  }

  return {
    totalTransactions: Object.keys(entriesByTransaction).length,
    allBalanced: results.every(r => r.balanced),
    results
  };
}

module.exports = {
  recordTransaction,
  getAccountLedger,
  getLedgerEntriesByTransaction,
  getAccountBalance,
  validateAllLedgers
};
