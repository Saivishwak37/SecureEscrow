/**
 * SecureLance Seed Data
 * Populates the in-memory store with sample data for testing and development
 */

const { userStore, transactionStore, ledgerStore, disputeStore, milestoneStore } = require('./store');

// Seed timestamp for consistent data
const SEED_DATE = '2025-01-15T10:30:00.000Z';

/**
 * Sample Users Seed Data
 */
const seedUsers = [
  {
    id: 'user-001',
    email: 'john.buyer@example.com',
    name: 'John Buyer',
    role: 'buyer',
    balance: 50000.00,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-002',
    email: 'sarah.seller@example.com',
    name: 'Sarah Seller',
    role: 'seller',
    balance: 12500.00,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-003',
    email: 'mike.freelancer@example.com',
    name: 'Mike Freelancer',
    role: 'seller',
    balance: 3200.00,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-004',
    email: 'emma.client@example.com',
    name: 'Emma Client',
    role: 'buyer',
    balance: 89000.00,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-005',
    email: 'admin@securelance.com',
    name: 'System Admin',
    role: 'admin',
    balance: 0,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-006',
    email: 'david.buyer@example.com',
    name: 'David Buyer',
    role: 'buyer',
    balance: 15000.00,
    emailVerified: false,
    kycStatus: 'pending'
  },
  {
    id: 'user-007',
    email: 'lisa.developer@example.com',
    name: 'Lisa Developer',
    role: 'seller',
    balance: 45000.00,
    emailVerified: true,
    kycStatus: 'verified'
  },
  {
    id: 'user-008',
    email: 'alex.agency@example.com',
    name: 'Alex Agency',
    role: 'seller',
    balance: 250000.00,
    emailVerified: true,
    kycStatus: 'verified'
  }
];

/**
 * Sample Transactions Seed Data
 */
const seedTransactions = [
  {
    id: 'txn-001',
    buyerId: 'user-001',
    sellerId: 'user-002',
    title: 'Website Development Project',
    description: 'Full-stack website development with React and Node.js',
    amount: 15000.00,
    fee: 375.00,
    total: 15375.00,
    status: 'completed',
    milestone: 'final',
    milestoneProgress: 100,
    createdAt: '2024-11-01T09:00:00.000Z',
    updatedAt: '2024-12-15T14:30:00.000Z'
  },
  {
    id: 'txn-002',
    buyerId: 'user-004',
    sellerId: 'user-003',
    title: 'Mobile App UI Design',
    description: 'Design of iOS and Android mobile application interfaces',
    amount: 5000.00,
    fee: 125.00,
    total: 5125.00,
    status: 'in_escrow',
    milestone: 'initial_deposit',
    milestoneProgress: 50,
    createdAt: '2025-01-10T11:00:00.000Z',
    updatedAt: '2025-01-12T16:45:00.000Z'
  },
  {
    id: 'txn-003',
    buyerId: 'user-001',
    sellerId: 'user-007',
    title: 'API Integration Service',
    description: 'Third-party payment gateway integration',
    amount: 8000.00,
    fee: 200.00,
    total: 8200.00,
    status: 'pending',
    milestone: 'awaiting_funds',
    milestoneProgress: 0,
    createdAt: '2025-01-14T08:30:00.000Z',
    updatedAt: '2025-01-14T08:30:00.000Z'
  },
  {
    id: 'txn-004',
    buyerId: 'user-006',
    sellerId: 'user-008',
    title: 'Enterprise Software Development',
    description: 'Custom ERP system development for mid-size business',
    amount: 75000.00,
    fee: 1875.00,
    total: 76875.00,
    status: 'disputed',
    milestone: 'development',
    milestoneProgress: 60,
    createdAt: '2024-10-20T10:00:00.000Z',
    updatedAt: '2025-01-08T09:15:00.000Z'
  },
  {
    id: 'txn-005',
    buyerId: 'user-004',
    sellerId: 'user-002',
    title: 'Logo and Brand Identity',
    description: 'Professional logo design with full brand guidelines',
    amount: 2500.00,
    fee: 62.50,
    total: 2562.50,
    status: 'released',
    milestone: 'final',
    milestoneProgress: 100,
    createdAt: '2024-09-15T13:00:00.000Z',
    updatedAt: '2024-10-01T11:20:00.000Z'
  },
  {
    id: 'txn-006',
    buyerId: 'user-001',
    sellerId: 'user-003',
    title: 'Content Writing Services',
    description: 'SEO-optimized blog posts and web content',
    amount: 1500.00,
    fee: 37.50,
    total: 1537.50,
    status: 'cancelled',
    milestone: 'cancelled',
    milestoneProgress: 0,
    createdAt: '2024-12-01T15:00:00.000Z',
    updatedAt: '2024-12-05T10:30:00.000Z'
  },
  {
    id: 'txn-007',
    buyerId: 'user-006',
    sellerId: 'user-007',
    title: 'E-commerce Platform Setup',
    description: 'Setup and configuration of WooCommerce store',
    amount: 3500.00,
    fee: 87.50,
    total: 3587.50,
    status: 'in_progress',
    milestone: 'development_phase_2',
    milestoneProgress: 75,
    createdAt: '2025-01-05T09:00:00.000Z',
    updatedAt: '2025-01-13T17:00:00.000Z'
  },
  {
    id: 'txn-008',
    buyerId: 'user-004',
    sellerId: 'user-008',
    title: 'Cloud Infrastructure Setup',
    description: 'AWS infrastructure configuration and deployment',
    amount: 12000.00,
    fee: 300.00,
    total: 12300.00,
    status: 'refunded',
    milestone: 'refunded',
    milestoneProgress: 0,
    createdAt: '2024-08-10T14:00:00.000Z',
    updatedAt: '2024-09-01T10:00:00.000Z'
  }
];

