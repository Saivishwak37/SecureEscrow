const { Decimal, amount, numericApi } = require('../domain/postgresMoney');
const { disputeInput } = require('../domain/disputeInput');
const { timestamps, assertEscrowAccess, ledgerBalance } = require('../repositories/postgresCore');
const { checkActor, runTransaction, postTransfer, transactionResponse } = require('./postgresLedger');
const { BaseError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } = require('../utils/errors');

const orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
const terminal = ['RELEASED', 'CANCELLED', 'RESOLVED'];
const transitions = {
  OPEN: ['EVIDENCE_SUBMISSION', 'UNDER_REVIEW'],
  EVIDENCE_SUBMISSION: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['EVIDENCE_SUBMISSION'],
};
const finalStatus = { RELEASE_TO_PROVIDER: 'RELEASED', REFUND_TO_CLIENT: 'CANCELLED', SPLIT_FUNDS: 'RESOLVED' };
const sender = { select: { id: true, name: true, username: true, role: true } };

async function appendHistory(tx, data) {
  const [{ createdAt }] = await tx.$queryRaw`
    SELECT greatest(date_trunc('milliseconds', clock_timestamp()), max(created_at) + interval '1 millisecond') AS "createdAt"
    FROM dispute_status_history WHERE dispute_id = ${data.disputeId}
  `;
  return tx.disputeStatusHistory.create({ data: { ...data, createdAt } });
}

async function loadDispute(store, id, actor, allowAdmin = true) {
  const row = await store.dispute.findUnique({ where: { id }, include: { escrow: true } });
  if (!row) throw new NotFoundError('Dispute', id);
  const { escrow, ...dispute } = row;
  assertEscrowAccess(escrow, actor, allowAdmin);
  return { dispute, escrow };
}

function active({ dispute, escrow }) {
  if (dispute.status === 'RESOLVED') throw new ValidationError('This dispute is already resolved');
  if (escrow.status !== 'DISPUTED') throw new ValidationError('The associated escrow must be DISPUTED');
}

function presentMessage({ sender: user, ...row }) {
  return timestamps({ ...row, sender: { id: user.id, name: user.name || user.username, type: user.role } });
}

function presentResolution(row, milestoneId, transactions = false) {
  const { idempotencyKey, requestShape, transactionViaResolution, disputeResolutionAllocationViaResolution, ...resolution } = row;
  const allocations = disputeResolutionAllocationViaResolution.map(item => timestamps({ ...item, amount: numericApi(item.amount) }));
  const result = timestamps({
    ...resolution, milestoneId, allocations,
    remainingEscrowBalance: resolution.remainingEscrowBalance === null ? null : numericApi(resolution.remainingEscrowBalance),
  });
  if (!transactions) return result;
  const transfers = transactionViaResolution.map(transactionResponse);
  return {
    ...result, status: resolution.executionStatus === 'COMPLETED' ? 'RESOLVED' : 'UNDER_REVIEW',
    transactionId: transfers[0]?.id ?? null, transactionIds: transfers.map(item => item.id), transactions: transfers,
  };
}

const resolutionInclude = {
  disputeResolutionAllocationViaResolution: { orderBy: [{ type: 'asc' }, ...orderBy] },
  transactionViaResolution: { orderBy },
};

function parseResolution(input, milestoneId) {
  const { decision, reasoning, idempotencyKey } = input ?? {};
  if (!Object.hasOwn(finalStatus, decision) && decision !== 'PARTIAL_RELEASE') throw new ValidationError('A supported resolution decision is required');
  if (typeof reasoning !== 'string' || !reasoning.trim() || reasoning.trim().length > 4000) throw new ValidationError('Reasoning is required and must be 4000 characters or fewer');
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new ValidationError('A unique idempotencyKey is required');
  if (input.milestoneId !== undefined && (input.milestoneId || null) !== milestoneId) throw new ValidationError('Resolution scope is fixed by the dispute');
  if (Object.keys(input).some(key => !['actorId', 'role', 'decision', 'reasoning', 'idempotencyKey', 'milestoneId', 'providerAmount', 'clientAmount'].includes(key))) {
    throw new ValidationError('Unexpected resolution request fields');
  }
  const provider = ['PARTIAL_RELEASE', 'SPLIT_FUNDS'].includes(decision) ? amount(input, 'providerAmount') : null;
  const client = decision === 'SPLIT_FUNDS' ? amount(input, 'clientAmount') : null;
  if ((!provider && input.providerAmount != null) || (!client && input.clientAmount != null && !(decision === 'PARTIAL_RELEASE' && input.clientAmount === 0))) {
    throw new ValidationError('Unexpected allocation for this decision');
  }
  const requestShape = JSON.stringify({ decision, reasoning: reasoning.trim(), provider: provider?.toString(), client: client?.toString(), milestoneId });
  return { decision, reasoning: reasoning.trim(), idempotencyKey, requestShape, provider, client };
}

