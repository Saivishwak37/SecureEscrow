// Escrow Repository - Data access layer for escrows
const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new escrow
 * @param {Object} escrowData - { title, description, clientId, freelancerId, totalAmount, status }
 * @returns {Object} Created escrow
 */
function createEscrow({ title, description, clientId, freelancerId, totalAmount, status = 'CREATED' }) {
  const store = getStore();
  const escrow = {
    id: uuidv4(),
    title,
    description: description || '',
    clientId,
    freelancerId,
    totalAmount,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return store.add('escrows', escrow);
}

/**
 * Get escrow by ID
 * @param {string} id - Escrow ID
 * @returns {Object} Escrow
 * @throws {NotFoundError} If escrow not found
 */
function getEscrowById(id) {
  const store = getStore();
  const escrow = store.findById('escrows', id);
  if (!escrow) {
    throw new NotFoundError('Escrow', id);
  }
  return escrow;
}

/**
 * Get all escrows
 * @returns {Array} All escrows
 */
function getAllEscrows() {
  const store = getStore();
  return store.findAll('escrows');
}

/**
 * Get escrows by client ID
 * @param {string} clientId - Client user ID
 * @returns {Array} Client's escrows
 */
function getEscrowsByClientId(clientId) {
  const store = getStore();
  return store.findByField('escrows', 'clientId', clientId);
}

/**
 * Get escrows by freelancer ID
 * @param {string} freelancerId - Freelancer user ID
 * @returns {Array} Freelancer's escrows
 */
function getEscrowsByFreelancerId(freelancerId) {
  const store = getStore();
  return store.findByField('escrows', 'freelancerId', freelancerId);
}

/**
 * Update escrow status
 * @param {string} id - Escrow ID
 * @param {string} newStatus - New status
 * @returns {Object} Updated escrow
 */
function updateEscrowStatus(id, newStatus) {
  const store = getStore();
  const escrow = getEscrowById(id);
  return store.update('escrows', id, { status: newStatus, updatedAt: Date.now() });
}

/**
 * Update escrow fields
 * @param {string} id - Escrow ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated escrow
 */
function updateEscrow(id, updates) {
  const store = getStore();
  const escrow = getEscrowById(id);
  return store.update('escrows', id, { ...updates, updatedAt: Date.now() });
}

module.exports = {
  createEscrow,
  getEscrowById,
  getAllEscrows,
  getEscrowsByClientId,
  getEscrowsByFreelancerId,
  updateEscrowStatus,
  updateEscrow
};
