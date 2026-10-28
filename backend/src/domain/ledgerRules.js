// Double-Entry Ledger Domain Rules
// Defines the strict validation rules for financial transactions and integrity.

const { LedgerImbalanceError, InsufficientBalanceError, ValidationError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

const TRANSACTION_TYPES = {
  FUND: 'FUND',           // Client -> Escrow (funding a milestone)
  RELEASE: 'RELEASE',     // Escrow -> Freelancer (paying out milestone)
  REFUND: 'REFUND'        // Escrow -> Client (cancelling milestone)
};

const LEDGER_ENTRY_TYPES = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT'
};

/**
 * Validates that an array of ledger entries obeys the double-entry accounting rule where total debits equal total credits.
 * @param {Array<Object>} entries List of ledger entry objects
 * @returns {boolean} true if balanced
 * @throws {LedgerImbalanceError} if unbalanced
 */
function validateLedgerBalance(entries) {
  if (!entries || entries.length === 0) {
    throw new ValidationError('No ledger entries provided to validate');
  }

  let totalDebits = 0;
  let totalCredits = 0;

  entries.forEach(entry => {
    // Assuming entry.amount is a positive number representing the absolute value of the flow
    if (entry.type === LEDGER_ENTRY_TYPES.DEBIT) {
      totalDebits += entry.amount;
    } else if (entry.type === LEDGER_ENTRY_TYPES.CREDIT) {
      totalCredits += entry.amount;
    } else {
      throw new ValidationError(`Invalid ledger entry type: ${entry.type}`);
    }
  });

  if (totalDebits !== totalCredits) {
    throw new LedgerImbalanceError(totalDebits, totalCredits);
  }

  return true; // Imbalance check passed
}

/**
 * Validates that a pair of corresponding transaction entries is matching and financially sound.
 * Typically called right before persisting entries.
 */
function validateTransactionEntries(debitEntry, creditEntry) {
  if (debitEntry.type !== LEDGER_ENTRY_TYPES.DEBIT) {
     throw new ValidationError('First entry must be a DEBIT');
  }
  if (creditEntry.type !== LEDGER_ENTRY_TYPES.CREDIT) {
     throw new ValidationError('Second entry must be a CREDIT');
  }

  if (debitEntry.amount !== creditEntry.amount) {
      throw new LedgerImbalanceError(debitEntry.amount, creditEntry.amount);
  }

  if (debitEntry.amount <= 0) {
     throw new ValidationError('Transaction amount must be strictly greater than 0');
  }

  if (debitEntry.transactionId !== creditEntry.transactionId) {
      throw new ValidationError(`Mismatched transaction IDs in pair: ${debitEntry.transactionId} vs ${creditEntry.transactionId}`);
  }

  if (debitEntry.accountId === creditEntry.accountId) {
      throw new ValidationError('Cannot transact with the same account (circular flow)');
  }

  return true;
}

/**
 * Validates that an account has sufficient balance to cover an outflow.
 * @param {Object} account Account object containing balance
 * @param {Number} requiredAmount Amount needed
 * @throws {InsufficientBalanceError}
 */
function validateAccountBalance(account, requiredAmount) {
  if (!account) throw new ValidationError('Account cannot be null');

  if (account.balance < requiredAmount) {
    throw new InsufficientBalanceError(account.id, requiredAmount, account.balance);
  }
  return true;
}

/**
 * Utility purely for modeling a double-entry transaction pair structure.
 * Business logic should call this to format the raw entries before saving them via repository.
 */
function createLedgerEntries(transactionId, fromAccountId, toAccountId, amount) {
   const debitEntry = {
      id: uuidv4(),
      transactionId,
      accountId: fromAccountId,
      type: LEDGER_ENTRY_TYPES.DEBIT,
      amount,
      createdAt: Date.now()
   };

   const creditEntry = {
      id: uuidv4(),
      transactionId,
      accountId: toAccountId,
      type: LEDGER_ENTRY_TYPES.CREDIT,
      amount,
      createdAt: Date.now()
   };

   validateTransactionEntries(debitEntry, creditEntry);
   // Implicit verification
   validateLedgerBalance([debitEntry, creditEntry]);

   return { debitEntry, creditEntry };
}


module.exports = {
  TRANSACTION_TYPES,
  LEDGER_ENTRY_TYPES,
  validateLedgerBalance,
  validateTransactionEntries,
  validateAccountBalance,
  createLedgerEntries
};
