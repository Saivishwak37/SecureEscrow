const { randomUUID, createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { API_LIMIT, amount, numericApi } = require('../domain/postgresMoney');
const { timestamps, assertEscrowAccess, ledgerBalance } = require('../repositories/postgresCore');
const { ValidationError, ConflictError, NotFoundError, UnauthorizedError, InsufficientBalanceError } = require('../utils/errors');

const orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];

function heldBalances(db, scope) {
  return db.$queryRaw`
    SELECT coalesce(sum(CASE WHEN entry.type = 'CREDIT' THEN entry.amount ELSE -entry.amount END), 0) AS balance
    FROM ledger_entry entry
    JOIN account ON account.id = entry.account_id
    JOIN escrow ON escrow.id = account.escrow_id
    WHERE account.type = 'ESCROW' AND account.currency = 'INR' ${scope}
  `;
}

function transactionResponse({ idempotencyKey, requestShape, resolutionId, ...row }) {
  return timestamps({ ...row, amount: numericApi(row.amount) });
}

function entryResponse(row) {
  return timestamps({ ...row, amount: numericApi(row.amount), balance: numericApi(row.balance) });
}

async function checkActor(tx, actor) {
  const [row] = await tx.$queryRaw`
    SELECT id FROM "user"
    WHERE id = ${actor.userId} AND role::text = ${actor.role} AND
      is_active AND password_hash IS NOT NULL FOR SHARE
  `;
  if (!row) throw new UnauthorizedError();
}

// Call inside an interactive transaction, after acquiring any escrow lock.
async function postTransfer(tx, { from, to, value, type, escrowId, milestoneId, resolutionId, idempotencyKey, requestShape }) {
  if (from.id === to.id || from.currency !== to.currency) throw new ValidationError('Transfer accounts or currencies do not match');
  if (!value.isFinite() || !value.gt(0) || value.gt(API_LIMIT) || value.decimalPlaces() > 8) {
    throw new ValidationError('Transfer amount exceeds the supported precision or range');
  }
  const accounts = await tx.$queryRaw`
    SELECT id, currency, type::text, status::text, user_id, escrow_id FROM account
    WHERE id IN (${from.id}, ${to.id}) ORDER BY id FOR UPDATE
  `;
  if (accounts.length !== 2 || accounts.some(row => row.status !== 'ACTIVE' || row.currency !== from.currency)) {
    throw new ValidationError('Both accounts must be active and use the same currency');
  }
  if ([from, to].some(account => {
    const row = accounts.find(locked => locked.id === account.id);
    return row.type !== account.type || row.user_id !== account.userId || row.escrow_id !== account.escrowId;
  })) throw new ConflictError('Account ownership changed during the transfer');
  const available = await ledgerBalance(tx, from.id);
  if (accounts.find(row => row.id === from.id).type !== 'EXTERNAL' && available.lt(value.toString())) {
    throw new InsufficientBalanceError(from.id, value.toString(), available.toString());
  }
  const debitBalance = available.minus(value.toString());
  const creditBalance = (await ledgerBalance(tx, to.id)).plus(value.toString());
  if ([debitBalance, creditBalance].some(balance => balance.abs().gt(API_LIMIT))) throw new ValidationError('Transfer exceeds the supported account balance limit');
  const [{ postedAt }] = await tx.$queryRaw`
    SELECT greatest(date_trunc('milliseconds', clock_timestamp()), max(created_at) + interval '1 millisecond') AS "postedAt"
    FROM ledger_entry WHERE account_id IN (${from.id}, ${to.id})
  `;
  const persisted = value.toString();
  const currency = from.currency;
  const transaction = await tx.transaction.create({
    data: {
      escrowId, milestoneId, resolutionId, fromAccountId: from.id, toAccountId: to.id, amount: persisted,
      currency, type, status: 'COMPLETED', idempotencyKey, requestShape, createdAt: postedAt, updatedAt: postedAt,
    },
  });
  await tx.ledgerEntry.createMany({
    data: [
      { transactionId: transaction.id, accountId: from.id, type: 'DEBIT', amount: persisted, balance: debitBalance.toString(), currency, createdAt: postedAt },
      { transactionId: transaction.id, accountId: to.id, type: 'CREDIT', amount: persisted, balance: creditBalance.toString(), currency, createdAt: postedAt },
    ],
  });
  return { transaction, debitBalance, creditBalance };
}

async function runTransaction(db, action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(action, { isolationLevel: 'ReadCommitted', timeout: 15000 });
    } catch (error) {
      if (error.code === 'P2002') throw new ConflictError('A conflicting financial record already exists');
      const retryable = error.code === 'P2034' || ['40P01', '40001'].includes(error.meta?.code);
      if (retryable && attempt < 2) continue;
      if (retryable) throw new ConflictError('A concurrent operation could not be completed. Retry the request.');
      throw error;
    }
  }
}

async function clearingAccount(tx, currency) {
  await tx.$executeRaw`
    INSERT INTO account (id, type, currency, updated_at)
    VALUES (${randomUUID()}, 'EXTERNAL', ${currency}, now())
    ON CONFLICT (currency) WHERE type = 'EXTERNAL' DO NOTHING
  `;
  return tx.account.findFirstOrThrow({ where: { type: 'EXTERNAL', currency } });
}

