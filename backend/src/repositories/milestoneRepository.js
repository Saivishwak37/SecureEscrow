// Milestone Repository - Data access layer for milestones
const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new milestone
 * @param {Object} milestoneData - { escrowId, title, description, amount, status, order }
 * @returns {Object} Created milestone
 */
function createMilestone({ escrowId, title, description, amount, status = 'CREATED', order }) {
  const store = getStore();
  const milestone = {
    id: uuidv4(),
    escrowId,
    title,
    description: description || '',
    amount,
    status,
    order: order || (getMilestonesByEscrowId(escrowId).length + 1),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return store.add('milestones', milestone);
}

/**
 * Get milestone by ID
 * @param {string} id - Milestone ID
 * @returns {Object} Milestone
 * @throws {NotFoundError} If milestone not found
 */
function getMilestoneById(id) {
  const store = getStore();
  const milestone = store.findById('milestones', id);
  if (!milestone) {
    throw new NotFoundError('Milestone', id);
  }
  return milestone;
}

/**
 * Get all milestones
 * @returns {Array} All milestones
 */
function getAllMilestones() {
  const store = getStore();
  return store.findAll('milestones');
}

/**
 * Get milestones by escrow ID
 * @param {string} escrowId - Escrow ID
 * @returns {Array} Escrow's milestones, sorted by order
 */
function getMilestonesByEscrowId(escrowId) {
  const store = getStore();
  const milestones = store.findByField('milestones', 'escrowId', escrowId);
  return milestones.sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Update milestone status
 * @param {string} id - Milestone ID
 * @param {string} newStatus - New status
 * @returns {Object} Updated milestone
 */
function updateMilestoneStatus(id, newStatus) {
  return updateMilestone(id, { status: newStatus, updatedAt: Date.now() });
}

/**
 * Update milestone fields
 * @param {string} id - Milestone ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated milestone
 */
function updateMilestone(id, updates) {
  const store = getStore();
  const milestone = getMilestoneById(id);
  return store.update('milestones', id, { ...updates, updatedAt: Date.now() });
}

module.exports = {
  createMilestone,
  getMilestoneById,
  getAllMilestones,
  getMilestonesByEscrowId,
  updateMilestoneStatus,
  updateMilestone
};
