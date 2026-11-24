const express = require('express');
const router = express.Router();
const controller = require('../controllers/disputeEvidenceController');
const { uploadDisputeEvidence } = require('../middleware/disputeEvidenceUpload');
const messageController = require('../controllers/disputeMessageController');
const resolutionController = require('../controllers/disputeResolutionController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');
const resourceAuthorization = require('../services/resourceAuthorization');

router.use(authenticate, rejectIdentitySpoof);

router.post('/:disputeId/resolve', requireRole('ADMIN'), resolutionController.resolve);
router.patch('/:disputeId/status', requireRole('ADMIN'), resolutionController.changeStatus);
router.get('/:disputeId/history', resolutionController.history);
router.get('/:disputeId/resolutions', resolutionController.resolutions);
router.post('/:disputeId/messages', requireRole('CLIENT', 'PROVIDER'), messageController.send);
router.get('/:disputeId/messages', messageController.list);
router.post('/:disputeId/evidence', requireRole('CLIENT', 'PROVIDER'), (req, res, next) => {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth, { allowAdmin: false });
    next();
  } catch (error) { next(error); }
}, uploadDisputeEvidence, rejectIdentitySpoof, controller.upload);
router.get('/:disputeId/evidence', controller.list);
router.get('/:disputeId/evidence/:evidenceId/file', controller.download);

module.exports = router;
