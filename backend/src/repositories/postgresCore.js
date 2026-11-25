const { Decimal, amount, numericApi } = require('../domain/postgresMoney');
const { validateCondition } = require('../domain/validateCondition');
const { ConflictError, NotFoundError, UnauthorizedError, ValidationError } = require('../utils/errors');

const draftIncludes = {
  escrowConditionViaEscrow: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
};
const submissionInclude = { milestoneSubmissionViaMilestone: { orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] } };

function timestamps(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? value.getTime() : value]));
}

function conditionResponse({ satisfiedBySystem, ...condition }) {
  return timestamps({ ...condition, satisfiedBy: satisfiedBySystem ? 'SYSTEM' : condition.satisfiedBy });
}

function escrowResponse({ providerId, escrowConditionViaEscrow, ...escrow }) {
  return timestamps({
    ...escrow, providerId, freelancerId: providerId, payerId: escrow.clientId, payeeId: providerId,
    participants: [{ userId: escrow.clientId, role: 'PAYER' }, { userId: providerId, role: 'PAYEE' }],
    totalAmount: numericApi(escrow.totalAmount), disputed: escrow.status === 'DISPUTED',
    ...(escrowConditionViaEscrow ? { conditions: escrowConditionViaEscrow.map(conditionResponse) } : {}),
  });
}

function milestoneResponse({ milestoneSubmissionViaMilestone, ...milestone }) {
  return timestamps({
    ...milestone, amount: numericApi(milestone.amount),
    ...(milestoneSubmissionViaMilestone?.length ? { submissions: milestoneSubmissionViaMilestone.map(timestamps) } : {}),
  });
}

function assertEscrowAccess(escrow, actor, allowAdmin = false) {
  if ((actor.role === 'CLIENT' && escrow.clientId === actor.userId)
      || (actor.role === 'PROVIDER' && escrow.providerId === actor.userId)
      || (allowAdmin && actor.role === 'ADMIN')) return;
  throw new UnauthorizedError('You are not authorized to access this escrow');
}

async function ledgerBalance(store, accountId) {
  const [row] = await store.$queryRaw`
    SELECT coalesce(sum(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0) AS balance
    FROM ledger_entry WHERE account_id = ${accountId}
  `;
  return new Decimal(row.balance.toString());
}

function milestoneInput(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim()
      || typeof input.description !== 'string' || !input.description.trim()) {
    throw new ValidationError('Every milestone needs a title and description');
  }
  return { title: input.title, description: input.description, amount: amount(input).toString() };
}

