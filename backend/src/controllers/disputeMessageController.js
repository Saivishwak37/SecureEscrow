const service = require('../services/disputeMessageService');
const resourceAuthorization = require('../services/resourceAuthorization');

function send(req, res, next) {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth, { allowAdmin: false });
    const message = service.sendMessage(req.params.disputeId, req.auth.userId, req.body?.message);
    res.status(201).json({ success: true, data: message });
  } catch (error) { next(error); }
}

function list(req, res, next) {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth);
    const messages = service.listMessages(req.params.disputeId, req.auth.userId);
    res.json({ success: true, data: messages });
  } catch (error) { next(error); }
}

module.exports = { send, list };
