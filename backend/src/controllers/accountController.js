// Account Controller - HTTP handlers for Account resources
const accountService = require('../services/accountService');
const ledgerService = require('../services/ledgerService');
const resourceAuthorization = require('../services/resourceAuthorization');

async function createAccount(req, res, next) {
  try {
    const account = accountService.createAccountForUser({ ...req.body, userId: req.auth.userId });
    res.status(201).json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountByUserId(req, res, next) {
  try {
    const userId = req.params.userId;
    if (req.auth.role !== 'ADMIN' && userId !== req.auth.userId) throw new (require('../utils/errors').UnauthorizedError)('You are not authorized to access this account');
    const account = accountService.getAccountByUserId(userId);
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountById(req, res, next) {
  try {
    resourceAuthorization.assertAccountAccess(req.params.accountId, req.auth);
    const account = accountService.getAccountDetails(req.params.accountId);
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountLedger(req, res, next) {
  try {
    resourceAuthorization.assertAccountAccess(req.params.accountId, req.auth);
    const entries = ledgerService.getAccountLedger(req.params.accountId);
    res.json({ success: true, data: entries });
  } catch (err) { next(err); }
}

async function addFunds(req, res, next) {
  try {
    resourceAuthorization.assertAccountAccess(req.params.accountId, req.auth, { allowAdmin: false });
    const result = accountService.addFunds(req.params.accountId, req.auth.userId, req.body?.amount);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function withdrawFunds(req, res, next) {
  try {
    resourceAuthorization.assertAccountAccess(req.params.accountId, req.auth, { allowAdmin: false });
    const result = accountService.withdrawFunds(req.params.accountId, req.auth.userId, req.body?.amount);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

async function getAccountTransactions(req, res, next) {
  try {
    resourceAuthorization.assertAccountAccess(req.params.accountId, req.auth);
    res.json({ success: true, data: accountService.getAccountTransactions(req.params.accountId) });
  } catch (err) { next(err); }
}

module.exports = { createAccount, getAccountByUserId, getAccountById, getAccountLedger, addFunds, withdrawFunds, getAccountTransactions };
