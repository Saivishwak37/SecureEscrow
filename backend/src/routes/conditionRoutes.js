const express = require('express');
const router = express.Router();
const controller = require('../controllers/conditionController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

router.post('/:id/satisfy', controller.satisfy);
router.post('/:id/review', requireRole('CLIENT'), controller.review);
router.patch('/:id', requireRole('CLIENT'), controller.update);
router.delete('/:id', requireRole('CLIENT'), controller.remove);

module.exports = router;
