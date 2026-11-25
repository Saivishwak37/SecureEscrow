const { Decimal } = require('../domain/postgresMoney');
const { transition, getValidActions } = require('../domain/escrowStateMachine');
const normalizeAttachments = require('../domain/milestoneSubmission');
const { conditionActorRole, satisfactionChanges, reviewChanges } = require('../domain/conditionWorkflow');
const { escrowResponse, milestoneResponse, conditionResponse, assertEscrowAccess } = require('../repositories/postgresCore');
const { runTransaction, checkActor, postTransfer, transactionResponse } = require('./postgresLedger');
const { ConflictError, NotFoundError, UnauthorizedError, ValidationError } = require('../utils/errors');

const blocked = ['DISPUTED', 'CANCELLED', 'EXPIRED', 'RESOLVED', 'RELEASED'];
const submissionInclude = { milestoneSubmissionViaMilestone: { orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] } };
const participantRole = { PAYER: 'CLIENT', CLIENT: 'CLIENT', PAYEE: 'PROVIDER', PROVIDER: 'PROVIDER' };

function canAct(escrow, actor, role) {
  assertEscrowAccess(escrow, actor);
  if (role && actor.role !== role) throw new UnauthorizedError();
}

async function isBlocked(tx, escrow) {
  return blocked.includes(escrow.status) || Boolean(await tx.dispute.findFirst({
    where: { escrowId: escrow.id, status: { not: 'RESOLVED' } }, select: { id: true },
  }));
}

async function holdingAccount(tx, escrow) {
  const account = await tx.account.findUnique({ where: { escrowId: escrow.id } });
  if (!account || account.type !== 'ESCROW' || account.currency !== escrow.currency) throw new ValidationError('Escrow holding account is unavailable');
  return account;
}

async function personalAccount(tx, userId, currency) {
  const account = await tx.account.findUnique({ where: { userId_currency: { userId, currency } } });
  if (!account || account.type !== 'PERSONAL') throw new ValidationError('Participant wallet is unavailable');
  return account;
}

async function updateEscrowStatus(tx, escrow, status, actor, reason) {
  if (escrow.status === status) return escrow;
  await tx.escrowStatusHistory.create({ data: {
    escrowId: escrow.id, changedBy: actor.userId, fromStatus: escrow.status, toStatus: status, reason,
  } });
  return tx.escrow.update({ where: { id: escrow.id }, data: { status } });
}

async function updateMilestoneStatus(tx, escrow, milestone, status, actor, reason, updates = {}) {
  const row = await tx.milestone.update({ where: { id: milestone.id }, data: { status, ...updates }, include: submissionInclude });
  await tx.milestoneStatusHistory.create({ data: {
    milestoneId: milestone.id, changedBy: actor.userId, fromStatus: milestone.status, toStatus: status, reason,
  } });
  if (reason === 'FUND') {
    if (escrow.status === 'CREATED') await updateEscrowStatus(tx, escrow, 'FUNDED', actor, reason);
  } else {
    const list = await tx.milestone.findMany({ where: { escrowId: escrow.id }, orderBy: { order: 'asc' }, select: { status: true } });
    const next = list.find(item => !['RELEASED', 'CANCELLED', 'RESOLVED'].includes(item.status));
    const aggregate = next?.status ?? (list.every(item => item.status === 'RELEASED') ? 'RELEASED'
      : list.every(item => item.status === 'CANCELLED') ? 'CANCELLED' : 'RESOLVED');
    await updateEscrowStatus(tx, escrow, aggregate, actor, reason);
  }
  return milestoneResponse(row);
}

async function scopeFunds(tx, escrow, milestoneId) {
  const totals = await tx.transaction.groupBy({
    by: ['type'], where: { escrowId: escrow.id, milestoneId, status: 'COMPLETED' }, _sum: { amount: true },
  });
  const total = type => new Decimal(totals.find(row => row.type === type)?._sum.amount?.toString() ?? 0);
  const funding = total('FUND');
  const net = funding.minus(total('RELEASE')).minus(total('REFUND'));
  return { funding, net, released: total('RELEASE').gt(0) };
}

