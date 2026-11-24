const express = require('express');

const router = express.Router();

const transactionController = require('../controllers/transactionController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

// Validate complete ledger
router.get(
  '/validation/ledger',
  requireRole('ADMIN'),
  transactionController.validateLedger
);

// Get transactions for an escrow
router.get(
  '/escrow/:escrowId',
  transactionController.getTransactionsByEscrow
);

// Get ledger entries for a transaction
router.get(
  '/:id/ledger',
  transactionController.getTransactionLedger
);

// Get a transaction
router.get(
  '/:id',
  transactionController.getTransaction
);

module.exports = router;
