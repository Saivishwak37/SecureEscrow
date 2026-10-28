// Escrow Controller - HTTP handlers for escrow resources and lifecycle actions
const escrowService = require('../services/escrowService');
const milestoneService = require('../services/milestoneService');
const transactionService = require('../services/transactionService');
const ledgerService = require('../services/ledgerService');

async function createEscrow(req, res, next) {
  try {
    const escrow = escrowService.createEscrow(req.body);
    res.status(201).json({ success: true, data: escrow });
  } catch (err) { next(err); }
}

async function getEscrow(req, res, next) {
  try {
    res.json({ success: true, data: escrowService.getEscrow(req.params.id) });
  } catch (err) { next(err); }
}

async function getAllEscrows(req, res, next) {
  try {
    res.json({ success: true, data: escrowService.getAllEscrows() });
  } catch (err) { next(err); }
}

async function getValidActions(req, res, next) {
  try {
    res.json({ success: true, data: escrowService.getValidEscrowActions(req.params.id) });
  } catch (err) { next(err); }
}

async function fundEscrow(req, res, next) {
  try {
    const result = escrowService.fundEscrow(req.params.id, req.body.milestoneId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function startEscrow(req, res, next) {
  try {
    const result = escrowService.startEscrow(req.params.id, req.body.milestoneId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function getTransactions(req, res, next) {
  try {
    res.json({ success: true, data: transactionService.getTransactionsByEscrow(req.params.id) });
  } catch (err) { next(err); }
}

async function getLedger(req, res, next) {
  try {
    const transactions = transactionService.getTransactionsByEscrow(req.params.id);
    const ledger = transactions.flatMap(t => ledgerService.getLedgerEntriesByTransaction(t.id));
    res.json({ success: true, data: ledger });
  } catch (err) { next(err); }
}

module.exports = {
  createEscrow, getEscrow, getAllEscrows, getValidActions,
  fundEscrow, startEscrow, getTransactions, getLedger
};
