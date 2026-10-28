// Milestone Controller - HTTP handlers for milestone resources and lifecycle actions
const milestoneService = require('../services/milestoneService');

async function createMilestone(req, res, next) {
  try {
    const milestone = milestoneService.createMilestone({
      ...req.body,
      escrowId: req.params.escrowId
    });
    res.status(201).json({ success: true, data: milestone });
  } catch (err) { next(err); }
}

async function getMilestone(req, res, next) {
  try {
    res.json({ success: true, data: milestoneService.getMilestone(req.params.id) });
  } catch (err) { next(err); }
}

async function getMilestonesByEscrow(req, res, next) {
  try {
    res.json({ success: true, data: milestoneService.getMilestonesByEscrow(req.params.escrowId) });
  } catch (err) { next(err); }
}

async function getValidActions(req, res, next) {
  try {
    res.json({ success: true, data: milestoneService.getValidMilestoneActions(req.params.id) });
  } catch (err) { next(err); }
}

async function submit(req, res, next) {
  try { res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.SUBMIT) }); }
  catch (err) { next(err); }
}

async function review(req, res, next) {
  try { res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.REVIEW) }); }
  catch (err) { next(err); }
}

async function approve(req, res, next) {
  try { res.json({ success: true, data: milestoneService.updateMilestoneStatus(req.params.id, milestoneService.ACTIONS.APPROVE) }); }
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
  release: async (req, res, next) => {
    try {
      const result = milestoneService.releaseMilestone(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
};
