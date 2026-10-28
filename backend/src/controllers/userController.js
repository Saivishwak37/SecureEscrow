// User Controller - HTTP handlers for User resources
const userRepository = require('../repositories/userRepository');

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
    const users = userRepository.getAllUsers();
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
