const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, test } = require('node:test');

process.env.NODE_ENV = 'test';
const { getPrisma } = require('../src/data/prisma');
const prisma = getPrisma();
after(() => prisma.$disconnect());

const rollback = new Error('Rollback integrity test fixtures');

async function exercise(check) {
  try {
    await prisma.$transaction(async tx => {
      const [identity] = await tx.$queryRaw`
        SELECT current_database() AS database, current_user AS role
      `;
      assert.equal(identity.database, 'secureescrow_test');
      assert.equal(identity.role, 'secureescrow_test');
      const client = await tx.user.create({ data: { role: 'CLIENT' } });
      const provider = await tx.user.create({ data: { role: 'PROVIDER' } });
      const escrow = await tx.escrow.create({ data: {
        clientId: client.id, providerId: provider.id, title: 'Constraint check',
        totalAmount: '10.25', releaseModel: 'CONDITION_BASED',
      } });
      const source = await tx.account.create({ data: { type: 'PERSONAL', userId: client.id } });
      const holding = await tx.account.create({ data: { type: 'ESCROW', escrowId: escrow.id } });
      const recipient = await tx.account.create({ data: { type: 'PERSONAL', userId: provider.id } });
      const fund = {
        escrowId: escrow.id, fromAccountId: source.id, toAccountId: holding.id,
        type: 'FUND', amount: '10.25', currency: 'INR', status: 'COMPLETED',
      };
      await check(tx, { client, escrow, holding, recipient, fund });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function post(tx, data) {
  const transfer = await tx.transaction.create({ data });
  await tx.ledgerEntry.createMany({ data: [
    { transactionId: transfer.id, accountId: data.fromAccountId, type: 'DEBIT', amount: data.amount, balance: '0', currency: data.currency },
    { transactionId: transfer.id, accountId: data.toAccountId, type: 'CREDIT', amount: data.amount, balance: data.amount, currency: data.currency },
  ] });
  return transfer;
}

test('accepts a balanced exact-decimal posting', () => exercise(async (tx, { fund }) => {
  const transfer = await post(tx, fund);
  assert.equal(transfer.amount.toString(), '10.25');
}));

test('rejects a completed transfer without both entries', () =>
  assert.rejects(exercise((tx, { fund }) => tx.transaction.create({ data: fund })),
    error => error.code === 'P2010' && error.meta?.code === '23514' && error.message.includes('Invalid ledger posting')));

test('rejects transfers across different currencies', () =>
  assert.rejects(exercise((tx, { fund }) => tx.transaction.create({ data: { ...fund, currency: 'USD' } })),
    { code: 'P2003' }));

test('rejects duplicate normal funding', () =>
  assert.rejects(exercise(async (tx, { fund }) => {
    await post(tx, fund);
    await tx.transaction.create({ data: fund });
  }), { code: 'P2002' }));

test('rejects ledger edits', () =>
  assert.rejects(exercise(async (tx, { fund }) => {
    const transfer = await post(tx, fund);
    await tx.$executeRaw`UPDATE ledger_entry SET amount = 1 WHERE transaction_id = ${transfer.id}`;
  }), error => error.meta?.code === '23514' && error.message.includes('Ledger entries are append-only')));

test('rejects completed transfer edits', () =>
  assert.rejects(exercise(async (tx, { fund }) => {
    const transfer = await post(tx, fund);
    await tx.$executeRaw`UPDATE "transaction" SET amount = 1 WHERE id = ${transfer.id}`;
  }), error => error.meta?.code === '23514' && error.message.includes('Completed transfers are immutable')));

test('rejects a dispute allocation whose amount disagrees with its transfer', () =>
  assert.rejects(exercise(async (tx, { client, escrow, holding, recipient }) => {
    const dispute = await tx.dispute.create({ data: {
      escrowId: escrow.id, raisedBy: client.id, title: 'Constraint check',
      category: 'OTHER', reason: 'Constraint check', requestedResolution: 'RELEASE',
    } });
    const admin = await tx.user.create({ data: { role: 'ADMIN' } });
    const resolution = await tx.disputeResolution.create({ data: {
      disputeId: dispute.id, resolvedBy: admin.id, decision: 'RELEASE_TO_PROVIDER',
      reasoning: 'Constraint check', idempotencyKey: randomUUID(), requestShape: '{}',
    } });
    const transfer = await post(tx, {
      escrowId: escrow.id, resolutionId: resolution.id, fromAccountId: holding.id,
      toAccountId: recipient.id, amount: '10.25', currency: 'INR', type: 'RELEASE', status: 'COMPLETED',
    });
    const allocation = {
      resolutionId: resolution.id, transactionId: transfer.id, recipientAccountId: recipient.id,
      amount: '10.25', currency: 'INR', type: 'RELEASE',
    };
    const good = await tx.disputeResolutionAllocation.create({ data: allocation });
    await tx.disputeResolutionAllocation.update({ where: { id: good.id }, data: { amount: '1' } });
  }), error => error.code === 'P2003' && error.message.includes('allocation_transfer_match_fkey')));

test('rejects a transfer that attempts to use a resolution outside its disputed milestone', () =>
  assert.rejects(exercise(async (tx, { client, escrow, holding, recipient }) => {
    const milestone = await tx.milestone.create({ data: {
      escrowId: escrow.id, title: 'Scope check', amount: '10.25', order: 1,
    } });
    const dispute = await tx.dispute.create({ data: {
      escrowId: escrow.id, milestoneId: milestone.id, raisedBy: client.id, title: 'Constraint check',
      category: 'OTHER', reason: 'Constraint check', requestedResolution: 'RELEASE',
    } });
    const admin = await tx.user.create({ data: { role: 'ADMIN' } });
    const resolution = await tx.disputeResolution.create({ data: {
      disputeId: dispute.id, resolvedBy: admin.id, decision: 'RELEASE_TO_PROVIDER',
      reasoning: 'Constraint check', idempotencyKey: randomUUID(), requestShape: '{}',
    } });
    await tx.$executeRaw`
      INSERT INTO "transaction" (id, escrow_id, resolution_id, from_account_id, to_account_id, type, amount, currency, updated_at)
      VALUES (${randomUUID()}, ${escrow.id}, ${resolution.id}, ${holding.id}, ${recipient.id}, 'RELEASE', 10.25, 'INR', now())
    `;
  }), error => error.meta?.code === '23514' && error.message.includes('Resolution transfer must match its dispute scope')));
