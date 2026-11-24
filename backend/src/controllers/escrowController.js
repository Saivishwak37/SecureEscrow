// Escrow Controller - HTTP handlers for escrow resources and lifecycle actions
const escrowService = require('../services/escrowService');
const milestoneService = require('../services/milestoneService');
const transactionService = require('../services/transactionService');
const ledgerService = require('../services/ledgerService');
const disputeService = require('../services/disputeService');
const resourceAuthorization = require('../services/resourceAuthorization');
const userRepository = require('../repositories/userRepository');
const { ValidationError } = require('../utils/errors');

async function createEscrow(req, res, next) {
  try {
    const providerId = req.body?.providerId || req.body?.freelancerId || req.body?.payeeId;
    const provider = userRepository.getCredentialUserById(providerId);
    if (provider.role !== 'PROVIDER' || provider.isActive !== true) {
      throw new ValidationError('The selected Provider must be an active Provider account');
    }
    const escrow = escrowService.createEscrow({
      ...req.body,
      clientId: req.auth.userId,
      payerId: req.auth.userId,
      freelancerId: providerId,
      payeeId: providerId,
      participants: [{ userId: req.auth.userId, role: 'PAYER' }, { userId: providerId, role: 'PAYEE' }]
    });
    res.status(201).json({ success: true, data: escrow });
  } catch (err) { next(err); }
}

async function getEscrow(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.id, req.auth, { allowAdmin: true });
    res.json({ success: true, data: escrowService.getEscrow(req.params.id) });
  } catch (err) { next(err); }
}

async function getAllEscrows(req, res, next) {
  try {
    const escrows = req.auth.role === 'ADMIN'
      ? escrowService.getAllEscrows()
      : req.auth.role === 'CLIENT'
        ? escrowService.getEscrowsByClient(req.auth.userId)
        : escrowService.getEscrowsByProvider(req.auth.userId);
    res.json({ success: true, data: escrows });
  } catch (err) { next(err); }
}

async function getValidActions(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.id, req.auth);
    res.json({ success: true, data: escrowService.getValidEscrowActions(req.params.id) });
  } catch (err) { next(err); }
}

async function fundEscrow(req, res, next) {
  try {
    const result = escrowService.fundEscrow(req.params.id, req.body?.milestoneId, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function startEscrow(req, res, next) {
  try {
    const result = escrowService.startEscrow(req.params.id, req.body?.milestoneId, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function getTransactions(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.id, req.auth, { allowAdmin: true });
    res.json({ success: true, data: transactionService.getTransactionsByEscrow(req.params.id) });
  } catch (err) { next(err); }
}

async function getLedger(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.id, req.auth, { allowAdmin: true });
    const transactions = transactionService.getTransactionsByEscrow(req.params.id);
    const ledger = transactions.flatMap(t => ledgerService.getLedgerEntriesByTransaction(t.id));
    res.json({ success: true, data: ledger });
  } catch (err) { next(err); }
}

async function getReleaseEligibility(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth); res.json({ success: true, data: escrowService.getReleaseEligibility(req.params.id) }); }
  catch (err) { next(err); }
}

async function satisfyCondition(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth); res.json({ success: true, data: escrowService.satisfyCondition(req.params.id, req.params.type, req.auth.userId) }); }
  catch (err) { next(err); }
}

async function releaseConditionEscrow(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: escrowService.releaseConditionEscrow(req.params.id, req.auth.userId) }); }
  catch (err) { next(err); }
}

async function raiseDispute(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth); res.status(201).json({ success: true, data: disputeService.createDispute(req.params.id, req.auth.userId, req.body) }); }
  catch (err) { next(err); }
}

async function getDisputes(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth); res.json({ success: true, data: disputeService.getDisputesByEscrow(req.params.id) }); }
  catch (err) { next(err); }
}

async function resolveDispute(req, res, next) {
  try { res.json({ success: true, data: escrowService.resolveDispute(req.params.id, req.auth.userId, req.body?.resolution || '') }); }
  catch (err) { next(err); }
}

async function getConditions(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth); res.json({ success: true, data: escrowService.getConditions(req.params.id) }); }
  catch (err) { next(err); }
}

async function createCondition(req, res, next) {
  try { resourceAuthorization.assertEscrowAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.status(201).json({ success: true, data: escrowService.createCondition(req.params.id, req.body, req.auth.userId) }); }
  catch (err) { next(err); }
}

module.exports = {
  createEscrow, getEscrow, getAllEscrows, getValidActions,
  fundEscrow, startEscrow, getTransactions, getLedger, getReleaseEligibility, satisfyCondition, releaseConditionEscrow, raiseDispute, getDisputes, resolveDispute, getConditions, createCondition
};
