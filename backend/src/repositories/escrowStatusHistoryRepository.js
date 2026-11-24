const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function createEscrowStatusHistory({ escrowId, changedBy, fromStatus, toStatus, reason }) {
  return getStore().add('escrowStatusHistory', {
    id: uuidv4(), escrowId, changedBy, fromStatus, toStatus, reason,
    createdAt: Date.now(),
  });
}

function getEscrowStatusHistory(escrowId) {
  return getStore().findByField('escrowStatusHistory', 'escrowId', escrowId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function deleteEscrowStatusHistory(id) {
  return getStore().delete('escrowStatusHistory', id);
}

module.exports = { createEscrowStatusHistory, getEscrowStatusHistory, deleteEscrowStatusHistory };
