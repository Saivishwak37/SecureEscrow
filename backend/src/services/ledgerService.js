// Ledger Service - Double-entry ledger operations with financial correctness
const ledgerRepository = require('../repositories/ledgerRepository');
const accountRepository = require('../repositories/accountRepository');
const transactionRepository = require('../repositories/transactionRepository');
const escrowRepository = require('../repositories/escrowRepository');
const { createLedgerEntries, validateAccountBalance } = require('../domain/ledgerRules');
const { LedgerImbalanceError, InsufficientBalanceError, ValidationError } = require('../utils/errors');
const { assertEscrowNotDisputed } = require('../domain/escrowGuards');

/**
 * Record a double-entry transaction in the ledger
 * @param {string} transactionId - Unique transaction ID
 * @param {string} fromAccountId - Account to debit (decrease)
 * @param {string} toAccountId - Account to credit (increase)
 * @param {number} amount - Transaction amount
 * @returns {Object} Created ledger entries
 */
function recordTransactionInternal(transactionId, fromAccountId, toAccountId, amount, allowDisputeResolution = false) {
  // 1. Validate accounts exist
  const fromAccount = accountRepository.getAccountById(fromAccountId);
  const toAccount = accountRepository.getAccountById(toAccountId);

  // Escrow-account debits must be backed by a matching release/refund transaction.
  // This closes direct ledger-service calls as well as normal transaction flows.
  if (fromAccount.type === 'ESCROW') {
    const transaction = transactionRepository.getTransactionById(transactionId);
    if (!transaction.escrowId || !['RELEASE', 'REFUND'].includes(transaction.type)
      || transaction.fromAccountId !== fromAccountId || transaction.toAccountId !== toAccountId
      || transaction.amount !== amount) {
      throw new ValidationError('Escrow-account debits require a matching release or refund transaction');
    }
    const escrow = escrowRepository.getEscrowById(transaction.escrowId);
    if (!allowDisputeResolution) assertEscrowNotDisputed(escrow, 'Escrow-account debit');
  }

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

function recordTransaction(transactionId, fromAccountId, toAccountId, amount) {
  return recordTransactionInternal(transactionId, fromAccountId, toAccountId, amount, false);
}

// Internal controlled path. Its checks are repeated here so a caller cannot
// turn an arbitrary escrow debit into a dispute resolution transfer.
function recordDisputeResolutionTransaction(transactionId, disputeId, actorId) {
  const { getStore } = require('../data/store');
  const store = getStore();
  const transaction = transactionRepository.getTransactionById(transactionId);
  const dispute = store.findById('disputes', disputeId);
  const user = store.findById('users', actorId);
  const resolution = store.findById('disputeResolutions', transaction.resolutionId);
  if (!dispute || user?.isActive === false || (user?.role || user?.type) !== 'ADMIN' || transaction.disputeId !== disputeId || !resolution
    || resolution.disputeId !== disputeId || resolution.resolvedBy !== actorId) {
    throw new ValidationError('Invalid controlled dispute resolution transaction');
  }
  const escrow = escrowRepository.getEscrowById(dispute.escrowId);
  const from = accountRepository.getAccountById(transaction.fromAccountId);
  const to = accountRepository.getAccountById(transaction.toAccountId);
  const expectedUserId = transaction.type === 'RELEASE' ? escrow.payeeId || escrow.freelancerId
    : transaction.type === 'REFUND' ? escrow.payerId || escrow.clientId : null;
  const expectedRole = transaction.type === 'RELEASE' ? ['PAYEE', 'PROVIDER'] : ['PAYER', 'CLIENT'];
  if (dispute.status === 'RESOLVED' || escrow.status !== 'DISPUTED' || !escrow.disputed
    || transaction.escrowId !== escrow.id || from.type !== 'ESCROW' || to.userId !== expectedUserId
    || transaction.milestoneId !== (resolution.milestoneId || null)
    || !escrow.participants?.some(participant => participant.userId === expectedUserId && expectedRole.includes(participant.role))
    || from.currency !== to.currency || transaction.amount <= 0) {
    throw new ValidationError('Dispute resolution transfer does not match the disputed escrow participants');
  }
  return recordTransactionInternal(transaction.id, transaction.fromAccountId, transaction.toAccountId, transaction.amount, true);
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
  recordDisputeResolutionTransaction,
  getAccountLedger,
  getLedgerEntriesByTransaction,
  getAccountBalance,
  validateAllLedgers
};
