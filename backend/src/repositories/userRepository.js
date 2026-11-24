// User Repository - Data access layer for users
const { getStore } = require('../data/store');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');
const { createUserRecord, toPublicUser: toCredentialPublicUser } = require('../models/user');

/** Persist a credential-backed User. The caller must hash the password first. */
function createCredentialUser(userData) {
  const store = getStore();
  const username = typeof userData?.username === 'string' ? userData.username.trim() : '';
  const email = typeof userData?.email === 'string' ? userData.email.trim().toLowerCase() : '';
  if (store.users.some(user => typeof user.username === 'string' && user.username.toLowerCase() === username.toLowerCase())) {
    throw new ConflictError('Username is already in use');
  }
  if (store.users.some(user => typeof user.email === 'string' && user.email.toLowerCase() === email)) {
    throw new ConflictError('Email is already in use');
  }

  const user = createUserRecord({ ...userData, id: userData.id || uuidv4(), username, email });
  store.users.push(user);
  return toCredentialPublicUser(user);
}

/** Internal credential lookup. Do not pass this result to an API response. */
function findCredentialUserByEmail(email) {
  if (typeof email !== 'string') return null;
  return getStore().users.find(user => typeof user.email === 'string' && user.email.toLowerCase() === email.trim().toLowerCase()) || null;
}

/** Internal credential lookup. Do not pass this result to an API response. */
function findCredentialUserByUsername(username) {
  if (typeof username !== 'string') return null;
  return getStore().users.find(user => typeof user.username === 'string' && user.username.toLowerCase() === username.trim().toLowerCase()) || null;
}

function getCredentialUserById(id) {
  const user = getStore().findById('users', id);
  if (!user || !Object.prototype.hasOwnProperty.call(user, 'passwordHash')) {
    throw new NotFoundError('User', id);
  }
  return toCredentialPublicUser(user);
}

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
    type, // 'CLIENT', 'PROVIDER', or 'ADMIN'
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
  return toPublicUser(user);
}

/**
 * Get all users
 * @returns {Array} All users
 */
function getAllUsers() {
  const store = getStore();
  return store.findAll('users').map(toPublicUser);
}

function toPublicUser(user) {
  if (!user) return user;
  if (Object.prototype.hasOwnProperty.call(user, 'passwordHash')) {
    return toCredentialPublicUser(user);
  }
  const { username, password, ...publicUser } = user;
  return publicUser;
}

function authenticate(username, password) {
  const user = getStore().users.find(item => item.username === username && item.password === password);
  return user ? toPublicUser(user) : null;
}

/**
 * Get users by any field
 * @param {string} field - Field name
 * @param {any} value - Field value
 * @returns {Array} Matching users
 */
function getUserByField(field, value) {
  const store = getStore();
  return store.findByField('users', field, value).map(toPublicUser);
}

module.exports = {
  createCredentialUser,
  findCredentialUserByEmail,
  findCredentialUserByUsername,
  getCredentialUserById,
  createUser,
  getUserById,
  getAllUsers,
  getUserByField,
  authenticate
};
