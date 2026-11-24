const express = require('express');
const router = express.Router();
const controller = require('../controllers/accountController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

router.post('/', requireRole('CLIENT', 'PROVIDER'), controller.createAccount);
router.get('/user/:userId', controller.getAccountByUserId);
router.post('/:accountId/deposit', requireRole('CLIENT', 'PROVIDER'), controller.addFunds);
router.post('/:accountId/withdraw', requireRole('CLIENT', 'PROVIDER'), controller.withdrawFunds);
router.get('/:accountId/ledger', controller.getAccountLedger);
router.get('/:accountId/transactions', controller.getAccountTransactions);
router.get('/:accountId', controller.getAccountById);

module.exports = router;
