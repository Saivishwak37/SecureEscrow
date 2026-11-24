const service = require('../services/disputeResolutionService');
const resourceAuthorization = require('../services/resourceAuthorization');

function resolve(req, res, next) {
  try { res.status(201).json({ success: true, data: service.resolveDispute(req.params.disputeId, { ...(req.body || {}), actorId: req.auth.userId }) }); }
  catch (error) { next(error); }
}
function changeStatus(req, res, next) {
  try { res.json({ success: true, data: service.changeDisputeStatus(req.params.disputeId, req.auth.userId, req.body?.status, req.body?.reason) }); }
  catch (error) { next(error); }
}
function history(req, res, next) {
  try { res.json({ success: true, data: service.getStatusHistory(req.params.disputeId, req.auth.userId) }); }
  catch (error) { next(error); }
}
function resolutions(req, res, next) {
  try { res.json({ success: true, data: service.getResolutions(req.params.disputeId, req.auth.userId) }); }
  catch (error) { next(error); }
}
module.exports = { resolve, changeStatus, history, resolutions };