async function availableFunds(tx, dispute) {
  const rows = await tx.transaction.groupBy({
    by: ['type'], where: { escrowId: dispute.escrowId, status: 'COMPLETED', ...(dispute.milestoneId ? { milestoneId: dispute.milestoneId } : {}) },
    _sum: { amount: true },
  });
  const total = type => new Decimal(rows.find(row => row.type === type)?._sum.amount?.toString() ?? 0);
  return total('FUND').minus(total('RELEASE')).minus(total('REFUND'));
}

async function closeScope(tx, escrow, dispute, actor, status, reason) {
  let target = status;
  if (escrow.releaseModel === 'MILESTONE_BASED') {
    const milestones = await tx.milestone.findMany({ where: { escrowId: escrow.id }, orderBy: { order: 'asc' } });
    for (const milestone of milestones) {
      if (terminal.includes(milestone.status) || (dispute.milestoneId && dispute.milestoneId !== milestone.id)) continue;
      await tx.milestoneStatusHistory.create({ data: {
        milestoneId: milestone.id, changedBy: actor.userId, fromStatus: milestone.status, toStatus: status, reason,
      } });
      await tx.milestone.update({ where: { id: milestone.id }, data: { status } });
      milestone.status = status;
    }
    if (dispute.milestoneId) {
      target = milestones.find(item => !terminal.includes(item.status))?.status
        ?? (milestones.every(item => item.status === 'RELEASED') ? 'RELEASED'
          : milestones.every(item => item.status === 'CANCELLED') ? 'CANCELLED' : 'RESOLVED');
    }
  }
  await tx.escrowStatusHistory.create({ data: {
    escrowId: escrow.id, changedBy: actor.userId, fromStatus: escrow.status, toStatus: target, reason,
  } });
  await tx.escrow.update({ where: { id: escrow.id }, data: { status: target, statusBeforeDispute: null } });
}

