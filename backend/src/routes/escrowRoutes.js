const express = require('express');
const router = express.Router();
const controller = require('../controllers/escrowController');
const milestoneController = require('../controllers/milestoneController');

router.post('/', controller.createEscrow);
router.post('/:escrowId/milestones', milestoneController.createMilestone);
router.get('/:escrowId/milestones', milestoneController.getMilestonesByEscrow);
router.get('/', controller.getAllEscrows);
router.get('/:id/actions', controller.getValidActions);
router.post('/:id/fund', controller.fundEscrow);
router.post('/:id/start', controller.startEscrow);
router.get('/:id/transactions', controller.getTransactions);
router.get('/:id/ledger', controller.getLedger);
router.get('/:id', controller.getEscrow);

module.exports = router;
