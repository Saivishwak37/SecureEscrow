const { ValidationError } = require('../utils/errors');

const CATEGORIES = new Set([
  'NON_DELIVERY', 'INCOMPLETE_DELIVERY', 'QUALITY_ISSUE', 'PAYMENT_ISSUE',
  'CONDITION_NOT_FULFILLED', 'AGREEMENT_VIOLATION', 'OTHER',
]);
const REQUESTED_RESOLUTIONS = new Set([
  'RELEASE_TO_PROVIDER', 'REFUND_TO_CLIENT', 'PARTIAL_RELEASE', 'SPLIT_FUNDS', 'OTHER',
]);

function disputeInput(input = {}) {
  input ??= {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const reason = typeof input.description === 'string' ? input.description.trim() : '';
  if (!title) throw new ValidationError('Dispute title is required');
  if (!reason) throw new ValidationError('Dispute description is required');
  if (!CATEGORIES.has(input.category)) throw new ValidationError('A valid dispute category is required');
  if (!REQUESTED_RESOLUTIONS.has(input.requestedResolution)) throw new ValidationError('A valid requested resolution is required');
  if (title.length > 160) throw new ValidationError('Dispute title must be 160 characters or fewer');

  return { title, reason, category: input.category, requestedResolution: input.requestedResolution };
}

module.exports = { disputeInput, CATEGORIES, REQUESTED_RESOLUTIONS };