function postgresCore(db) {
  async function getEscrow(id, actor, store = db, allowAdmin = true) {
    const escrow = await store.escrow.findUnique({ where: { id }, include: draftIncludes });
    if (!escrow) throw new NotFoundError('Escrow', id);
    assertEscrowAccess(escrow, actor, allowAdmin);
    return escrow;
  }

  async function createEscrow(actor, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Agreement details are required');
    const providerId = input.providerId || input.freelancerId || input.payeeId;
    if (typeof providerId !== 'string' || !providerId || providerId === actor.userId) {
      throw new ValidationError('The selected Provider must be an active Provider account');
    }
    if (typeof input.title !== 'string' || !input.title.trim()) throw new ValidationError('Title is required');
    const total = amount(input, 'totalAmount');
    const model = ({ 'Milestone Based': 'MILESTONE_BASED', 'Condition Based': 'CONDITION_BASED' })[input.releaseModel]
      || input.releaseModel || 'MILESTONE_BASED';
    if (!['MILESTONE_BASED', 'CONDITION_BASED'].includes(model)) throw new ValidationError('Invalid release model');
    const rawMilestones = input.milestones ?? [];
    if (!Array.isArray(rawMilestones)) throw new ValidationError('Milestones must be an array');
    const milestones = rawMilestones.map(milestoneInput);
    const conditions = [];
    if (model === 'MILESTONE_BASED') {
      const allocated = milestones.reduce((sum, milestone) => sum.plus(milestone.amount), new Decimal(0));
      if (milestones.length && !allocated.eq(total)) throw new ValidationError('Milestone amounts must sum to the escrow total');
    } else {
      if (milestones.length) throw new ValidationError('Condition-based agreements do not use milestones');
      const configured = input.conditions ?? [];
      if (!Array.isArray(configured)) throw new ValidationError('Conditions must be an array');
      const definitions = input.deadline
        ? [...configured, { type: 'DEADLINE_REACHED', config: { deadline: input.deadline } }]
        : configured;
      conditions.push(...definitions.map(item => validateCondition(item, { allowLegacy: true })).filter(Boolean));
      if (!conditions.length) throw new ValidationError('Configure at least one release condition');
    }
    for (const field of ['description', 'terms', 'agreementType']) {
      if (input[field] != null && typeof input[field] !== 'string') throw new ValidationError(`${field} must be text`);
    }

    return db.$transaction(async tx => {
      const parties = await tx.$queryRaw`
        SELECT id, role::text, is_active FROM "user"
        WHERE id IN (${actor.userId}, ${providerId}) AND password_hash IS NOT NULL
        ORDER BY id FOR SHARE
      `;
      if (actor.role !== 'CLIENT' || !parties.some(p => p.id === actor.userId && p.role === 'CLIENT' && p.is_active)) {
        throw new UnauthorizedError();
      }
      if (!parties.some(p => p.id === providerId && p.role === 'PROVIDER' && p.is_active)) {
        throw new ValidationError('The selected Provider must be an active Provider account');
      }
      const escrow = await tx.escrow.create({
        data: {
          clientId: actor.userId, providerId, title: input.title, description: input.description ?? '',
          terms: input.terms ?? '', agreementType: input.agreementType || 'GENERAL',
          metadata: input.metadata ?? {}, releaseModel: model, totalAmount: total.toString(),
          accountViaEscrow: { create: { type: 'ESCROW' } },
          milestoneViaEscrow: { create: milestones.map((row, index) => ({ ...row, order: index + 1 })) },
          escrowConditionViaEscrow: { create: conditions },
          escrowStatusHistoryViaEscrow: { create: { changedBy: actor.userId, toStatus: 'CREATED', reason: 'Escrow created' } },
        },
        include: draftIncludes,
      });
      return escrowResponse(escrow);
    });
  }

  async function listEscrows(actor) {
    const where = actor.role === 'ADMIN' ? {}
      : actor.role === 'CLIENT' ? { clientId: actor.userId } : { providerId: actor.userId };
    return (await db.escrow.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(escrowResponse);
  }

  async function editDraft(id, actor, model, change) {
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM escrow WHERE id = ${id} FOR UPDATE`;
      const escrow = await getEscrow(id, actor, tx, false);
      if (actor.role !== 'CLIENT') throw new UnauthorizedError();
      if (escrow.releaseModel !== model) throw new ValidationError('Agreement uses a different release model');
      if (escrow.status !== 'CREATED' || await tx.transaction.findFirst({ where: { escrowId: id, type: 'FUND', status: 'COMPLETED' } })) {
        throw new ValidationError('Funded or blocked agreements cannot be edited');
      }
      return change(tx, escrow);
    });
  }

  function addMilestone(id, actor, input) {
    const data = milestoneInput(input);
    return editDraft(id, actor, 'MILESTONE_BASED', async (tx, escrow) => {
      const rows = await tx.milestone.findMany({ where: { escrowId: id }, select: { amount: true, order: true } });
      const allocated = rows.reduce((sum, row) => sum.plus(row.amount.toString()), new Decimal(data.amount));
      if (allocated.gt(escrow.totalAmount.toString())) throw new ValidationError('Milestone allocations cannot exceed the agreement amount');
      const order = rows.reduce((max, row) => Math.max(max, row.order), 0) + 1;
      return milestoneResponse(await tx.milestone.create({ data: { ...data, escrowId: id, order } }));
    });
  }

  async function listMilestones(id, actor) {
    await getEscrow(id, actor, db, false);
    return (await db.milestone.findMany({
      where: { escrowId: id }, orderBy: { order: 'asc' }, include: submissionInclude,
    })).map(milestoneResponse);
  }

  async function getMilestone(id, actor) {
    const row = await db.milestone.findUnique({
      where: { id }, include: submissionInclude,
    });
    if (!row) throw new NotFoundError('Milestone', id);
    await getEscrow(row.escrowId, actor, db, false);
    return milestoneResponse(row);
  }

  function addCondition(id, actor, input) {
    const data = validateCondition(input, { requireText: true });
    return editDraft(id, actor, 'CONDITION_BASED', async tx =>
      conditionResponse(await tx.escrowCondition.create({ data: { escrowId: id, ...data } })));
  }

  async function changeCondition(id, actor, input, remove = false) {
    const record = await db.escrowCondition.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Condition', id);
    return editDraft(record.escrowId, actor, 'CONDITION_BASED', async (tx, escrow) => {
      const condition = escrow.escrowConditionViaEscrow.find(row => row.id === id);
      if (!condition) throw new NotFoundError('Condition', id);
      if (remove) {
        if (escrow.escrowConditionViaEscrow.length < 2) throw new ValidationError('An agreement must have at least one release condition');
        await tx.escrowCondition.delete({ where: { id } });
        return { deleted: true, id };
      }
      const data = validateCondition({ ...condition, ...input, config: { ...condition.config, ...input?.config } }, { requireText: true });
      return conditionResponse(await tx.escrowCondition.update({ where: { id }, data }));
    });
  }

  async function getAccount(where, actor) {
    const account = await db.account.findFirst({ where });
    if (!account) throw new NotFoundError('Account', where.id || where.userId);
    if (actor.role !== 'ADMIN' && (account.type !== 'PERSONAL' || account.userId !== actor.userId)) throw new UnauthorizedError();
    return account;
  }

  async function accountDetails(where, actor) {
    const account = await getAccount(where, actor);
    const balance = await ledgerBalance(db, account.id);
    const { id, userId, currency, type, createdAt } = account;
    return { id, userId, currency, type, createdAt: createdAt.getTime(), balance: numericApi(balance) };
  }

  async function createAccount(actor, input) {
    if (input?.currency && input.currency !== 'INR') throw new ValidationError('Wallet currency must be INR');
    try {
      const row = await db.account.create({ data: { userId: actor.userId, type: 'PERSONAL' } });
      return accountDetails({ id: row.id }, actor);
    } catch (error) {
      if (error.code === 'P2002') throw new ConflictError('A personal wallet already exists');
      throw error;
    }
  }

  return {
    createEscrow, listEscrows, addMilestone, listMilestones, getMilestone, addCondition, changeCondition,
    getEscrow: async (id, actor) => escrowResponse(await getEscrow(id, actor)),
    accountDetails, createAccount, getAccount,
  };
}

module.exports = { postgresCore, timestamps, escrowResponse, milestoneResponse, conditionResponse, assertEscrowAccess, ledgerBalance, submissionInclude };
