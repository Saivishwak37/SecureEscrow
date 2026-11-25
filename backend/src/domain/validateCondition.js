const { ValidationError } = require('../utils/errors');

const TYPES = new Set([
  'CLIENT_APPROVAL', 'WORK_SUBMITTED', 'DEADLINE_REACHED', 'PARTICIPANT_APPROVAL',
  'EVIDENCE_SUBMITTED', 'DELIVERY_CONFIRMED', 'EXTERNAL_VERIFICATION', 'CUSTOM',
]);
const LEGACY_ALL = 'ALL_CONDITIONS_MET';

function validateCondition(input, { allowLegacy = false, requireText = false } = {}) {
  if (!input || typeof input !== 'object') throw new ValidationError('Condition details are required');
  if (allowLegacy && input.type === LEGACY_ALL) return null;
  if (!TYPES.has(input.type)) throw new ValidationError(`Unsupported condition type: ${input.type}`);
  const title = String(input.title || (requireText ? '' : input.type.replaceAll('_', ' '))).trim();
  const description = String(input.description || (requireText ? '' : `Satisfy the ${title.toLowerCase()} requirement.`)).trim();
  if (!title || !description) throw new ValidationError('Condition title and description are required');
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? { ...input.config } : {};
  // These condition types are provider submissions; store their intended role
  // explicitly as well as enforcing it in satisfy().
  if (['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'].includes(input.type)) config.actorRole = 'PAYEE';
  const required = input.required === undefined ? true : input.required;
  if (typeof required !== 'boolean') throw new ValidationError('Condition required must be true or false');
  if (input.type === 'DEADLINE_REACHED') {
    const deadline = config.deadline || input.deadline;
    if (!deadline || !Number.isFinite(Date.parse(deadline))) throw new ValidationError('DEADLINE_REACHED requires a valid deadline');
    config.deadline = new Date(deadline).toISOString();
  }
  if (input.type === 'EXTERNAL_VERIFICATION' && !String(config.verificationSource || '').trim()) throw new ValidationError('EXTERNAL_VERIFICATION requires a verificationSource');
  if (input.type === 'EVIDENCE_SUBMITTED' && !String(config.evidenceRequirement || '').trim()) throw new ValidationError('EVIDENCE_SUBMITTED requires an evidenceRequirement');
  if (input.type === 'EXTERNAL_VERIFICATION' && !String(config.verifierRole || '').trim()) throw new ValidationError('EXTERNAL_VERIFICATION requires a verifierRole');
  if (input.type === 'PARTICIPANT_APPROVAL' && !String(config.actorRole || '').trim()) throw new ValidationError('PARTICIPANT_APPROVAL requires an actorRole');
  if (input.type === 'CUSTOM' && !String(config.actorRole || '').trim()) throw new ValidationError('CUSTOM conditions require an actorRole');
  return { title, description, type: input.type, config, required };
}

module.exports = { TYPES, validateCondition };