function postgresDisputes(db) {
  function withEscrow(id, actor, action) {
    return runTransaction(db, async tx => {
      await checkActor(tx, actor);
      await tx.$queryRaw`SELECT id FROM escrow WHERE id = ${id} FOR UPDATE`;
      const escrow = await tx.escrow.findUnique({ where: { id } });
      if (!escrow) throw new NotFoundError('Escrow', id);
      return action(tx, escrow);
    });
  }

  async function withDispute(id, actor, action, allowAdmin = true) {
    const ref = await db.dispute.findUnique({ where: { id }, select: { escrowId: true } });
    if (!ref) throw new NotFoundError('Dispute', id);
    return withEscrow(ref.escrowId, actor, async tx => action(tx, await loadDispute(tx, id, actor, allowAdmin)));
  }

  function create(escrowId, actor, input) {
    const data = disputeInput(input);
    const milestoneId = input.milestoneId || null;
    if (milestoneId !== null && typeof milestoneId !== 'string') throw new ValidationError('milestoneId must be a string');
    return withEscrow(escrowId, actor, async (tx, escrow) => {
      assertEscrowAccess(escrow, actor);
      if (await tx.dispute.findFirst({ where: { escrowId, status: { not: 'RESOLVED' } }, select: { id: true } })) {
        throw new BaseError('An active dispute already exists for this escrow', 409, 'DUPLICATE_ACTIVE_DISPUTE', { escrowId });
      }
      if ([...terminal, 'DISPUTED', 'EXPIRED'].includes(escrow.status)) throw new ValidationError('This escrow cannot be disputed');
      if (milestoneId) {
        const item = await tx.milestone.findUnique({ where: { id: milestoneId } });
        if (!item) throw new NotFoundError('Milestone', milestoneId);
        if (item.escrowId !== escrowId || terminal.includes(item.status)) throw new ValidationError('Milestone is outside this dispute scope or already closed');
      }
      const dispute = await tx.dispute.create({ data: { ...data, escrowId, milestoneId, raisedBy: actor.userId } });
      await tx.escrow.update({ where: { id: escrowId }, data: { status: 'DISPUTED', statusBeforeDispute: escrow.status } });
      await tx.escrowStatusHistory.create({ data: { escrowId, changedBy: actor.userId, fromStatus: escrow.status, toStatus: 'DISPUTED', reason: `Dispute opened: ${data.title}` } });
      await appendHistory(tx, { disputeId: dispute.id, changedBy: actor.userId, toStatus: 'OPEN', reason: 'Dispute created', eventType: 'STATUS_TRANSITION' });
      return timestamps(dispute);
    });
  }

  async function list(escrowId, actor, status) {
    const escrow = await db.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundError('Escrow', escrowId);
    assertEscrowAccess(escrow, actor, true);
    if (status !== undefined && !['OPEN', 'EVIDENCE_SUBMISSION', 'UNDER_REVIEW', 'RESOLVED'].includes(status)) {
      throw new ValidationError('Invalid dispute status filter');
    }
    return (await db.dispute.findMany({ where: { escrowId, status }, orderBy })).map(timestamps);
  }

  async function read(id, actor, action) {
    const { dispute } = await loadDispute(db, id, actor);
    return action(dispute);
  }

  function changeStatus(id, actor, status, reason) {
    if (actor.role !== 'ADMIN') throw new UnauthorizedError();
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw new ValidationError('A transition reason is required and must be 2000 characters or fewer');
    return withDispute(id, actor, async (tx, context) => {
      active(context);
      if (!transitions[context.dispute.status]?.includes(status)) throw new ValidationError('Invalid dispute status transition');
      const dispute = await tx.dispute.update({ where: { id }, data: { status } });
      const history = await appendHistory(tx, {
        disputeId: id, changedBy: actor.userId, fromStatus: context.dispute.status, toStatus: status,
        reason: reason.trim(), eventType: 'STATUS_TRANSITION',
      });
      return { dispute: timestamps(dispute), history: timestamps(history) };
    });
  }

  async function resolve(id, actor, input) {
    if (actor.role !== 'ADMIN') throw new UnauthorizedError();
    try {
      return await withDispute(id, actor, async (tx, context) => {
        const { dispute, escrow } = context;
        const { decision, reasoning, idempotencyKey, requestShape, provider, client } = parseResolution(input, dispute.milestoneId);
        const prior = await tx.disputeResolution.findUnique({ where: { disputeId_idempotencyKey: { disputeId: id, idempotencyKey } }, include: resolutionInclude });
        if (prior) {
          if (prior.resolvedBy !== actor.userId) throw new UnauthorizedError('This key belongs to another administrator');
          if (prior.requestShape !== requestShape) throw new ConflictError('This key was used for another resolution request');
          return { ...presentResolution(prior, dispute.milestoneId, true), replayed: true };
        }
        active(context);
        const available = await availableFunds(tx, dispute);
        if (!available.gt(0)) throw new ValidationError('Escrow has insufficient available funds');
        const holding = await tx.account.findUnique({ where: { escrowId: escrow.id } });
        const wallets = await tx.account.findMany({ where: {
          userId: { in: [escrow.clientId, escrow.providerId] }, currency: escrow.currency, type: 'PERSONAL',
        } });
        if (!holding || holding.type !== 'ESCROW' || holding.currency !== escrow.currency || wallets.length !== 2
          || [holding, ...wallets].some(account => account.status !== 'ACTIVE')) throw new ValidationError('Active resolution accounts in the escrow currency are required');
        // Acquire all affected accounts in one deterministic order before a multi-leg resolution.
        await tx.$queryRaw`SELECT id FROM account WHERE id IN (${holding.id}, ${wallets[0].id}, ${wallets[1].id}) ORDER BY id FOR UPDATE`;
        if ((await ledgerBalance(tx, holding.id)).lt(available)) throw new ValidationError('Escrow has insufficient available funds');

        const providerValue = decision === 'RELEASE_TO_PROVIDER' ? available : provider;
        const clientValue = decision === 'REFUND_TO_CLIENT' ? available : client;
        const paid = new Decimal(providerValue?.toString() ?? 0).plus(clientValue?.toString() ?? 0);
        const remaining = available.minus(paid);
        const partial = decision === 'PARTIAL_RELEASE';
        if (partial ? !remaining.gt(0) : !remaining.isZero()) throw new ValidationError(partial
          ? 'Partial release must leave an unresolved balance' : 'Allocations must equal available funds');

        const resolution = await tx.disputeResolution.create({ data: {
          disputeId: id, resolvedBy: actor.userId, decision, reasoning, idempotencyKey, requestShape,
          executionStatus: partial ? 'PARTIAL' : 'COMPLETED', remainingEscrowBalance: remaining.toString(),
        } });
        for (const [type, value, userId] of [['RELEASE', providerValue, escrow.providerId], ['REFUND', clientValue, escrow.clientId]]) {
          if (!value) continue;
          const recipient = wallets.find(account => account.userId === userId);
          const { transaction } = await postTransfer(tx, {
            from: holding, to: recipient, type, value, escrowId: escrow.id, milestoneId: dispute.milestoneId, resolutionId: resolution.id,
          });
          await tx.disputeResolutionAllocation.create({ data: {
            resolutionId: resolution.id, transactionId: transaction.id, recipientAccountId: recipient.id,
            amount: value.toString(), currency: escrow.currency, type,
          } });
        }
        const status = partial ? 'UNDER_REVIEW' : 'RESOLVED';
        const reason = partial ? `Partial release executed; ${remaining} ${escrow.currency} remains in dispute` : `Resolution executed: ${decision}`;
        if (!partial) await closeScope(tx, escrow, dispute, actor, finalStatus[decision], reason);
        await tx.dispute.update({ where: { id }, data: { status, resolvedAt: partial ? null : new Date() } });
        const audit = { disputeId: id, changedBy: actor.userId, toStatus: status, resolutionId: resolution.id, reason };
        if (dispute.status !== status) {
          await appendHistory(tx, { ...audit, fromStatus: dispute.status, eventType: 'STATUS_TRANSITION' });
        }
        await appendHistory(tx, { ...audit, fromStatus: status, eventType: 'RESOLUTION_EXECUTED' });
        return presentResolution(await tx.disputeResolution.findUniqueOrThrow({ where: { id: resolution.id }, include: resolutionInclude }), dispute.milestoneId, true);
      });
    } catch (error) {
      if (!(error instanceof UnauthorizedError || error instanceof NotFoundError)) {
        // Financial work has rolled back. Attempt a separate, nonfinancial failure audit.
        try {
          await withDispute(id, actor, (tx, { dispute }) => appendHistory(tx, {
            disputeId: id, changedBy: actor.userId, fromStatus: dispute.status, toStatus: dispute.status,
            eventType: 'RESOLUTION_FAILED', reason: error instanceof BaseError ? error.message : 'Resolution could not be recorded',
          }));
        } catch { /* Keep the original operation error. */ }
      }
      throw error;
    }
  }

  function sendMessage(id, actor, message) {
    const max = Number.parseInt(process.env.DISPUTE_MESSAGE_MAX_LENGTH || '5000', 10);
    if (!Number.isInteger(max) || max < 1) throw new Error('DISPUTE_MESSAGE_MAX_LENGTH must be a positive integer');
    if (typeof message !== 'string' || !message.trim() || message.length > max) throw new ValidationError(`Message must contain 1–${max} characters`);
    return withDispute(id, actor, async (tx, context) => {
      active(context);
      const [{ createdAt }] = await tx.$queryRaw`
        SELECT greatest(date_trunc('milliseconds', clock_timestamp()), max(created_at) + interval '1 millisecond') AS "createdAt"
        FROM dispute_message WHERE dispute_id = ${id}
      `;
      return presentMessage(await tx.disputeMessage.create({
        data: { disputeId: id, senderId: actor.userId, message, createdAt }, include: { sender },
      }));
    }, false);
  }

  return {
    create, list, changeStatus, resolve, sendMessage, withDispute,
    lookup: (id, actor) => read(id, actor, timestamps),
    checkUpload: async (id, actor) => active(await loadDispute(db, id, actor, false)),
    messages: (id, actor) => read(id, actor, async () =>
      (await db.disputeMessage.findMany({ where: { disputeId: id }, orderBy, include: { sender } })).map(presentMessage)),
    history: (id, actor) => read(id, actor, async () =>
      (await db.disputeStatusHistory.findMany({ where: { disputeId: id }, orderBy })).map(timestamps)),
    resolutions: (id, actor) => read(id, actor, async dispute =>
      (await db.disputeResolution.findMany({ where: { disputeId: id }, orderBy, include: resolutionInclude }))
        .map(row => presentResolution(row, dispute.milestoneId))),
  };
}

module.exports = { postgresDisputes, active };
