const express = require('express');
const router = express.Router();
const controller = require('../controllers/milestoneController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

router.get('/:id/actions', controller.getValidActions);
router.post('/:id/submit', requireRole('PROVIDER'), controller.submit);
router.post('/:id/review', requireRole('CLIENT'), controller.review);
router.post('/:id/approve', requireRole('CLIENT'), controller.approve);
router.post('/:id/reject', requireRole('CLIENT'), controller.reject);
router.post('/:id/release', requireRole('CLIENT'), controller.release);
router.get('/:id', controller.getMilestone);

module.exports = router;
