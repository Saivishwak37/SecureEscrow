const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function createMessage(data) {
  const now = Date.now();
  return getStore().add('disputeMessages', { id: uuidv4(), ...data, createdAt: now });
}

function getMessagesByDisputeId(disputeId) {
  return getStore().findByField('disputeMessages', 'disputeId', disputeId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

module.exports = { createMessage, getMessagesByDisputeId };