/**
 * Sample Ledger Entries Seed Data
 */
const seedLedgers = [
  // Transaction 001 - Completed
  { id: 'led-001', transactionId: 'txn-001', userId: 'user-001', type: 'debit', amount: 15375.00, description: 'Escrow deposit for Website Development Project', createdAt: '2024-11-01T09:00:00.000Z' },
  { id: 'led-002', transactionId: 'txn-001', userId: 'system', type: 'fee', amount: 375.00, description: 'Platform fee - Website Development Project', createdAt: '2024-11-01T09:00:00.000Z' },
  { id: 'led-003', transactionId: 'txn-001', userId: 'user-002', type: 'credit', amount: 15000.00, description: 'Escrow release - Website Development Project', createdAt: '2024-12-15T14:30:00.000Z' },

  // Transaction 002 - In Escrow
  { id: 'led-004', transactionId: 'txn-002', userId: 'user-004', type: 'debit', amount: 5125.00, description: 'Escrow deposit for Mobile App UI Design', createdAt: '2025-01-10T11:00:00.000Z' },
  { id: 'led-005', transactionId: 'txn-002', userId: 'system', type: 'fee', amount: 125.00, description: 'Platform fee - Mobile App UI Design', createdAt: '2025-01-10T11:00:00.000Z' },

  // Transaction 003 - Pending
  // No ledger entries yet as funds are awaiting

  // Transaction 004 - Disputed
  { id: 'led-006', transactionId: 'txn-004', userId: 'user-006', type: 'debit', amount: 76875.00, description: 'Escrow deposit for Enterprise Software Development', createdAt: '2024-10-20T10:00:00.000Z' },
  { id: 'led-007', transactionId: 'txn-004', userId: 'system', type: 'fee', amount: 1875.00, description: 'Platform fee - Enterprise Software Development', createdAt: '2024-10-20T10:00:00.000Z' },
  { id: 'led-008', transactionId: 'txn-004', userId: 'user-008', type: 'hold', amount: 75000.00, description: 'Funds placed on hold - dispute in progress', createdAt: '2025-01-08T09:15:00.000Z' },

  // Transaction 005 - Released
  { id: 'led-009', transactionId: 'txn-005', userId: 'user-004', type: 'debit', amount: 2562.50, description: 'Escrow deposit for Logo and Brand Identity', createdAt: '2024-09-15T13:00:00.000Z' },
  { id: 'led-010', transactionId: 'txn-005', userId: 'system', type: 'fee', amount: 62.50, description: 'Platform fee - Logo and Brand Identity', createdAt: '2024-09-15T13:00:00.000Z' },
  { id: 'led-011', transactionId: 'txn-005', userId: 'user-002', type: 'credit', amount: 2500.00, description: 'Escrow release - Logo and Brand Identity', createdAt: '2024-10-01T11:20:00.000Z' },

  // Transaction 006 - Cancelled
  { id: 'led-012', transactionId: 'txn-006', userId: 'user-001', type: 'debit', amount: 1537.50, description: 'Escrow deposit for Content Writing Services', createdAt: '2024-12-01T15:00:00.000Z' },
  { id: 'led-013', transactionId: 'txn-006', userId: 'system', type: 'fee', amount: 37.50, description: 'Platform fee - Content Writing Services', createdAt: '2024-12-01T15:00:00.000Z' },
  { id: 'led-014', transactionId: 'txn-006', userId: 'user-001', type: 'refund', amount: 1537.50, description: 'Refund - Content Writing Services cancelled', createdAt: '2024-12-05T10:30:00.000Z' },

  // Transaction 007 - In Progress
  { id: 'led-015', transactionId: 'txn-007', userId: 'user-006', type: 'debit', amount: 3587.50, description: 'Escrow deposit for E-commerce Platform Setup', createdAt: '2025-01-05T09:00:00.000Z' },
  { id: 'led-016', transactionId: 'txn-007', userId: 'system', type: 'fee', amount: 87.50, description: 'Platform fee - E-commerce Platform Setup', createdAt: '2025-01-05T09:00:00.000Z' },

  // Transaction 008 - Refunded
  { id: 'led-017', transactionId: 'txn-008', userId: 'user-004', type: 'debit', amount: 12300.00, description: 'Escrow deposit for Cloud Infrastructure Setup', createdAt: '2024-08-10T14:00:00.000Z' },
  { id: 'led-018', transactionId: 'txn-008', userId: 'system', type: 'fee', amount: 300.00, description: 'Platform fee - Cloud Infrastructure Setup', createdAt: '2024-08-10T14:00:00.000Z' },
  { id: 'led-019', transactionId: 'txn-008', userId: 'user-004', type: 'refund', amount: 12300.00, description: 'Full refund - Cloud Infrastructure Setup', createdAt: '2024-09-01T10:00:00.000Z' }
];