function walletResponse(wallet, balance, transaction) {
  const { id, userId, currency, type, createdAt } = wallet;
  return { transaction: transactionResponse(transaction), account: { id, userId, currency, type, createdAt: createdAt.getTime(), balance: numericApi(balance) } };
}

function postgresLedger(db, core) {
  function walletTransfer(actor, id, type, input, key) {
    const value = amount(input, 'amount', 2);
    if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key)) throw new ValidationError('Supply an Idempotency-Key header of 1–128 visible characters');
    const idempotencyKey = createHash('sha256').update(JSON.stringify([actor.userId, type, key])).digest('hex');
    const requestShape = JSON.stringify({ id, amount: value.toString() });
    return runTransaction(db, async tx => {
      await checkActor(tx, actor);
      const wallet = await tx.account.findUnique({ where: { id } });
      if (!wallet) throw new NotFoundError('Account', id);
      if (!['CLIENT', 'PROVIDER'].includes(actor.role) || wallet.type !== 'PERSONAL' || wallet.userId !== actor.userId) throw new UnauthorizedError();
      if (wallet.status !== 'ACTIVE') throw new ValidationError('The wallet is inactive');
      // Serialize identical keys even when conflicting requests name different accounts.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`;
      const prior = await tx.transaction.findUnique({ where: { idempotencyKey } });
      const deposit = type === 'DEPOSIT';
      if (prior) {
        if (prior.requestShape !== requestShape || prior.status !== 'COMPLETED') throw new ConflictError('Idempotency key was already used for a different request');
        const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { transactionId_type: {
          transactionId: prior.id, type: deposit ? 'CREDIT' : 'DEBIT',
        } } });
        return walletResponse(wallet, entry.balance, prior);
      }
      const clearing = await clearingAccount(tx, wallet.currency);
      const posting = await postTransfer(tx, {
        from: deposit ? clearing : wallet, to: deposit ? wallet : clearing,
        value, type, idempotencyKey, requestShape,
      });
      return walletResponse(wallet, deposit ? posting.creditBalance : posting.debitBalance, posting.transaction);
    });
  }

  async function accountHistory(id, actor, ledger) {
    await core.getAccount({ id }, actor);
    return ledger
      ? (await db.ledgerEntry.findMany({ where: { accountId: id }, orderBy })).map(entryResponse)
      : (await db.transaction.findMany({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] }, orderBy })).map(transactionResponse);
  }

  async function escrowHistory(id, actor, ledger) {
    await core.getEscrow(id, actor);
    return ledger
      ? (await db.ledgerEntry.findMany({ where: { transaction: { escrowId: id } }, orderBy })).map(entryResponse)
      : (await db.transaction.findMany({ where: { escrowId: id }, orderBy })).map(transactionResponse);
  }

  async function transactionDetails(id, actor, ledger) {
    const row = await db.transaction.findUnique({ where: { id }, include: { source: true, destination: true, escrow: true } });
    if (!row) throw new NotFoundError('Transaction', id);
    const { source, destination, escrow, ...transaction } = row;
    if (actor.role !== 'ADMIN') {
      if (escrow) assertEscrowAccess(escrow, actor);
      else if (![source, destination].some(account => account.type === 'PERSONAL' && account.userId === actor.userId)) throw new UnauthorizedError();
    }
    return ledger
      ? (await db.ledgerEntry.findMany({ where: { transactionId: id }, orderBy })).map(entryResponse)
      : transactionResponse(transaction);
  }

  async function validateLedger() {
    const [rows, holdings] = await db.$transaction([db.$queryRaw`
      SELECT t.id AS "transactionId", t.status::text, t.amount,
        count(e.id)::int AS entries,
        count(e.id) FILTER (WHERE e.amount = t.amount AND
          ((e.type = 'DEBIT' AND e.account_id = t.from_account_id)
          OR (e.type = 'CREDIT' AND e.account_id = t.to_account_id)))::int AS matching,
        coalesce(sum(e.amount) FILTER (WHERE e.type = 'DEBIT'), 0) AS debits,
        coalesce(sum(e.amount) FILTER (WHERE e.type = 'CREDIT'), 0) AS credits
      FROM "transaction" t LEFT JOIN ledger_entry e ON e.transaction_id = t.id
      GROUP BY t.id ORDER BY t.created_at, t.id
    `, heldBalances(db, Prisma.empty)], { isolationLevel: 'RepeatableRead' });
    const results = rows.map(row => ({
      transactionId: row.transactionId,
      balanced: row.status === 'COMPLETED' ? row.entries === 2 && row.matching === 2 : row.entries === 0,
      totalDebits: numericApi(row.debits), totalCredits: numericApi(row.credits),
    }));
    return { totalTransactions: results.length, allBalanced: results.every(row => row.balanced), results, escrowHeld: numericApi(holdings[0].balance) };
  }

  async function participantHoldings(actor) {
    if (!['CLIENT', 'PROVIDER'].includes(actor.role)) throw new UnauthorizedError();
    const scope = actor.role === 'CLIENT'
      ? Prisma.sql`AND escrow.client_id = ${actor.userId}`
      : Prisma.sql`AND escrow.provider_id = ${actor.userId}`;
    const [row] = await heldBalances(db, scope);
    return { balance: numericApi(row.balance), currency: 'INR' };
  }

  return { walletTransfer, accountHistory, escrowHistory, transactionDetails, validateLedger, participantHoldings };
}

module.exports = { postgresLedger, checkActor, postTransfer, runTransaction, transactionResponse };
