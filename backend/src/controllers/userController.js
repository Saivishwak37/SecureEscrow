// User Controller - HTTP handlers for User resources
const userRepository = require('../repositories/userRepository');
const escrowRepository = require('../repositories/escrowRepository');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Create a new user
 * POST /api/users
 */
async function createUser(req, res, next) {
  try {
    const { name, type } = req.body;
    const user = userRepository.createUser({ name, type });
    res.status(201).json({
      success: true,
      data: user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get user by ID
 * GET /api/users/:id
 */
async function getUserById(req, res, next) {
  try {
    const { id } = req.params;
    const user = userRepository.getUserById(id);
    if (req.auth.role !== 'ADMIN' && id !== req.auth.userId) {
      const userRole = user.role || user.type;
      const isPublicProvider = req.auth.role === 'CLIENT' && userRole === 'PROVIDER';
      const sharesEscrow = req.auth.role === 'PROVIDER'
        && escrowRepository.getEscrowsByProviderId(req.auth.userId).some(escrow => (escrow.clientId || escrow.payerId) === id);
      if (!isPublicProvider && !sharesEscrow) throw new UnauthorizedError('You are not authorized to access this user profile');
    }
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get all users
 * GET /api/users
 */
async function getAllUsers(req, res, next) {
  try {
    const allUsers = userRepository.getAllUsers();
    const users = req.auth.role === 'ADMIN'
      ? allUsers
      : req.auth.role === 'CLIENT'
        ? allUsers.filter(user => user.role === 'PROVIDER' && user.isActive !== false)
        : (() => {
          const clientIds = new Set(escrowRepository.getEscrowsByProviderId(req.auth.userId).map(escrow => escrow.clientId || escrow.payerId));
          clientIds.add(req.auth.userId);
          return allUsers.filter(user => clientIds.has(user.id));
        })();
    res.status(200).json({
      success: true,
      data: users
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createUser,
  getUserById,
  getAllUsers
};