/**
 * Sample Disputes Seed Data
 */
const seedDisputes = [
  {
    id: 'disp-001',
    transactionId: 'txn-004',
    initiatorId: 'user-006',
    respondentId: 'user-008',
    reason: 'non_delivery',
    description: 'Seller has not provided the initial architecture document as agreed.',
    status: 'open',
    resolution: null,
    createdAt: '2025-01-08T09:00:00.000Z'
  },
  {
    id: 'disp-002',
    transactionId: 'txn-008',
    initiatorId: 'user-004',
    respondentId: 'user-008',
    reason: 'quality_issues',
    description: 'Cloud setup was not secure, multiple critical vulnerabilities found.',
    status: 'resolved',
    resolution: 'refund_buyer',
    createdAt: '2024-08-25T11:00:00.000Z',
    updatedAt: '2024-09-01T10:00:00.000Z'
  }
];

/**
 * Sample Milestones Seed Data
 */
const seedMilestones = [
  // Transaction 001 - Website Development (Completed)
  { id: 'mil-001', transactionId: 'txn-001', sequence: 1, title: 'Design & Mockups', amount: 3000.00, status: 'completed', createdAt: '2024-11-01T09:00:00.000Z' },
  { id: 'mil-002', transactionId: 'txn-001', sequence: 2, title: 'Frontend Development', amount: 6000.00, status: 'completed', createdAt: '2024-11-01T09:00:00.000Z' },
  { id: 'mil-003', transactionId: 'txn-001', sequence: 3, title: 'Backend & Launch', amount: 6000.00, status: 'completed', createdAt: '2024-11-01T09:00:00.000Z' },

  // Transaction 007 - E-commerce Setup (In Progress)
  { id: 'mil-004', transactionId: 'txn-007', sequence: 1, title: 'Initial Store Setup', amount: 1000.00, status: 'completed', createdAt: '2025-01-05T09:00:00.000Z' },
  { id: 'mil-005', transactionId: 'txn-007', sequence: 2, title: 'Product Import & Categorization', amount: 1500.00, status: 'in_progress', createdAt: '2025-01-05T09:00:00.000Z' },
  { id: 'mil-006', transactionId: 'txn-007', sequence: 3, title: 'Payment Gateway Integration', amount: 1000.00, status: 'pending', createdAt: '2025-01-05T09:00:00.000Z' }
];

/**
 * Seeds all data stores with sample data
 * @param {boolean} clearFirst - Whether to clear existing data before seeding
 * @returns {object} Object containing counts of seeded items
 */
