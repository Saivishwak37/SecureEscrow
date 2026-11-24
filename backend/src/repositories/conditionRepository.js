const { getStore } = require('../data/store');
const { NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

function createCondition({ escrowId, title, description = '', type, config = {}, required = true }) {
  const now = Date.now();
  return getStore().add('conditions', {
    id: uuidv4(), escrowId, title, description, type, config, required,
    status: 'PENDING', satisfiedAt: null, satisfiedBy: null, verificationDetails: null,
    createdAt: now, updatedAt: now,
  });
}

function getConditionById(id) {
  const condition = getStore().findById('conditions', id);
  if (!condition) throw new NotFoundError('Condition', id);
  return condition;
}

function getConditionsByEscrowId(escrowId) {
  return getStore().findByField('conditions', 'escrowId', escrowId).sort((a, b) => a.createdAt - b.createdAt);
}

function updateCondition(id, updates) {
  getConditionById(id);
  return getStore().update('conditions', id, { ...updates, updatedAt: Date.now() });
}

function deleteCondition(id) {
  getConditionById(id);
  return getStore().delete('conditions', id);
}

module.exports = { createCondition, getConditionById, getConditionsByEscrowId, updateCondition, deleteCondition };
