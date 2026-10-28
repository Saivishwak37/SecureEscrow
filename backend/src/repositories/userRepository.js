// User Repository - Data access layer for users
const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new user
 * @param {Object} userData - { name, type }
 * @returns {Object} Created user
 */
function createUser({ name, type }) {
  const store = getStore();
  const user = {
    id: uuidv4(),
    name,
    type, // 'CLIENT' or 'FREELANCER'
    createdAt: Date.now()
  };
  return store.add('users', user);
}

/**
 * Get user by ID
 * @param {string} id - User ID
 * @returns {Object} User
 * @throws {NotFoundError} If user not found
 */
function getUserById(id) {
  const store = getStore();
  const user = store.findById('users', id);
  if (!user) {
    throw new NotFoundError('User', id);
  }
  return user;
}

/**
 * Get all users
 * @returns {Array} All users
 */
function getAllUsers() {
  const store = getStore();
  return store.findAll('users');
}

/**
 * Get users by any field
 * @param {string} field - Field name
 * @param {any} value - Field value
 * @returns {Array} Matching users
 */
function getUserByField(field, value) {
  const store = getStore();
  return store.findByField('users', field, value);
}

module.exports = {
  createUser,
  getUserById,
  getAllUsers,
  getUserByField
};
