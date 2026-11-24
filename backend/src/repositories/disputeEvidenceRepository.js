const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError } = require('../utils/errors');

function createEvidence(data) {
  return getStore().add('disputeEvidence', { id: uuidv4(), ...data, createdAt: Date.now() });
}

function getEvidenceById(id) {
  const evidence = getStore().findById('disputeEvidence', id);
  if (!evidence) throw new NotFoundError('Dispute evidence', id);
  return evidence;
}

function getEvidenceByDisputeId(disputeId) {
  return getStore().findByField('disputeEvidence', 'disputeId', disputeId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

module.exports = { createEvidence, getEvidenceById, getEvidenceByDisputeId };
