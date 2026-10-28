const express = require('express');
const router = express.Router();
const controller = require('../controllers/milestoneController');

router.get('/:id/actions', controller.getValidActions);
router.post('/:id/submit', controller.submit);
router.post('/:id/review', controller.review);
router.post('/:id/approve', controller.approve);
router.post('/:id/release', controller.release);
router.get('/:id', controller.getMilestone);

module.exports = router;
