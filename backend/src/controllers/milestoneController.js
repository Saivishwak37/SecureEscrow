// Milestone Controller - HTTP handlers for milestone resources and lifecycle actions
const milestoneService = require('../services/milestoneService');
const resourceAuthorization = require('../services/resourceAuthorization');

async function createMilestone(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.escrowId, req.auth, { roles: ['CLIENT'] });
    const milestone = milestoneService.createMilestone({
      ...req.body,
      escrowId: req.params.escrowId,
      actorId: req.auth.userId
    });
    res.status(201).json({ success: true, data: milestone });
  } catch (err) { next(err); }
}

async function getMilestone(req, res, next) {
  try {
    resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth);
    res.json({ success: true, data: milestoneService.getMilestone(req.params.id) });
  } catch (err) { next(err); }
}

async function getMilestonesByEscrow(req, res, next) {
  try {
    resourceAuthorization.assertEscrowAccess(req.params.escrowId, req.auth);
    res.json({ success: true, data: milestoneService.getMilestonesByEscrow(req.params.escrowId) });
  } catch (err) { next(err); }
}

async function getValidActions(req, res, next) {
  try {
    resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth);
    res.json({ success: true, data: milestoneService.getValidMilestoneActions(req.params.id) });
  } catch (err) { next(err); }
}

async function submit(req, res, next) {
  try { resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth, { roles: ['PROVIDER'] }); res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.SUBMIT, req.auth.userId, req.body) }); }
  catch (err) { next(err); }
}

async function review(req, res, next) {
  try { resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.REVIEW, req.auth.userId) }); }
  catch (err) { next(err); }
}

async function approve(req, res, next) {
  try { resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.APPROVE, req.auth.userId) }); }
  catch (err) { next(err); }
}

async function reject(req, res, next) {
  try { resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.REJECT, req.auth.userId, req.body) }); }
  catch (err) { next(err); }
}

module.exports = {
  createMilestone,
  getMilestone,
  getMilestonesByEscrow,
  getValidActions,
  submit,
  review,
  approve,
  reject,
  release: async (req, res, next) => {
    try {
      resourceAuthorization.assertMilestoneAccess(req.params.id, req.auth, { roles: ['CLIENT'] });
      const result = milestoneService.releaseMilestone(req.params.id, req.auth.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
};
