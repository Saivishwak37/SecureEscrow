const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const createPostgresApp = require('../src/postgresApp');
const { Decimal } = require('../src/domain/postgresMoney');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '15m';

const { sandbox, openBackend, overlap, verify } = require('./postgres-test-fixture');

test('PostgreSQL financial workflows', async t => {
  const fixture = await sandbox(t);
  const db = fixture.connect();
  const peer = fixture.connect();
  assert.deepEqual(await db.$queryRaw`SELECT current_schema() AS name`, [{ name: fixture.schema }]);
  const app = request(createPostgresApp(db));
  const concurrentApp = request(createPostgresApp(peer));
  const password = 'FinancialTest123';
  async function identity(username, role) {
    const email = `${username}@example.test`;
    verify(await app.post('/api/auth/register').send({ username, email, password, role }), 201);
    const identity = verify(await app.post('/api/auth/login').send({ email, password }), 200);
    identity.wallet = verify(await get(identity, `/api/accounts/user/${identity.user.id}`), 200);
    return identity;
  }
  const get = (actor, path, target = app) => target.get(path).set('Authorization', 'Bearer ' + actor.accessToken);
  const post = (actor, path, data = {}, target = app) => target.post(path).set('Authorization', 'Bearer ' + actor.accessToken).send(data);
  const wallet = (actor, operation, amount, key = randomUUID(), target = app, id = actor.wallet.id) =>
    post(actor, `/api/accounts/${id}/${operation}`, { amount }, target).set('Idempotency-Key', key);
  const client = await identity('phase-three-client', 'CLIENT');
  const provider = await identity('phase-three-provider', 'PROVIDER');
  const outsider = await identity('phase-three-outsider', 'CLIENT');
  const create = async (title, amount, conditions = null) => verify(await post(client, '/api/escrows', {
    title, totalAmount: amount, providerId: provider.user.id,
    ...(conditions
      ? { releaseModel: 'CONDITION_BASED', conditions }
      : { milestones: [{ title: 'Milestone', description: 'A deliverable', amount }] }),
  }), 201);
  const milestoneFor = async escrow => verify(await get(client, `/api/escrows/${escrow.id}/milestones`), 200)[0];
  const balance = async (actor, target = app) => verify(await get(actor, `/api/accounts/${actor.wallet.id}`, target), 200).balance;
  let deposit, milestoneEscrow, milestone, conditionEscrow;

  await t.test('wallet validation, decimal postings, retries, and history authorization', async () => {
    verify(await wallet(client, 'withdraw', 1), 400);
    for (const value of [0, -1, 1.001, '2', 50_000_001]) verify(await wallet(client, 'deposit', value), 400);
    verify(await app.post(`/api/accounts/${client.wallet.id}/deposit`).set('Authorization', 'Bearer ' + client.accessToken)
      .set('Idempotency-Key', randomUUID()).type('json').send('{"amount":1.00000000000000001}'), 400);
    verify(await wallet(provider, 'deposit', 1, randomUUID(), app, client.wallet.id), 403);
    verify(await post(client, `/api/accounts/${client.wallet.id}/deposit`, { amount: 1, userId: outsider.user.id }).set('Idempotency-Key', randomUUID()), 403);
    const key = randomUUID();
    const first = verify(await wallet(client, 'deposit', 30.25, key), 201);
    deposit = first.transaction;
    assert.equal(first.account.balance, 30.25);
    assert.equal(verify(await wallet(client, 'withdraw', 0.25), 201).account.balance, 30);
    assert.deepEqual(verify(await wallet(client, 'deposit', 30.25, key), 201), first);
    verify(await wallet(client, 'deposit', 30.26, key), 409);
    assert.equal(await balance(client), 30);
    assert.equal(verify(await get(client, `/api/transactions/${deposit.id}`), 200).id, deposit.id);
    const pair = verify(await get(client, `/api/transactions/${deposit.id}/ledger`), 200);
    assert.deepEqual(pair.map(row => row.amount), [30.25, 30.25]);
    for (const endpoint of [
      `/api/accounts/${client.wallet.id}/ledger`, `/api/accounts/${client.wallet.id}/transactions`,
      `/api/transactions/${deposit.id}`, `/api/transactions/${deposit.id}/ledger`, '/api/transactions/validation/ledger',
    ]) verify(await get(outsider, endpoint), 403);
  });

  await t.test('independent transactions serialize withdrawals and concurrent identical retry keys', async () => {
    const lock = tx => tx.$queryRaw`SELECT id FROM account WHERE id = ${client.wallet.id} FOR UPDATE`;
    const key = randomUUID();
    const same = await overlap(db, lock, [
      () => wallet(client, 'deposit', 10, key, app), () => wallet(client, 'deposit', 10, key, concurrentApp),
    ]);
    assert.equal(verify(same[0], 201).transaction.id, verify(same[1], 201).transaction.id);
    assert.equal(await balance(client), 40);
    const responses = await overlap(db, lock, [
      () => wallet(client, 'withdraw', 25, randomUUID(), app), () => wallet(client, 'withdraw', 25, randomUUID(), concurrentApp),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
    assert.equal(await balance(client), 15);
    assert.equal(await db.transaction.count({ where: { type: 'WITHDRAWAL', fromAccountId: client.wallet.id } }), 2);
  });

  await t.test('funding and the full milestone lifecycle with concurrent funding and release', async () => {
    milestoneEscrow = await create('Concurrent milestone', 7.12345678);
    milestone = await milestoneFor(milestoneEscrow);
    const id = milestoneEscrow.id;
    const path = `/api/milestones/${milestone.id}`;
    const fund = `/api/escrows/${id}/fund`;
    const body = { milestoneId: milestone.id };
    const lock = tx => tx.$queryRaw`SELECT id FROM escrow WHERE id = ${id} FOR UPDATE`;
    verify(await post(outsider, fund, body), 403);
    verify(await post(provider, fund, body), 403);
    verify(await post(client, fund, { ...body, fromAccountId: outsider.wallet.id }), 400);
    verify(await post(provider, `/api/escrows/${id}/start`, body), 400);
    verify(await post(client, path + '/release'), 400);
    const funded = await overlap(db, lock, [() => post(client, fund, body), () => post(client, fund, body, concurrentApp)]);
    assert.deepEqual(funded.map(response => response.status).sort(), [200, 409]);
    assert.equal(await balance(client), 7.87654322);
    verify(await post(provider, `/api/escrows/${id}/start`, body), 200);
    const attachment = { name: 'work.txt', type: 'text/plain', data: 'data:text/plain;base64,SGVsbG8=' };
    verify(await post(client, path + '/submit', { attachments: [attachment] }), 403);
    verify(await post(provider, path + '/submit', { attachments: [attachment] }), 200);
    verify(await post(client, path + '/review'), 200);
    verify(await post(client, path + '/reject', { feedback: 'Please revise' }), 200);
    verify(await post(provider, path + '/submit', { attachments: [attachment] }), 200);
    verify(await post(client, path + '/review'), 200);
    verify(await post(client, path + '/approve'), 200);
    verify(await post(outsider, path + '/release'), 403);
    verify(await post(client, path + '/release', { recipientAccountId: outsider.wallet.id }), 400);
    await db.escrow.update({ where: { id }, data: { status: 'DISPUTED' } });
    verify(await post(client, path + '/release'), 400);
    await db.escrow.update({ where: { id }, data: { status: 'APPROVED' } });
    const dispute = await db.dispute.create({ data: {
      escrowId: id, raisedBy: client.user.id, title: 'Freeze fixture', category: 'OTHER',
      reason: 'Existing active dispute', requestedResolution: 'RELEASE',
    } });
    verify(await post(client, path + '/release'), 400);
    await db.dispute.update({ where: { id: dispute.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    const releases = await overlap(db, lock, [() => post(client, path + '/release'), () => post(client, path + '/release', {}, concurrentApp)]);
    assert.deepEqual(releases.map(response => response.status).sort(), [200, 409]);
    assert.equal(await balance(provider), 7.12345678);
    assert.equal(await balance(outsider), 0);
    const saved = verify(await get(client, path), 200);
    assert.deepEqual(saved.submissions.map(row => row.reviewFeedback), ['Please revise', null]);
    assert.equal(await db.milestoneStatusHistory.count({ where: { milestoneId: milestone.id } }), 9);
    assert.equal((await db.escrow.findUnique({ where: { id } })).status, 'RELEASED');
  });

  await t.test('condition funding, required review, deadline satisfaction and release', async () => {
    conditionEscrow = await create('Required release checks', 3.23, [
      { type: 'CLIENT_APPROVAL' }, { type: 'WORK_SUBMITTED' },
      { type: 'DEADLINE_REACHED', config: { deadline: '2020-01-01' } },
    ]);
    const id = conditionEscrow.id;
    const root = `/api/escrows/${id}`;
    const approval = conditionEscrow.conditions.find(row => row.type === 'CLIENT_APPROVAL');
    const work = conditionEscrow.conditions.find(row => row.type === 'WORK_SUBMITTED');
    verify(await post(client, `/api/conditions/${approval.id}/satisfy`), 400);
    const eligibility = async () => verify(await get(client, root + '/release-eligibility'), 200);
    assert.equal((await eligibility()).eligible, false);
    verify(await post(client, root + '/fund'), 200);
    verify(await post(client, root + '/fund'), 409);
    verify(await post(client, root + '/release'), 400);
    verify(await post(provider, `/api/conditions/${approval.id}/satisfy`), 403);
    verify(await post(client, `/api/conditions/${approval.id}/satisfy`), 200);
    verify(await post(provider, `/api/conditions/${work.id}/satisfy`, { evidence: 'Work delivered' }), 200);
    assert.equal((await eligibility()).eligible, false);
    verify(await post(client, `/api/conditions/${work.id}/review`, { decision: 'APPROVE' }), 200);
    const ready = await eligibility();
    assert.equal(ready.eligible, true);
    assert.equal(ready.conditions.find(row => row.type === 'DEADLINE_REACHED').satisfiedBy, 'SYSTEM');
    verify(await post(client, root + '/release'), 200);
    verify(await post(client, root + '/release'), 409);
    assert.equal(await balance(provider), 10.35345678);
    assert.deepEqual(verify(await get(client, root + '/disputes'), 200), []);
    verify(await get(outsider, root + '/ledger'), 403);
  });

  await t.test('all coordinated writes roll back after real posting and state failures', async () => {
    const escrow = await create('Rollback fixture', 1);
    const item = await milestoneFor(escrow);
    const path = `/api/escrows/${escrow.id}/fund`;
    const prior = await balance(client);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION force_financial_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'milestone' THEN
          IF NEW.status = 'FUNDED' THEN RAISE EXCEPTION 'fixture state failure'; END IF;
        ELSIF TG_ARGV[0] = NEW.type::text THEN
          RAISE EXCEPTION 'fixture entry failure';
        END IF;
        RETURN NEW;
      END;
      $$`);
    for (const [table, event, fixtureType] of [
      ['ledger_entry', 'INSERT', 'DEBIT'], ['ledger_entry', 'INSERT', 'CREDIT'], ['milestone', 'UPDATE', 'STATE'],
    ]) {
      await db.$executeRawUnsafe(`CREATE TRIGGER force_failure BEFORE ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION force_financial_failure('${fixtureType}')`);
      try { verify(await post(client, path, { milestoneId: item.id }), 500); }
      finally { await db.$executeRawUnsafe(`DROP TRIGGER force_failure ON ${table}`); }
      assert.equal(await balance(client), prior);
      assert.equal(await db.transaction.count({ where: { escrowId: escrow.id } }), 0);
      const holding = await db.account.findUnique({ where: { escrowId: escrow.id } });
      assert.equal(await db.ledgerEntry.count({ where: { accountId: holding.id } }), 0);
      assert.equal((await db.milestone.findUnique({ where: { id: item.id } })).status, 'CREATED');
      assert.equal(await db.milestoneStatusHistory.count({ where: { milestoneId: item.id } }), 0);
      assert.equal(await db.escrowStatusHistory.count({ where: { escrowId: escrow.id } }), 1);
    }
    const costly = await create('Insufficient balance', 500);
    const costlyMilestone = await milestoneFor(costly);
    verify(await post(client, `/api/escrows/${costly.id}/fund`, { milestoneId: costlyMilestone.id }), 400);
    assert.equal(await db.transaction.count({ where: { escrowId: costly.id } }), 0);
  });

  await t.test('ledger totals reconcile exactly, histories stay immutable, and the audit is restricted', async () => {
    const transactions = await db.transaction.findMany({ include: { ledgerEntryViaTransaction: true } });
    assert.ok(transactions.length > 5);
    for (const transaction of transactions) {
      assert.equal(transaction.status, 'COMPLETED');
      assert.equal(transaction.ledgerEntryViaTransaction.length, 2);
      for (const entry of transaction.ledgerEntryViaTransaction) {
        assert.ok(entry.amount.eq(transaction.amount));
        assert.equal(entry.currency, transaction.currency);
      }
    }
    assert.equal(await balance(client), 4.64654322);
    for (const actor of [client, provider, outsider]) {
      const entries = verify(await get(actor, `/api/accounts/${actor.wallet.id}/ledger`), 200);
      const net = entries.reduce((sum, entry) => entry.type === 'CREDIT' ? sum.plus(entry.amount) : sum.minus(entry.amount), new Decimal(0));
      assert.equal(net.toNumber(), await balance(actor));
      assert.ok(entries.every(entry => entry.balance >= 0));
    }
    await assert.rejects(db.$executeRaw`UPDATE "transaction" SET amount = 1 WHERE id = ${deposit.id}`, /Completed transfers are immutable/);
    await assert.rejects(db.$executeRaw`DELETE FROM ledger_entry WHERE transaction_id = ${deposit.id}`, /Ledger entries are append-only/);
    const email = 'audit-test@example.test';
    await db.user.create({ data: { username: 'audit-test', email, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 4) } });
    const auditor = verify(await app.post('/api/auth/login').send({ email, password }), 200);
    const audit = verify(await get(auditor, '/api/transactions/validation/ledger'), 200);
    assert.equal(audit.totalTransactions, transactions.length);
    assert.ok(audit.allBalanced);
    assert.equal(audit.escrowHeld, 0);
  });

  await t.test('committed balances, ledger and release states survive backend process restart', async () => {
    const first = await openBackend(fixture.url);
    try { assert.equal(await balance(client, first.api), 4.64654322); }
    finally { await first.stop(); }
    const second = await openBackend(fixture.url);
    try {
      assert.equal(await balance(provider, second.api), 10.35345678);
      assert.equal(verify(await get(client, `/api/transactions/${deposit.id}/ledger`, second.api), 200).length, 2);
      for (const escrow of [milestoneEscrow, conditionEscrow]) {
        assert.equal(verify(await get(client, `/api/escrows/${escrow.id}`, second.api), 200).status, 'RELEASED');
        const entries = verify(await get(client, `/api/escrows/${escrow.id}/transactions`, second.api), 200);
        assert.deepEqual(entries.map(entry => entry.type), ['FUND', 'RELEASE']);
      }
    } finally { await second.stop(); }
  });

  await t.test('funding and withdrawal share the same wallet lock', async () => {
    const escrow = verify(await post(outsider, '/api/escrows', {
      title: 'Shared wallet', totalAmount: 6, providerId: provider.user.id,
      releaseModel: 'CONDITION_BASED', conditions: [{ type: 'CLIENT_APPROVAL' }],
    }), 201);
    verify(await wallet(outsider, 'deposit', 10), 201);
    const lock = tx => tx.$queryRaw`SELECT id FROM account WHERE id = ${outsider.wallet.id} FOR UPDATE`;
    const [fund, withdraw] = await overlap(db, lock, [
      () => post(outsider, `/api/escrows/${escrow.id}/fund`),
      () => wallet(outsider, 'withdraw', 6, randomUUID(), concurrentApp),
    ]);
    assert.ok((fund.status === 200 && withdraw.status === 400) || (fund.status === 400 && withdraw.status === 201));
    assert.equal(await balance(outsider), 4);
    const entries = verify(await get(outsider, `/api/accounts/${outsider.wallet.id}/ledger`), 200);
    assert.deepEqual(entries.map(entry => entry.balance), [10, 4]);
    assert.ok(entries[0].createdAt < entries[1].createdAt);
  });
});
