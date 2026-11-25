const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const { testDatabaseUrl } = require('../src/config/database');

async function sandbox(t) {
  const url = new URL(testDatabaseUrl());
  const admin = new PrismaClient({ datasourceUrl: url.href });
  t.after(() => admin.$disconnect());
  assert.deepEqual(await admin.$queryRaw`SELECT current_database() AS db, current_user AS role`,
    [{ db: 'secureescrow_test', role: 'secureescrow_test' }]);
  const schema = 'finance_' + randomBytes(8).toString('hex');
  url.searchParams.set('schema', schema);
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(db => db.$disconnect()));
    // Only the generated per-run schema is removed. Public financial data is untouched.
    const cleanup = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
    try { await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await cleanup.$disconnect(); }
  });
  const cli = require('node:path').resolve(require.resolve('prisma/package.json'), '..', require('prisma/package.json').bin.prisma);
  const deployed = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.href }, encoding: 'utf8',
  });
  assert.equal(deployed.status, 0, 'Disposable test schema migration failed');
  const connect = () => {
    const db = new PrismaClient({ datasourceUrl: url.href });
    clients.push(db);
    return db;
  };
  return { connect, url: url.href, schema };
}

function openBackend(url) {
  const child = spawn(process.execPath, ['-e', `
    const { PrismaClient } = require('@prisma/client');
    const app = require('./src/postgresApp')(new PrismaClient({ datasourceUrl: process.env.TEST_PROCESS_URL }));
    const server = app.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
  `], { env: { ...process.env, TEST_PROCESS_URL: url }, stdio: ['ignore', 'pipe', 'ignore'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Backend did not start')); }, 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', () => { clearTimeout(timeout); reject(new Error('Backend exited')); });
    child.stdout.once('data', data => {
      clearTimeout(timeout);
      resolve({ api: request(`http://127.0.0.1:${String(data).trim()}`), stop: async () => { child.kill(); await closed; } });
    });
  });
}

async function overlap(db, lock, requests) {
  let ready, open;
  const acquired = new Promise(resolve => { ready = resolve; });
  const unlock = new Promise(resolve => { open = resolve; });
  const blocker = db.$transaction(async tx => { await lock(tx); ready(); await unlock; }, { timeout: 12000 });
  await Promise.race([acquired, blocker]);
  const pending = Promise.all(requests.map(run => run()));
  let waiting = 0;
  try {
    for (let attempt = 0; attempt < 80 && waiting < 2; attempt++) {
      const [row] = await db.$queryRaw`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND usename = current_user AND wait_event_type = 'Lock'
      `;
      waiting = row.waiting;
      if (waiting < 2) await sleep(25);
    }
  } finally { open(); await blocker; }
  const results = await pending;
  assert.ok(waiting >= 2, 'Expected two overlapping lock waiters');
  return results;
}

function verify(response, status) {
  assert.equal(response.status, status, response.body.message);
  return response.body.data;
}

module.exports = { sandbox, openBackend, overlap, verify };
