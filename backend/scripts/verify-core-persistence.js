const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('base64');
process.env.JWT_EXPIRES_IN = '15m';

const { getPrisma } = require('../src/data/prisma');
const createPostgresApp = require('../src/postgresApp');

function startServer() {
  const child = spawn(process.execPath, [require.resolve('../src/server')], {
    env: { ...process.env, POSTGRES_PORT: '0' }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('PostgreSQL server startup timed out')); }, 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); reject(new Error(`PostgreSQL server exited with code ${code}`)); });
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const ready = stdout.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (ready) {
        clearTimeout(timeout);
        resolve({ baseUrl: `http://127.0.0.1:${ready[1]}`, stop: async () => { child.kill(); await closed; } });
      }
    });
  });
}

test('PostgreSQL core application', async t => {
  const db = getPrisma();
  const prefix = `phase2-${randomBytes(5).toString('hex')}-`;
  const password = 'IntegrationTest123';
  const input = (suffix, role) => ({
    username: prefix + suffix, email: `${prefix}${suffix}@example.test`, password, role,
  });
  const [identity] = await db.$queryRaw`SELECT current_database() AS database, current_user AS role`;
  assert.deepEqual(identity, { database: 'secureescrow_test', role: 'secureescrow_test' });
  t.after(async () => {
    try {
      const users = { username: { startsWith: prefix } };
      const escrows = { client: users };
      await db.$transaction([
        db.escrowStatusHistory.deleteMany({ where: { escrow: escrows } }),
        db.escrowCondition.deleteMany({ where: { escrow: escrows } }),
        db.milestone.deleteMany({ where: { escrow: escrows } }),
        db.account.deleteMany({ where: { OR: [{ user: users }, { escrow: escrows }] } }),
        db.escrow.deleteMany({ where: escrows }),
        db.user.deleteMany({ where: users }),
      ]);
    } finally { await db.$disconnect(); }
  });

  const app = request(createPostgresApp(db));
  const register = (data, target = app) => target.post('/api/auth/register').send(data);
  const login = data => app.post('/api/auth/login').send({ email: data.email, password });
  const authorize = (req, token) => req.set('Authorization', `Bearer ${token}`);
  const verify = (response, status) => {
    assert.equal(response.status, status, response.body.error);
    return response.body.data;
  };
  const clientInput = input('client', 'CLIENT');
  const providerInput = input('provider', 'PROVIDER');
  let client, provider, outsider, clientToken, providerToken, outsiderToken, milestoneEscrow, conditionEscrow;

  await t.test('registers CLIENT and PROVIDER with zero-balance wallets and rejects ADMIN', async () => {
    client = verify(await register(clientInput), 201);
    provider = verify(await register(providerInput), 201);
    outsider = verify(await register(input('outsider', 'CLIENT')), 201);
    assert.equal(client.role, 'CLIENT');
    assert.equal(provider.role, 'PROVIDER');
    assert.equal(client.passwordHash, undefined);
    for (const user of [client, provider]) {
      const wallet = await db.account.findUnique({ where: { userId_currency: { userId: user.id, currency: 'INR' } } });
      assert.equal(wallet.type, 'PERSONAL');
      assert.equal(await db.ledgerEntry.count({ where: { accountId: wallet.id } }), 0);
    }
    verify(await register(input('admin', 'ADMIN')), 400);
  });

  await t.test('rejects normalized duplicates and a concurrent registration race', async () => {
    verify(await register({ ...clientInput, username: clientInput.username.toUpperCase(), email: input('new', 'CLIENT').email }), 409);
    verify(await register({ ...clientInput, username: input('new', 'CLIENT').username, email: clientInput.email.toUpperCase() }), 409);
    const same = input('race', 'CLIENT');
    const results = await Promise.all([register(same), register(same)]);
    assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
    assert.equal(await db.user.count({ where: { email: same.email } }), 1);
  });

  await t.test('rolls back registration when the nested wallet write violates a real constraint', async () => {
    const failing = db.$extends({
      query: { user: { create({ args, query }) {
        args.data.accountViaUser.create.type = 'EXTERNAL';
        return query(args);
      } } },
    });
    const user = input('rollback', 'CLIENT');
    verify(await register(user, request(createPostgresApp(failing))), 500);
    assert.equal(await db.user.count({ where: { email: user.email } }), 0);
  });

  await t.test('uses persisted credentials and rejects wrong passwords, invalid tokens, inactive users, and stale roles', async () => {
    clientToken = verify(await login(clientInput), 200).accessToken;
    providerToken = verify(await login(providerInput), 200).accessToken;
    outsiderToken = verify(await login(input('outsider', 'CLIENT')), 200).accessToken;
    verify(await app.post('/api/auth/login').send({ email: clientInput.email, password: 'wrong-password' }), 401);
    const me = token => authorize(app.get('/api/auth/me'), token);
    assert.deepEqual(verify(await me(clientToken), 200), {
      id: client.id, role: 'CLIENT', username: client.username, email: client.email,
    });
    verify(await me('invalid'), 401);
    const expired = jwt.sign({ role: 'CLIENT' }, process.env.JWT_SECRET, { subject: client.id, expiresIn: -1, algorithm: 'HS256' });
    verify(await me(expired), 401);
    try {
      await db.user.update({ where: { id: client.id }, data: { isActive: false } });
      verify(await me(clientToken), 401);
      verify(await login(clientInput), 401);
      await db.user.update({ where: { id: client.id }, data: { isActive: true, role: 'PROVIDER' } });
      verify(await me(clientToken), 401);
    } finally {
      await db.user.update({ where: { id: client.id }, data: { isActive: true, role: 'CLIENT' } });
    }
  });

  await t.test('isolates wallets and rejects an unkeyed deposit', async () => {
    const wallet = verify(await authorize(app.get(`/api/accounts/user/${client.id}`), clientToken), 200);
    assert.equal(wallet.balance, 0);
    verify(await authorize(app.get(`/api/accounts/${wallet.id}`), providerToken), 403);
    verify(await authorize(app.get(`/api/accounts/user/${client.id}`), providerToken), 403);
    verify(await authorize(app.post('/api/accounts'), clientToken).send({}), 409);
    verify(await authorize(app.post(`/api/accounts/${wallet.id}/deposit`), clientToken).send({ amount: 10 }), 400);
    assert.equal(await db.ledgerEntry.count({ where: { accountId: wallet.id } }), 0);
  });

  await t.test('validates participants, isolates escrows, and persists exact ordered milestones', async () => {
    const create = (data, token = clientToken, target = app) => authorize(target.post('/api/escrows'), token).send(data);
    const draft = { title: 'Test milestone agreement', providerId: provider.id, totalAmount: 0.3 };
    verify(await create({ ...draft, clientId: outsider.id }), 403);
    verify(await create({ ...draft, providerId: outsider.id }), 400);
    verify(await create(draft, providerToken), 403);
    await db.user.update({ where: { id: provider.id }, data: { isActive: false } });
    try { verify(await create(draft), 400); }
    finally { await db.user.update({ where: { id: provider.id }, data: { isActive: true } }); }
    const milestones = [
      { title: 'One', description: 'First milestone', amount: 0.1 },
      { title: 'Two', description: 'Second milestone', amount: 0.2 },
    ];
    verify(await create({ ...draft, totalAmount: 0.300000001, milestones }), 400);
    milestoneEscrow = verify(await create({ ...draft, milestones }), 201);
    assert.equal(milestoneEscrow.totalAmount, 0.3);
    assert.equal(milestoneEscrow.payerId, client.id);
    assert.equal(milestoneEscrow.payeeId, provider.id);
    const id = milestoneEscrow.id;
    const rows = verify(await authorize(app.get(`/api/escrows/${id}/milestones`), providerToken), 200);
    assert.deepEqual(rows.map(({ amount, order }) => [amount, order]), [[0.1, 1], [0.2, 2]]);
    assert.equal((await db.escrow.findUnique({ where: { id } })).totalAmount.toString(), '0.3');
    assert.equal(await db.account.count({ where: { escrowId: id, type: 'ESCROW' } }), 1);
    assert.equal(await db.escrowStatusHistory.count({ where: { escrowId: id, toStatus: 'CREATED' } }), 1);
    verify(await authorize(app.get(`/api/escrows/${id}`), outsiderToken), 403);
    verify(await authorize(app.get(`/api/milestones/${rows[0].id}`), outsiderToken), 403);
    verify(await authorize(app.post(`/api/escrows/${id}/fund`), clientToken).send({ milestoneId: rows[0].id }), 400);
    verify(await authorize(app.post(`/api/escrows/${id}/milestones`), clientToken).send(milestones[0]), 400);
    const empty = verify(await create(draft), 201);
    const add = data => authorize(app.post(`/api/escrows/${empty.id}/milestones`), clientToken).send(data);
    const results = await Promise.all(milestones.map(add));
    assert.deepEqual(results.map(response => response.status), [201, 201]);
    assert.deepEqual(results.map(response => response.body.data.order).sort(), [1, 2]);
  });

  await t.test('persists condition definitions and rolls back failed coordinated escrow creation', async () => {
    const draft = {
      title: 'Test condition agreement', providerId: provider.id, totalAmount: 1.12345678,
      releaseModel: 'CONDITION_BASED', conditions: [{ type: 'CLIENT_APPROVAL' }],
    };
    conditionEscrow = verify(await authorize(app.post('/api/escrows'), clientToken).send(draft), 201);
    const [condition] = conditionEscrow.conditions;
    assert.equal(condition.status, 'PENDING');
    verify(await authorize(app.patch(`/api/conditions/${condition.id}`), outsiderToken).send({ title: 'Spoof' }), 403);
    const updated = verify(await authorize(app.patch(`/api/conditions/${condition.id}`), clientToken).send({ title: 'Approved terms' }), 200);
    assert.equal(updated.title, 'Approved terms');
    verify(await authorize(app.delete(`/api/conditions/${condition.id}`), clientToken), 400);
    verify(await authorize(app.post(`/api/conditions/${condition.id}/satisfy`), clientToken).send({}), 400);
    assert.equal((await db.escrowCondition.findUnique({ where: { id: condition.id } })).status, 'PENDING');

    const failing = db.$extends({
      query: { escrow: { create({ args, query }) {
        args.data.accountViaEscrow.create.type = 'PERSONAL';
        return query(args);
      } } },
    });
    const title = prefix + 'failed-escrow';
    const failingApp = request(createPostgresApp(failing));
    verify(await authorize(failingApp.post('/api/escrows'), clientToken).send({ ...draft, title }), 500);
    assert.equal(await db.escrow.count({ where: { clientId: client.id, title } }), 0);
  });

  await t.test('generates an editable draft without writes and accepts it through normal escrow creation', async () => {
    const generation = request(createPostgresApp(db, { milestoneProvider: async () => JSON.stringify({
      title: 'Warehouse shelving', description: 'Supply and install the approved shelving.',
      milestones: [1, 2, 3].map((weight, index) => ({
        title: `Stage ${index + 1}`, description: 'Inspect the completed work.',
        allocationWeight: weight, deliverables: ['Inspection record'], acceptanceCriteria: ['Approved dimensions match'],
      })),
    }) }));
    const scope = { clientId: client.id };
    const counts = () => Promise.all([
      db.escrow.count({ where: scope }), db.milestone.count({ where: { escrow: scope } }),
      db.account.count({ where: { OR: [{ userId: client.id }, { escrow: scope }] } }),
      db.transaction.count({ where: { OR: [{ escrow: scope }, { source: { userId: client.id } }, { destination: { userId: client.id } }] } }),
      db.ledgerEntry.count({ where: { account: { OR: [{ userId: client.id }, { escrow: scope }] } } }),
      db.escrowStatusHistory.count({ where: { escrow: scope } }),
    ]);
    const before = await counts();
    const draft = verify(await authorize(generation.post('/api/ai/generate-milestones'), clientToken).send({
      description: 'Supply and install shelving in three stages', totalAmount: '0.10',
    }), 200);
    assert.deepEqual(draft.milestones.map(item => item.amount), [0.02, 0.03, 0.05]);
    assert.deepEqual(await counts(), before);
    const saved = verify(await authorize(app.post('/api/escrows'), clientToken).send({ ...draft, providerId: provider.id }), 201);
    const milestones = await db.milestone.findMany({ where: { escrowId: saved.id }, orderBy: { order: 'asc' } });
    assert.deepEqual(milestones.map(item => item.amount.toString()), ['0.02', '0.03', '0.05']);
    assert.ok(milestones[0].description.includes('Acceptance criteria\n- Approved dimensions match'));
  });

  await t.test('reads user, escrow, milestone and condition records after a real backend restart', async () => {
    const first = await startServer();
    const restartInput = input('restart', 'CLIENT');
    let restartUser;
    try {
      const response = await fetch(first.baseUrl + '/api/auth/me', { headers: { Authorization: `Bearer ${clientToken}` } });
      assert.equal(response.status, 200);
      const registration = await fetch(first.baseUrl + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(restartInput),
      });
      assert.equal(registration.status, 201);
      restartUser = (await registration.json()).data;
    } finally { await first.stop(); }
    const restarted = await startServer();
    try {
      const newLogin = await fetch(restarted.baseUrl + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: restartInput.email, password }),
      });
      assert.equal(newLogin.status, 200);
      assert.equal((await newLogin.json()).data.user.id, restartUser.id);
      const response = await fetch(restarted.baseUrl + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: client.email, password }),
      });
      assert.equal(response.status, 200);
      const session = (await response.json()).data;
      assert.equal(session.user.id, client.id);
      const get = async path => {
        const result = await fetch(restarted.baseUrl + path, { headers: { Authorization: `Bearer ${session.accessToken}` } });
        assert.equal(result.status, 200);
        return (await result.json()).data;
      };
      assert.equal((await get(`/api/escrows/${milestoneEscrow.id}`)).totalAmount, 0.3);
      assert.equal((await get(`/api/escrows/${milestoneEscrow.id}/milestones`)).length, 2);
      assert.equal((await get(`/api/escrows/${conditionEscrow.id}/conditions`))[0].title, 'Approved terms');
    } finally { await restarted.stop(); }
  });
});
