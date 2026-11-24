const { getStore } = require('../data/store');
const { v4: uuidv4 } = require('uuid');

function createHistory(entry) {
  return getStore().add('disputeStatusHistory', { id: uuidv4(), ...entry, createdAt: Date.now() });
}
function getHistoryByDisputeId(disputeId) {
  return getStore().findByField('disputeStatusHistory', 'disputeId', disputeId).sort((a, b) => a.createdAt - b.createdAt);
}
module.exports = { createHistory, getHistoryByDisputeId };
