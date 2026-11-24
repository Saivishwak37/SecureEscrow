const escrowService = require('../services/escrowService');
const resourceAuthorization = require('../services/resourceAuthorization');

function update(req, res, next) {
  try { resourceAuthorization.assertConditionAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: escrowService.updateCondition(req.params.id, req.body, req.auth.userId) }); }
  catch (err) { next(err); }
}

function remove(req, res, next) {
  try { resourceAuthorization.assertConditionAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: escrowService.deleteCondition(req.params.id, req.auth.userId) }); }
  catch (err) { next(err); }
}

function satisfy(req, res, next) {
  try { resourceAuthorization.assertConditionAccess(req.params.id, req.auth); res.json({ success: true, data: escrowService.satisfyConditionById(req.params.id, req.auth.userId, req.body?.evidence) }); }
  catch (err) { next(err); }
}

function review(req, res, next) {
  try { resourceAuthorization.assertConditionAccess(req.params.id, req.auth, { roles: ['CLIENT'] }); res.json({ success: true, data: escrowService.reviewWorkCondition(req.params.id, req.auth.userId, req.body?.decision, req.body?.feedback || '') }); }
  catch (err) { next(err); }
}

module.exports = { update, remove, satisfy, review };