async function eligibility(tx, escrow) {
  if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Condition eligibility is only available for condition-based agreements');
  const frozen = await isBlocked(tx, escrow);
  if (!frozen) {
    const now = Date.now();
    const deadlines = await tx.escrowCondition.findMany({ where: { escrowId: escrow.id, type: 'DEADLINE_REACHED', status: 'PENDING' } });
    for (const condition of deadlines) {
      const deadline = Date.parse(condition.config?.deadline);
      if (deadline <= now) await tx.escrowCondition.update({ where: { id: condition.id }, data: {
        status: 'SATISFIED', satisfiedAt: new Date(deadline), satisfiedBySystem: true,
        verificationDetails: { source: 'deadline' },
      } });
    }
  }
  const conditions = (await tx.escrowCondition.findMany({
    where: { escrowId: escrow.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })).map(conditionResponse);
  if (frozen) return { eligible: false, reason: escrow.status === 'RELEASED' ? 'Funds have already been released' : 'Escrow is blocked', conditions };
  const unmet = conditions.filter(condition => condition.required && condition.status !== 'SATISFIED');
  const { net } = await scopeFunds(tx, escrow, null);
  const reason = unmet.length ? `Unmet conditions: ${unmet.map(condition => condition.type).join(', ')}`
    : net.lt(escrow.totalAmount.toString()) ? 'Escrow is not fully funded' : null;
  return { eligible: !reason, reason, conditions };
}

function postgresWorkflow(db) {
  function inEscrow(id, actor, role, action, allowBlocked = false) {
    return runTransaction(db, async tx => {
      await checkActor(tx, actor);
      await tx.$queryRaw`SELECT id FROM escrow WHERE id = ${id} FOR UPDATE`;
      const escrow = await tx.escrow.findUnique({ where: { id } });
      if (!escrow) throw new NotFoundError('Escrow', id);
      canAct(escrow, actor, role);
      if (!allowBlocked && await isBlocked(tx, escrow)) throw new ValidationError('Escrow is blocked or complete');
      return action(tx, escrow);
    });
  }

  async function getMilestone(store, id, escrowId) {
    if (typeof id !== 'string' || !id) throw new ValidationError('milestoneId is required');
    const milestone = await store.milestone.findUnique({ where: { id }, include: submissionInclude });
    if (!milestone) throw new NotFoundError('Milestone', id);
    if (escrowId && milestone.escrowId !== escrowId) throw new ValidationError('Milestone does not belong to this escrow');
    return milestone;
  }

  function fund(id, actor, milestoneId) {
    return inEscrow(id, actor, 'CLIENT', async (tx, escrow) => {
      const milestone = escrow.releaseModel === 'MILESTONE_BASED' ? await getMilestone(tx, milestoneId, id) : null;
      if (!milestone && milestoneId != null) throw new ValidationError('Condition-based agreements do not use milestones');
      const { funding } = await scopeFunds(tx, escrow, milestone?.id ?? null);
      if (funding.gt(0)) throw new ConflictError('This agreement or milestone is already funded');
      const target = milestone ?? escrow;
      const status = transition(target.status, 'FUND');
      if (milestone) {
        const { _sum } = await tx.milestone.aggregate({ where: { escrowId: id }, _sum: { amount: true } });
        if (!_sum.amount?.eq(escrow.totalAmount)) throw new ValidationError('Milestone amounts must sum to the escrow total before funding');
      }
      const { transaction } = await postTransfer(tx, {
        from: await personalAccount(tx, escrow.clientId, escrow.currency), to: await holdingAccount(tx, escrow),
        type: 'FUND', value: milestone?.amount ?? escrow.totalAmount, escrowId: id, milestoneId: milestone?.id,
      });
      const result = milestone
        ? { milestone: await updateMilestoneStatus(tx, escrow, milestone, status, actor, 'FUND') }
        : { escrow: escrowResponse(await updateEscrowStatus(tx, escrow, status, actor, 'FUND')) };
      return { transaction: transactionResponse(transaction), ...result };
    });
  }

  async function milestoneAction(id, actor, action, body = {}, escrowId) {
    const scope = escrowId ?? (await getMilestone(db, id)).escrowId;
    const role = ['START', 'SUBMIT'].includes(action) ? 'PROVIDER' : 'CLIENT';
    return inEscrow(scope, actor, role, async (tx, escrow) => {
      const milestone = await getMilestone(tx, id, scope);
      const status = transition(milestone.status, action);
      const { net } = await scopeFunds(tx, escrow, id);
      if (net.lt(milestone.amount.toString())) throw new ValidationError('Milestone funds are unavailable');
      const updates = {};
      if (action === 'SUBMIT') {
        await tx.milestoneSubmission.create({ data: {
          milestoneId: id, submittedBy: actor.userId, submittedAt: new Date(), attachments: normalizeAttachments(body ?? {}),
        } });
        updates.reviewFeedback = null;
      } else if (['APPROVE', 'REJECT'].includes(action)) {
        const last = milestone.milestoneSubmissionViaMilestone.at(-1);
        if (!last) throw new ValidationError('Work must be submitted before it can be reviewed');
        const feedback = action === 'REJECT' ? String(body?.feedback ?? '').trim() : null;
        if (action === 'REJECT' && !feedback) throw new ValidationError('Provide feedback explaining what the provider should revise');
        await tx.milestoneSubmission.update({ where: { id: last.id }, data: {
          reviewedBy: actor.userId, reviewedAt: new Date(), reviewFeedback: feedback,
        } });
        updates.reviewFeedback = feedback;
      }
      return updateMilestoneStatus(tx, escrow, milestone, status, actor, action, updates);
    });
  }

  async function release(id, actor, milestoneId) {
    const scope = milestoneId ? (await getMilestone(db, milestoneId)).escrowId : id;
    return inEscrow(scope, actor, 'CLIENT', async (tx, escrow) => {
      const milestone = milestoneId ? await getMilestone(tx, milestoneId, scope) : null;
      const { net, released } = await scopeFunds(tx, escrow, milestoneId ?? null);
      if (released) throw new ConflictError('Funds have already been released');
      if (await isBlocked(tx, escrow)) throw new ValidationError('Escrow is blocked or complete');
      if (!milestone) {
        const check = await eligibility(tx, escrow);
        if (!check.eligible) throw new ValidationError(check.reason);
      }
      const status = milestone ? transition(milestone.status, 'RELEASE') : 'RELEASED';
      const value = milestone?.amount ?? escrow.totalAmount;
      if (net.lt(value.toString())) throw new ValidationError('Allocated funds are unavailable');
      const { transaction } = await postTransfer(tx, {
        from: await holdingAccount(tx, escrow), to: await personalAccount(tx, escrow.providerId, escrow.currency),
        value, type: 'RELEASE', escrowId: scope, milestoneId,
      });
      const result = milestone
        ? { milestone: await updateMilestoneStatus(tx, escrow, milestone, status, actor, 'RELEASE') }
        : { escrow: escrowResponse(await updateEscrowStatus(tx, escrow, status, actor, 'RELEASE')) };
      return { transaction: transactionResponse(transaction), ...result };
    }, true);
  }

  async function conditionAction(actor, { id, escrowId, type, review, evidence, decision, feedback }) {
    const scope = escrowId ?? (await db.escrowCondition.findUnique({ where: { id }, select: { escrowId: true } }))?.escrowId;
    if (!scope) throw new NotFoundError('Condition', id);
    return inEscrow(scope, actor, review ? 'CLIENT' : null, async (tx, escrow) => {
      if (escrow.releaseModel !== 'CONDITION_BASED') throw new ValidationError('Conditions are only available for condition-based agreements');
      const { funding } = await scopeFunds(tx, escrow, null);
      if (!funding.eq(escrow.totalAmount.toString())) throw new ValidationError('Fund the escrow before satisfying release conditions');
      const matches = await tx.escrowCondition.findMany({ where: { escrowId: scope, ...(id ? { id } : { type }) }, take: 2 });
      if (!matches.length && id) throw new NotFoundError('Condition', id);
      if (matches.length !== 1) throw new ValidationError(matches.length ? 'Condition type is ambiguous; use the condition ID' : 'Condition is not configured');
      const condition = matches[0];
      let data;
      if (review) {
        data = reviewChanges(condition, actor.userId, decision, feedback);
      } else if (condition.status !== 'SATISFIED') {
        const requiredRole = conditionActorRole(condition);
        const authorized = participantRole[requiredRole] === actor.role
          || (requiredRole && !participantRole[requiredRole] && await tx.escrowParticipant.findFirst({
            where: { escrowId: scope, userId: actor.userId, role: requiredRole },
          }));
        if (!authorized) throw new UnauthorizedError('Only the configured participant may satisfy this condition');
        data = satisfactionChanges(condition, actor.userId, evidence);
      }
      for (const key of ['submittedAt', 'satisfiedAt']) {
        if (data?.[key] != null) data[key] = new Date(data[key]);
      }
      const row = data ? await tx.escrowCondition.update({ where: { id: condition.id }, data }) : condition;
      const state = await eligibility(tx, escrow);
      return type ? state : { condition: conditionResponse(row), eligibility: state };
    });
  }

  return {
    fund, release, milestoneAction, conditionAction,
    eligibility: (id, actor) => inEscrow(id, actor, null, eligibility, true),
    listConditions: (id, actor) => inEscrow(id, actor, null, async (tx, escrow) =>
      escrow.releaseModel === 'CONDITION_BASED' ? (await eligibility(tx, escrow)).conditions : [], true),
    escrowActions: (id, actor) => inEscrow(id, actor, null, async (tx, escrow) => {
      if (await isBlocked(tx, escrow)) return [];
      if (escrow.releaseModel === 'CONDITION_BASED') {
        if (actor.role !== 'CLIENT') return [];
        return escrow.status === 'CREATED' ? ['FUND'] : (await eligibility(tx, escrow)).eligible ? ['RELEASE'] : [];
      }
      return getValidActions(escrow.status).filter(action => action === 'FUND' || action === 'START');
    }, true),
    milestoneActions: async (id, actor) => {
      const milestone = await getMilestone(db, id);
      return inEscrow(milestone.escrowId, actor, null, async (tx, escrow) => (await isBlocked(tx, escrow)) ? []
        : getValidActions((await getMilestone(tx, id, escrow.id)).status).filter(action => !['CANCEL', 'DISPUTE', 'RESOLVE'].includes(action)), true);
    },
  };
}

module.exports = postgresWorkflow;
