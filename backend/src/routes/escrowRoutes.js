const express = require('express');
const router = express.Router();
const controller = require('../controllers/escrowController');
const milestoneController = require('../controllers/milestoneController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

router.post('/', requireRole('CLIENT'), controller.createEscrow);
router.post('/:escrowId/milestones', requireRole('CLIENT'), milestoneController.createMilestone);
router.get('/:escrowId/milestones', milestoneController.getMilestonesByEscrow);
router.get('/', controller.getAllEscrows);
router.get('/:id/actions', controller.getValidActions);
router.get('/:id/release-eligibility', controller.getReleaseEligibility);
router.get('/:id/conditions', controller.getConditions);
router.post('/:id/conditions', requireRole('CLIENT'), controller.createCondition);
router.post('/:id/conditions/:type/satisfy', controller.satisfyCondition);
router.post('/:id/release', requireRole('CLIENT'), controller.releaseConditionEscrow);
router.post('/:id/disputes', controller.raiseDispute);
router.get('/:id/disputes', controller.getDisputes);
router.post('/:id/fund', requireRole('CLIENT'), controller.fundEscrow);
router.post('/:id/start', requireRole('PROVIDER'), controller.startEscrow);
router.get('/:id/transactions', controller.getTransactions);
router.get('/:id/ledger', controller.getLedger);
router.get('/:id', controller.getEscrow);

module.exports = router;
