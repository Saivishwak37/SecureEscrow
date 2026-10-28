const express = require('express');

const router = express.Router();

const transactionController = require('../controllers/transactionController');

// Validate complete ledger
router.get(
  '/validation/ledger',
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