// Ledger Repository - Data access layer for append-only double-entry ledger logs
const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Add a new ledger entry.
 * IMPORTANT: Ledger entries are APPEND-ONLY. 
 * @param {Object} entryData - { transactionId, accountId, type, amount, balance }
 * @returns {Object} Persisted ledger entry
 */
function addLedgerEntry({ transactionId, accountId, type, amount, balance }) {
  const store = getStore();
  
  // Note: the `createLedgerEntries` domain rule handles validation & ID generation.
  // We accept pre-generated IDs or generate one if missing.
  const entry = {
    id: uuidv4(),
    transactionId,
    accountId,
    type,
    amount,
    balance,  // the balance snapshot right AFTER this entry is applied
    createdAt: Date.now()
  };
  
  return store.add('ledgerEntries', entry);
}

/**
 * Get ledger entry by ID
 * @param {string} id - Ledger Entry ID
 * @returns {Object} Ledger Entry
 * @throws {NotFoundError}
 */
function getLedgerEntryById(id) {
  const store = getStore();
  const entry = store.findById('ledgerEntries', id);
  if (!entry) {
    throw new NotFoundError('LedgerEntry', id);
  }
  return entry;
}

/**
 * Get all ledger entries system-wide
 * @returns {Array} All ledger entries
 */
function getAllLedgerEntries() {
  const store = getStore();
  return store.findAll('ledgerEntries');
}

/**
 * Get ledger entries linked to a specific transaction
 * @param {string} transactionId
 * @returns {Array} List of ledger entries (expecting exactly 2 for standard double-entry)
 */
function getLedgerEntriesByTransactionId(transactionId) {
  const store = getStore();
  return store.findByField('ledgerEntries', 'transactionId', transactionId);
}

/**
 * Get the full ledger history for a specific account.
 * Crucial for financial transparency and auditing.
 * @param {string} accountId 
 * @returns {Array} Chronologically sorted ledger history
 */
function getAccountLedger(accountId) {
  const store = getStore();
  const entries = store.findByField('ledgerEntries', 'accountId', accountId);
  return entries.sort((a, b) => a.createdAt - b.createdAt); // Ascending order
}

module.exports = {
  addLedgerEntry,
  getLedgerEntryById,
  getAllLedgerEntries,
  getLedgerEntriesByTransactionId,
  getAccountLedger
};
// Note: Intentionally no update or delete methods
