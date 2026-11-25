const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { sandbox, openBackend, overlap, verify } = require('./postgres-test-fixture');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '15m';

test('PostgreSQL dispute workflows', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'secureescrow-evidence-'));
  process.env.DISPUTE_EVIDENCE_STORAGE_DIR = directory;
  t.after(async () => {
    for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
    await fs.rmdir(directory);
  });
  const createPostgresApp = require('../src/postgresApp');
  assert.equal(require('../src/middleware/disputeEvidenceUpload').STORAGE_DIR, directory);
  const fixture = await sandbox(t);
  const db = fixture.connect();
  const app = request(createPostgresApp(db));
  const peer = request(createPostgresApp(fixture.connect()));
  const password = 'DisputeFixture123';
  const auth = (target, method, route, actor) => target[method](route).set('Authorization', 'Bearer ' + actor.accessToken);
  const get = (actor, route, target = app) => auth(target, 'get', route, actor);
  const post = (actor, route, body = {}, target = app) => auth(target, 'post', route, actor).send(body);
  async function user(username, role) {
    const email = `${username}@example.test`;
    if (role === 'ADMIN') {
      await db.user.create({ data: { username, email, role, passwordHash: await bcrypt.hash(password, 4) } });
    } else {
      verify(await app.post('/api/auth/register').send({ username, email, role, password }), 201);
    }
    const actor = verify(await app.post('/api/auth/login').send({ email, password }), 200);
    if (role !== 'ADMIN') actor.wallet = verify(await get(actor, `/api/accounts/user/${actor.user.id}`), 200);
    return actor;
  }
  const client = await user('dispute-client', 'CLIENT');
  const provider = await user('dispute-provider', 'PROVIDER');
  const outsider = await user('dispute-outsider', 'CLIENT');
  const admin = await user('dispute-admin', 'ADMIN');
  const otherAdmin = await user('other-dispute-admin', 'ADMIN');
  verify(await post(client, `/api/accounts/${client.wallet.id}/deposit`, { amount: 200 }).set('Idempotency-Key', randomUUID()), 201);
  const escrowPath = escrow => `/api/escrows/${escrow.id}`;
  const base = id => `/api/disputes/${id}`;
  const opening = { title: 'Need review', description: 'Fixture issue', requestedResolution: 'OTHER', category: 'OTHER' };
  const open = (escrow, actor = client, detail = {}, target = app) => post(actor, escrowPath(escrow) + '/disputes', { ...opening, ...detail }, target);
  const resolve = (id, actor, decision, details = {}, target = app) =>
    post(actor, base(id) + '/resolve', { decision, reasoning: 'Fixture reasoning', idempotencyKey: randomUUID(), ...details }, target);
  const balance = async actor => verify(await get(actor, `/api/accounts/${actor.wallet.id}`), 200).balance;
  const lock = escrow => tx => tx.$queryRaw`SELECT id FROM escrow WHERE id = ${escrow.id} FOR UPDATE`;
  async function funded(totalAmount = 10, milestones) {
    const escrow = verify(await post(client, '/api/escrows', {
      title: 'Dispute fixture', providerId: provider.user.id, totalAmount,
      ...(milestones ? { milestones: milestones.map(amount => ({ title: 'Milestone', description: 'Deliverable', amount })) }
        : { releaseModel: 'CONDITION_BASED', conditions: [{ type: 'CLIENT_APPROVAL' }] }),
    }), 201);
    if (milestones) {
      escrow.milestones = verify(await get(client, escrowPath(escrow) + '/milestones'), 200);
      for (const item of escrow.milestones) verify(await post(client, escrowPath(escrow) + '/fund', { milestoneId: item.id }), 200);
    } else {
      verify(await post(client, escrowPath(escrow) + '/fund'), 200);
    }
    return escrow;
  }
  const bytes = Buffer.from('%PDF-1.4\nfixture PDF\n%%EOF\n');
  const upload = (actor, id, file = bytes) => auth(app, 'post', base(id) + '/evidence', actor)
    .field('description', 'Private evidence').attach('file', file, { filename: 'fixture.pdf', contentType: 'application/pdf' });
  let original, initialEscrow, evidence;

  await t.test('participants open exactly one dispute and atomically freeze the escrow', async () => {
    initialEscrow = await funded(11.12345678);
    verify(await open(initialEscrow, outsider), 403);
    verify(await open(initialEscrow, admin), 403);
    verify(await open(initialEscrow, client, { actorId: outsider.user.id }), 403);
    const attempts = await overlap(db, lock(initialEscrow), [
      () => open(initialEscrow), () => open(initialEscrow, provider, {}, peer),
    ]);
    assert.deepEqual(attempts.map(row => row.status).sort(), [201, 409]);
    original = attempts.find(row => row.status === 201).body.data;
    assert.ok([client.user.id, provider.user.id].includes(original.raisedBy));
    assert.equal(verify(await get(admin, escrowPath(initialEscrow) + '/disputes'), 200)[0].id, original.id);
    assert.deepEqual(verify(await get(admin, escrowPath(initialEscrow) + '/disputes?status=RESOLVED'), 200), []);
    verify(await get(admin, escrowPath(initialEscrow) + '/disputes?status=UNKNOWN'), 400);
    assert.equal(verify(await get(client, escrowPath(initialEscrow)), 200).status, 'DISPUTED');
    assert.equal(verify(await get(provider, base(original.id) + '/history'), 200)[0].changedBy, original.raisedBy);
    verify(await get(outsider, base(original.id)), 403);
    verify(await get(outsider, escrowPath(initialEscrow) + '/disputes'), 403);
    verify(await post(client, escrowPath(initialEscrow) + '/release'), 400);
    for (const actor of [client, provider]) {
      verify(await resolve(original.id, actor, 'RELEASE_TO_PROVIDER'), 403);
      verify(await auth(app, 'patch', base(original.id) + '/status', actor).send({ status: 'UNDER_REVIEW', reason: 'Review' }), 403);
    }
    verify(await post(admin, '/api/users', { name: 'Test profile', type: 'CLIENT' }), 201);
    verify(await post(admin, '/api/users', { name: 'No admin provisioning', type: 'ADMIN' }), 400);
  });

  await t.test('evidence stays private, metadata failures clean files, and messages persist in order', async () => {
    const id = original.id;
    verify(await upload(outsider, id), 403);
    verify(await upload(admin, id), 403);
    verify(await upload(client, id, Buffer.from('invalid')), 400);
    assert.deepEqual(await fs.readdir(directory), []);
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_evidence_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER reject_evidence_fixture BEFORE INSERT ON dispute_evidence FOR EACH ROW EXECUTE FUNCTION reject_evidence_fixture()');
    try { verify(await upload(client, id), 500); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER reject_evidence_fixture ON dispute_evidence'); }
    assert.deepEqual(await fs.readdir(directory), []);
    evidence = verify(await upload(provider, id), 201);
    assert.equal(evidence.uploadedBy, provider.user.id);
    assert.equal(evidence.storageKey, undefined);
    assert.equal((await db.disputeEvidence.findUnique({ where: { id: evidence.id } })).fileSize, bytes.length);
    verify(await get(outsider, evidence.downloadUrl), 403);
    assert.equal((await app.get(evidence.downloadUrl)).status, 401);
    assert.equal((await get(admin, evidence.downloadUrl)).status, 200);
    verify(await post(outsider, base(id) + '/messages', { message: 'no' }), 403);
    verify(await post(admin, base(id) + '/messages', { message: 'no' }), 403);
    verify(await post(client, base(id) + '/messages', { message: 'no', senderId: provider.user.id }), 403);
    verify(await post(provider, base(id) + '/messages', { message: 'first' }), 201);
    verify(await post(client, base(id) + '/messages', { message: 'second' }), 201);
    assert.deepEqual(verify(await get(admin, base(id) + '/messages'), 200).map(row => row.message), ['first', 'second']);
    const result = verify(await auth(app, 'patch', base(id) + '/status', admin).send({ status: 'EVIDENCE_SUBMISSION', reason: 'Collecting evidence' }), 200);
    assert.equal(result.history.changedBy, admin.user.id);
    const other = verify(await open(await funded()), 201);
    assert.equal((await get(client, base(other.id) + '/evidence/' + evidence.id + '/file')).status, 404);
  });

  await t.test('partial and exact split use atomic ledger allocations and replay the original result', async () => {
    const id = original.id;
    const before = await balance(provider);
    const key = randomUUID();
    const partial = verify(await resolve(id, admin, 'PARTIAL_RELEASE', { idempotencyKey: key, providerAmount: 1.00000001 }), 201);
    assert.equal(partial.remainingEscrowBalance, 10.12345677);
    assert.equal(partial.status, 'UNDER_REVIEW');
    assert.equal(await balance(provider), before + 1.00000001);
    assert.equal(verify(await get(client, escrowPath(initialEscrow)), 200).status, 'DISPUTED');
    const replay = verify(await resolve(id, admin, 'PARTIAL_RELEASE', { idempotencyKey: key, providerAmount: 1.00000001 }), 201);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.transactionIds, partial.transactionIds);
    verify(await resolve(id, otherAdmin, 'PARTIAL_RELEASE', { idempotencyKey: key, providerAmount: 1.00000001 }), 403);
    verify(await resolve(id, admin, 'PARTIAL_RELEASE', { idempotencyKey: key, providerAmount: 1 }), 409);
    verify(await resolve(id, admin, 'SPLIT_FUNDS', { providerAmount: 5, clientAmount: 5 }), 400);
    verify(await resolve(id, admin, 'RELEASE_TO_PROVIDER', { recipientAccountId: outsider.wallet.id }), 400);
    const closed = verify(await resolve(id, admin, 'SPLIT_FUNDS', { providerAmount: 4.12345677, clientAmount: 6 }), 201);
    assert.equal(closed.remainingEscrowBalance, 0);
    assert.equal(closed.status, 'RESOLVED');
    assert.equal(verify(await get(client, escrowPath(initialEscrow)), 200).status, 'RESOLVED');
    assert.equal(closed.transactions.length, 2);
    for (const allocation of closed.allocations) {
      const transfer = await db.transaction.findUnique({ where: { id: allocation.transactionId }, include: { ledgerEntryViaTransaction: true } });
      assert.equal(transfer.resolutionId, closed.id);
      assert.equal(transfer.toAccountId, allocation.recipientAccountId);
      assert.equal(transfer.amount.toNumber(), allocation.amount);
      assert.deepEqual(transfer.ledgerEntryViaTransaction.map(row => row.amount.toString()), [transfer.amount.toString(), transfer.amount.toString()]);
    }
    verify(await upload(client, id), 400);
    verify(await post(provider, base(id) + '/messages', { message: 'closed' }), 400);
    assert.equal(verify(await get(client, base(id) + '/evidence'), 200).length, 1);
    assert.equal(verify(await get(admin, base(id) + '/resolutions'), 200).length, 2);
  });

  await t.test('scoped refund preserves other milestones; concurrent final payouts execute only once', async () => {
    const escrow = await funded(12, [5, 7]);
    const [first, second] = escrow.milestones;
    const dispute = verify(await open(escrow, client, { milestoneId: first.id }), 201);
    const clientBefore = await balance(client);
    const attempts = await overlap(db, lock(escrow), [
      () => resolve(dispute.id, admin, 'REFUND_TO_CLIENT'),
      () => resolve(dispute.id, otherAdmin, 'REFUND_TO_CLIENT', {}, peer),
    ]);
    assert.deepEqual(attempts.map(row => row.status).sort(), [201, 400]);
    assert.equal(await balance(client), clientBefore + 5);
    assert.equal((await db.milestone.findUnique({ where: { id: first.id } })).status, 'CANCELLED');
    assert.equal((await db.milestone.findUnique({ where: { id: second.id } })).status, 'FUNDED');
    const next = verify(await open(escrow, provider, { milestoneId: second.id }), 201);
    const providerBefore = await balance(provider);
    const key = randomUUID();
    const replay = await overlap(db, lock(escrow), [
      () => resolve(next.id, admin, 'RELEASE_TO_PROVIDER', { idempotencyKey: key }),
      () => resolve(next.id, admin, 'RELEASE_TO_PROVIDER', { idempotencyKey: key }, peer),
    ]);
    const results = replay.map(response => verify(response, 201));
    assert.equal(results[0].id, results[1].id);
    assert.equal(results.filter(result => result.replayed).length, 1);
    assert.ok(Math.abs((await balance(provider)) - providerBefore - 7) < 1e-8);
    assert.equal((await db.escrow.findUnique({ where: { id: escrow.id } })).status, 'RESOLVED');
  });

  await t.test('normal release cannot race dispute creation or administrative resolution', async () => {
    const escrow = await funded();
    await post(client, `/api/conditions/${escrow.conditions[0].id}/satisfy`).expect(200);
    const outcomes = await overlap(db, lock(escrow), [
      () => open(escrow), () => post(client, escrowPath(escrow) + '/release', {}, peer),
    ]);
    assert.ok((outcomes[0].status === 201 && outcomes[1].status === 400) || (outcomes[0].status === 400 && outcomes[1].status === 200));
    const frozen = await funded();
    verify(await post(client, `/api/conditions/${frozen.conditions[0].id}/satisfy`), 200);
    const dispute = verify(await open(frozen), 201);
    const [decision, normal] = await overlap(db, lock(frozen), [
      () => resolve(dispute.id, admin, 'RELEASE_TO_PROVIDER'),
      () => post(client, escrowPath(frozen) + '/release', {}, peer),
    ]);
    assert.equal(decision.status, 201);
    assert.ok([400, 409].includes(normal.status));
    assert.equal(await db.transaction.count({ where: { escrowId: frozen.id, type: 'RELEASE' } }), 1);
  });

  await t.test('database failures roll back dispute creation and complete multi-leg resolution', async () => {
    const escrow = await funded();
    await db.$executeRawUnsafe(`
      CREATE FUNCTION fail_dispute_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_ARGV[0] = 'ANY' THEN RAISE EXCEPTION 'fixture failure'; END IF;
        IF NEW.type::text = TG_ARGV[0] THEN RAISE EXCEPTION 'fixture failure'; END IF;
        RETURN NEW;
      END; $$`);
    async function force(table, kind, action) {
      await db.$executeRawUnsafe(`CREATE TRIGGER fail_dispute_fixture BEFORE INSERT ON ${table}
        FOR EACH ROW EXECUTE FUNCTION fail_dispute_fixture('${kind}')`);
      try { verify(await action(), 500); }
      finally { await db.$executeRawUnsafe(`DROP TRIGGER fail_dispute_fixture ON ${table}`); }
    }
    await force('dispute_status_history', 'ANY', () => open(escrow));
    assert.equal(await db.dispute.count({ where: { escrowId: escrow.id } }), 0);
    assert.equal((await db.escrow.findUnique({ where: { id: escrow.id } })).status, 'FUNDED');
    const dispute = verify(await open(escrow), 201);
    const balances = await Promise.all([balance(client), balance(provider)]);
    const attempt = () => resolve(dispute.id, admin, 'SPLIT_FUNDS', { providerAmount: 4, clientAmount: 6 });
    for (const [table, kind] of [['dispute_resolution_allocation', 'REFUND'], ['ledger_entry', 'CREDIT'], ['dispute_status_history', 'ANY']]) {
      await force(table, kind, attempt);
      assert.equal(await db.transaction.count({ where: { escrowId: escrow.id } }), 1);
      assert.equal(await db.disputeResolution.count({ where: { disputeId: dispute.id } }), 0);
      assert.equal((await db.escrow.findUnique({ where: { id: escrow.id } })).status, 'DISPUTED');
      assert.equal((await db.dispute.findUnique({ where: { id: dispute.id } })).status, 'OPEN');
      assert.deepEqual(await Promise.all([balance(client), balance(provider)]), balances);
    }
    verify(await attempt(), 201);
    assert.ok(verify(await get(admin, '/api/transactions/validation/ledger'), 200).allBalanced);
  });

  await t.test('disputes, messages, evidence bytes and resolution history survive process restart', async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      const backend = await openBackend(fixture.url);
      try {
        const resumed = verify(await backend.api.post('/api/auth/login').send({ email: client.user.email, password }), 200);
        assert.equal(verify(await get(resumed, base(original.id), backend.api), 200).status, 'RESOLVED');
        assert.equal(verify(await get(resumed, base(original.id) + '/messages', backend.api), 200).length, 2);
        assert.equal(verify(await get(resumed, base(original.id) + '/resolutions', backend.api), 200).length, 2);
        const response = await get(resumed, evidence.downloadUrl, backend.api).buffer(true)
          .parse((incoming, done) => {
            const chunks = [];
            incoming.on('data', chunk => chunks.push(chunk));
            incoming.on('end', () => done(null, Buffer.concat(chunks)));
          });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, bytes);
        assert.ok(verify(await get(resumed, base(original.id) + '/history', backend.api), 200).some(row => row.eventType === 'RESOLUTION_EXECUTED'));
      } finally { await backend.stop(); }
    }
    assert.equal(Object.keys(require.cache).some(file => /[\\/]data[\\/]store\.js$/.test(file)), false);
  });
});
