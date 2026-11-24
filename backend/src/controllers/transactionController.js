// Transaction Controller - HTTP handlers for transaction resources

const transactionService = require('../services/transactionService');
const ledgerService = require('../services/ledgerService');
const resourceAuthorization = require('../services/resourceAuthorization');

function getTransaction(req, res, next) {
  try {
    resourceAuthorization.assertTransactionAccess(req.params.id, req.auth);
    res.json({
      success: true,
      data: transactionService.getTransactionById(req.params.id)
    });
  } catch (err) {
    next(err);
  }
}

async function getTransactionsByEscrow(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.escrowId, req.auth, { allowAdmin: true });
    res.json({
      success: true,
      data: transactionService.getTransactionsByEscrow(req.params.escrowId)
    });
  } catch (err) {
    next(err);
  }
}

async function getTransactionLedger(req, res, next) {
  try {
    resourceAuthorization.assertTransactionAccess(req.params.id, req.auth);
    res.json({
      success: true,
      data: ledgerService.getLedgerEntriesByTransaction(req.params.id)
    });
  } catch (err) {
    next(err);
  }
}

async function validateLedger(req, res, next) {
  try {
    res.json({
      success: true,
      data: ledgerService.validateAllLedgers()
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTransaction,
  getTransactionsByEscrow,
  getTransactionLedger,
  validateLedger
};