function seedAll(clearFirst = true) {
  // Clear existing data if requested
  if (clearFirst) {
    require('./store').clearAll();
  }

  // Seed users
  const users = seedUsers.map(userData => {
    // Override timestamps with seed date for consistency
    const user = {
      ...userData,
      createdAt: SEED_DATE,
      updatedAt: SEED_DATE
    };
    return userStore.create(user);
  });

  // Seed transactions
  const transactions = seedTransactions.map(txnData => {
    return transactionStore.create(txnData);
  });

  // Seed ledger entries
  const ledgers = seedLedgers.map(ledgerData => {
    return ledgerStore.create(ledgerData);
  });

  // Seed disputes
  const disputes = seedDisputes.map(disputeData => {
    return disputeStore.create(disputeData);
  });

  // Seed milestones
  const milestones = seedMilestones.map(milestoneData => {
    return milestoneStore.create(milestoneData);
  });

  return {
    users: users.length,
    transactions: transactions.length,
    ledgers: ledgers.length,
    disputes: disputes.length,
    milestones: milestones.length,
    totals: {
      users: users.length,
      transactions: transactions.length,
      ledgers: ledgers.length,
      disputes: disputes.length,
      milestones: milestones.length
    }
  };
}

/**
 * Seeds only users
 */
function seedUsersOnly() {
  require('./store').clearAll();
  return seedUsers.map(userData => {
    const user = {
      ...userData,
      createdAt: SEED_DATE,
      updatedAt: SEED_DATE
    };
    return userStore.create(user);
  });
}

/**
 * Seeds only transactions
 * @param {string[]} userIds - Optional array of user IDs to reference (defaults to first 2 seed users)
 */
function seedTransactionsOnly(userIds = ['user-001', 'user-002']) {
  return seedTransactions.map(txnData => {
    return transactionStore.create(txnData);
  });
}

/**
 * Seeds only ledger entries
 */
function seedLedgersOnly() {
  return seedLedgers.map(ledgerData => {
    return ledgerStore.create(ledgerData);
  });
}

/**
 * Get summary statistics of seed data
 */
function getSeedStats() {
  return {
    users: {
      total: seedUsers.length,
      buyers: seedUsers.filter(u => u.role === 'buyer').length,
      sellers: seedUsers.filter(u => u.role === 'seller').length,
      admins: seedUsers.filter(u => u.role === 'admin').length,
      verified: seedUsers.filter(u => u.kycStatus === 'verified').length
    },
    transactions: {
      total: seedTransactions.length,
      byStatus: {
        pending: seedTransactions.filter(t => t.status === 'pending').length,
        in_escrow: seedTransactions.filter(t => t.status === 'in_escrow').length,
        in_progress: seedTransactions.filter(t => t.status === 'in_progress').length,
        completed: seedTransactions.filter(t => t.status === 'completed').length,
        released: seedTransactions.filter(t => t.status === 'released').length,
        disputed: seedTransactions.filter(t => t.status === 'disputed').length,
        cancelled: seedTransactions.filter(t => t.status === 'cancelled').length,
        refunded: seedTransactions.filter(t => t.status === 'refunded').length
      },
      totalValue: seedTransactions.reduce((sum, t) => sum + t.amount, 0),
      totalFees: seedTransactions.reduce((sum, t) => sum + t.fee, 0)
    },
    ledgers: {
      total: seedLedgers.length,
      byType: {
        debit: seedLedgers.filter(l => l.type === 'debit').length,
        credit: seedLedgers.filter(l => l.type === 'credit').length,
        fee: seedLedgers.filter(l => l.type === 'fee').length,
        refund: seedLedgers.filter(l => l.type === 'refund').length,
        hold: seedLedgers.filter(l => l.type === 'hold').length
      }
    },
    disputes: {
      total: seedDisputes.length,
      byStatus: {
        open: seedDisputes.filter(d => d.status === 'open').length,
        resolved: seedDisputes.filter(d => d.status === 'resolved').length
      }
    },
    milestones: {
      total: seedMilestones.length,
      byStatus: {
        pending: seedMilestones.filter(m => m.status === 'pending').length,
        in_progress: seedMilestones.filter(m => m.status === 'in_progress').length,
        completed: seedMilestones.filter(m => m.status === 'completed').length
      }
    }
  };
}

module.exports = {
  seedAll,
  seedUsers,
  seedTransactions,
  seedLedgers,
  seedDisputes,
  seedMilestones,
  seedUsersOnly,
  seedTransactionsOnly,
  seedLedgersOnly,
  getSeedStats,
  SEED_DATE
};