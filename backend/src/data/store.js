// In-Memory Store for SecureEscrow
// This will be replaced with PostgreSQL + Prisma in final evaluation

const { v4: uuidv4 } = require('uuid');

class InMemoryStore {
  constructor() {
    this.users = [];
    this.accounts = [];
    this.escrows = [];
    this.milestones = [];
    this.transactions = [];
    this.ledgerEntries = [];

    // Initialize with seed data
    this.initializeSeedData();
  }

  initializeSeedData() {
    // Create users
    const clientUser = {
      id: 'user-1',
      name: 'Test Client',
      type: 'CLIENT',
      createdAt: Date.now()
    };

    const freelancerUser = {
      id: 'user-2',
      name: 'Test Freelancer',
      type: 'FREELANCER',
      createdAt: Date.now()
    };

    this.users.push(clientUser, freelancerUser);

    // Create accounts
    const clientAccount = {
      id: 'account-user-1',
      userId: 'user-1',
      balance: 50000,
      currency: 'INR',
      type: 'PERSONAL',
      createdAt: Date.now()
    };

    const freelancerAccount = {
      id: 'account-user-2',
      userId: 'user-2',
      balance: 0,
      currency: 'INR',
      type: 'PERSONAL',
      createdAt: Date.now()
    };

    // Escrow account (will be used for escrow funds)
    const escrowAccount = {
      id: 'account-escrow',
      userId: null,
      balance: 0,
      currency: 'INR',
      type: 'ESCROW',
      createdAt: Date.now()
    };

    this.accounts.push(clientAccount, freelancerAccount, escrowAccount);
  }

  // Generic find methods
  findById(collection, id) {
    return this[collection].find(item => item.id === id);
  }

  findAll(collection) {
    return [...this[collection]];
  }

  findByField(collection, field, value) {
    return this[collection].filter(item => item[field] === value);
  }

  // Generic CRUD
  add(collection, item) {
    const newItem = { ...item, id: item.id || uuidv4(), createdAt: Date.now() };
    this[collection].push(newItem);
    return newItem;
  }

  update(collection, id, updates) {
    const index = this[collection].findIndex(item => item.id === id);
    if (index === -1) return null;
    this[collection][index] = { ...this[collection][index], ...updates, updatedAt: Date.now() };
    return this[collection][index];
  }

  delete(collection, id) {
    const index = this[collection].findIndex(item => item.id === id);
    if (index === -1) return false;
    this[collection].splice(index, 1);
    return true;
  }

  // Account-specific methods
  getAccountByUserId(userId) {
    return this.accounts.find(a => a.userId === userId);
  }

  getEscrowAccount() {
    return this.accounts.find(a => a.type === 'ESCROW');
  }

  getAccountById(accountId) {
    return this.accounts.find(a => a.id === accountId);
  }

  updateAccountBalance(accountId, amount) {
    const account = this.getAccountById(accountId);
    if (!account) return null;
    account.balance += amount;
    return account;
  }

  // Clear all data
  clearAll() {
    this.users = [];
    this.accounts = [];
    this.escrows = [];
    this.milestones = [];
    this.transactions = [];
    this.ledgerEntries = [];
  }

  // Reset to seed data
  reset() {
    this.clearAll();
    this.initializeSeedData();
  }
}

// Singleton instance
const store = new InMemoryStore();

function getStore() {
  return store;
}

module.exports = { getStore, InMemoryStore };
