// User Routes
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const rejectIdentitySpoof = require('../middleware/rejectIdentitySpoof');
const requireRole = require('../middleware/requireRole');

router.use(authenticate, rejectIdentitySpoof);

router.post('/', requireRole('ADMIN'), userController.createUser);
router.get('/', requireRole('CLIENT', 'PROVIDER', 'ADMIN'), userController.getAllUsers);
router.get('/:id', userController.getUserById);

module.exports = router;
