const { UnauthorizedError, ValidationError } = require('../utils/errors');

const workTypes = ['WORK_SUBMITTED', 'EVIDENCE_SUBMITTED'];

function conditionActorRole(condition) {
  if (condition.type === 'DEADLINE_REACHED') throw new UnauthorizedError('Deadline conditions are evaluated by the system');
  if (workTypes.includes(condition.type)) return 'PAYEE';
  const defaultRole = {
    CLIENT_APPROVAL: 'PAYER', PARTICIPANT_APPROVAL: 'PAYER', DELIVERY_CONFIRMED: 'PAYER',
    EXTERNAL_VERIFICATION: condition.config.verifierRole,
  }[condition.type];
  return condition.config.actorRole || defaultRole;
}

function satisfactionChanges(condition, actorId, evidence) {
  const work = workTypes.includes(condition.type);
  const text = String(evidence || '').trim();
  if ((work || condition.type === 'EXTERNAL_VERIFICATION' || condition.config.evidenceRequired) && !text) {
    throw new ValidationError('Evidence or verification details are required to satisfy this condition');
  }
  if (work && !['PENDING', 'REJECTED'].includes(condition.status)) throw new ValidationError('Submission is already awaiting creator review');
  return work
    ? { status: 'SUBMITTED', submittedAt: Date.now(), submittedBy: actorId, verificationDetails: { evidence: text } }
    : { status: 'SATISFIED', satisfiedAt: Date.now(), satisfiedBy: actorId,
      verificationDetails: evidence ? { evidence: text } : { source: 'participant_action' } };
}

function reviewChanges(condition, actorId, decision, feedback) {
  if (!workTypes.includes(condition.type)) throw new ValidationError('Only provider-submitted work or evidence can be reviewed');
  if (condition.status !== 'SUBMITTED') throw new ValidationError('Work or evidence must be submitted before the creator can review it');
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new ValidationError('Review decision must be APPROVE or REJECT');
  const comments = typeof feedback === 'string' ? feedback.trim() : '';
  if (decision === 'REJECT' && !comments) throw new ValidationError('Provide feedback explaining why the submission was rejected');
  const now = Date.now();
  const verificationDetails = { ...condition.verificationDetails, reviewedBy: actorId, reviewedAt: now };
  if (comments) verificationDetails.reviewFeedback = comments;
  return {
    status: decision === 'APPROVE' ? 'SATISFIED' : 'REJECTED',
    satisfiedAt: decision === 'APPROVE' ? now : null, satisfiedBy: decision === 'APPROVE' ? actorId : null,
    verificationDetails,
  };
}

module.exports = { conditionActorRole, satisfactionChanges, reviewChanges };
