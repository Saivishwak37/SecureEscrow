const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function createResolution(data) {
  return getStore().add('disputeResolutions', { id: uuidv4(), ...data, createdAt: Date.now() });
}
function createAllocation(data) {
  return getStore().add('disputeResolutionAllocations', { id: uuidv4(), ...data });
}
function getResolutionById(id) { return getStore().findById('disputeResolutions', id) || null; }
function getResolutionsByDisputeId(disputeId) {
  return getStore().findByField('disputeResolutions', 'disputeId', disputeId).sort((a, b) => a.createdAt - b.createdAt);
}
function getResolutionByIdempotencyKey(disputeId, key) {
  return getStore().findByField('disputeResolutions', 'disputeId', disputeId).find(item => item.idempotencyKey === key) || null;
}
function getAllocationsByResolutionId(resolutionId) {
  return getStore().findByField('disputeResolutionAllocations', 'resolutionId', resolutionId);
}
module.exports = { createResolution, createAllocation, getResolutionById, getResolutionsByDisputeId, getResolutionByIdempotencyKey, getAllocationsByResolutionId };
