// Escrow Repository - Data access layer for escrows
const { getStore } = require('../data/store');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');
const escrowStatusHistoryRepository = require('./escrowStatusHistoryRepository');

function hasOpenDispute(escrowId) {
  return getStore().findByField('disputes', 'escrowId', escrowId).some(dispute => dispute.status === 'OPEN');
}

function rejectUnfreezeWhileDisputed(escrow, updates) {
  if (hasOpenDispute(escrow.id) && ((updates.status && updates.status !== 'DISPUTED') || updates.disputed === false)) {
    throw new ValidationError('An escrow cannot leave DISPUTED while an open dispute exists');
  }
}

/**
 * Create a new escrow
 * @param {Object} escrowData - { title, description, clientId, freelancerId, totalAmount, status }
 * @returns {Object} Created escrow
 */
function createEscrow({ title, description, clientId, freelancerId, payerId, payeeId, totalAmount, status = 'CREATED', releaseModel = 'MILESTONE_BASED', releasePolicy = 'ALL_REQUIRED', agreementType = 'GENERAL', terms = '', metadata = {}, participants = [] }) {
  const store = getStore();
  const escrow = {
    id: uuidv4(),
    title,
    description: description || '',
    clientId,
    freelancerId,
    payerId: payerId || clientId,
    payeeId: payeeId || freelancerId,
    totalAmount,
    releaseModel,
    releasePolicy,
    agreementType,
    terms,
    metadata,
    participants: participants.length ? participants : [
      { userId: payerId || clientId, role: 'PAYER' },
      { userId: payeeId || freelancerId, role: 'PAYEE' }
    ],
    disputed: false,
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
 * Get escrows assigned to a provider. The storage column retains its legacy name.
 * @param {string} providerId - Provider user ID
 * @returns {Array} Provider's escrows
 */
function getEscrowsByProviderId(providerId) {
  const store = getStore();
  return store.findByField('escrows', 'freelancerId', providerId);
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
  rejectUnfreezeWhileDisputed(escrow, { status: newStatus });
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
  rejectUnfreezeWhileDisputed(escrow, updates);
  return store.update('escrows', id, { ...updates, updatedAt: Date.now() });
}

/** Atomically record the dispute freeze transition in the synchronous in-memory store. */
function freezeEscrowForDispute(id, changedBy, reason) {
  const store = getStore();
  const escrow = getEscrowById(id);
  const history = escrowStatusHistoryRepository.createEscrowStatusHistory({
    escrowId: id, changedBy, fromStatus: escrow.status, toStatus: 'DISPUTED', reason,
  });
  try {
    const updatedEscrow = store.update('escrows', id, { status: 'DISPUTED', disputed: true });
    if (!updatedEscrow) throw new Error(`Escrow with id ${id} could not be updated`);
    return updatedEscrow;
  } catch (error) {
    escrowStatusHistoryRepository.deleteEscrowStatusHistory(history.id);
    throw error;
  }
}

module.exports = {
  createEscrow,
  getEscrowById,
  getAllEscrows,
  getEscrowsByClientId,
  getEscrowsByProviderId,
  updateEscrowStatus,
  updateEscrow,
  freezeEscrowForDispute
};
