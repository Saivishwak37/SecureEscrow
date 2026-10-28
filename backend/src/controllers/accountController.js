// Account Controller - HTTP handlers for Account resources
const accountService = require('../services/accountService');
const ledgerService = require('../services/ledgerService');

async function createAccount(req, res, next) {
  try {
    const account = accountService.createAccountForUser(req.body);
    res.status(201).json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountByUserId(req, res, next) {
  try {
    const account = accountService.getAccountByUserId(req.params.userId);
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountById(req, res, next) {
  try {
    const account = accountService.getAccountDetails(req.params.accountId);
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

async function getAccountLedger(req, res, next) {
  try {
    const entries = ledgerService.getAccountLedger(req.params.accountId);
    res.json({ success: true, data: entries });
  } catch (err) { next(err); }
}

module.exports = { createAccount, getAccountByUserId, getAccountById, getAccountLedger };
