const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function createDispute({ escrowId, milestoneId = null, raisedBy, title, category, reason, requestedResolution }) {
  const now = Date.now();
  return getStore().add('disputes', {
    id: uuidv4(), escrowId, milestoneId, raisedBy,
    title, category, reason, requestedResolution, status: 'OPEN',
    resolvedAt: null, createdAt: now, updatedAt: now,
  });
}

function getDisputesByEscrowId(escrowId) {
  return getStore().findByField('disputes', 'escrowId', escrowId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function getDisputeById(id) {
  const dispute = getStore().findById('disputes', id);
  if (!dispute) throw new (require('../utils/errors').NotFoundError)('Dispute', id);
  return dispute;
}

function deleteDispute(id) {
  return getStore().delete('disputes', id);
}

function updateDispute(id, updates) {
  return getStore().update('disputes', id, updates);
}

module.exports = { createDispute, getDisputeById, getDisputesByEscrowId, deleteDispute, updateDispute };
