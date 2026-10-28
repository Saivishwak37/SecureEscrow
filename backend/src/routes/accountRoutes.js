const express = require('express');
const router = express.Router();
const controller = require('../controllers/accountController');

router.post('/', controller.createAccount);
router.get('/user/:userId', controller.getAccountByUserId);
router.get('/:accountId/ledger', controller.getAccountLedger);
router.get('/:accountId', controller.getAccountById);

module.exports = router;
