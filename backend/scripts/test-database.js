const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { testDatabaseUrl } = require('../src/config/database');

try {
  const action = process.argv[2];
  if (!['deploy', 'status'].includes(action)) throw new Error('Expected deploy or status');
  const url = testDatabaseUrl();
  const manifestPath = require.resolve('prisma/package.json');
  const cliPath = path.resolve(path.dirname(manifestPath), require(manifestPath).bin.prisma);
  const result = spawnSync(process.execPath, [cliPath, 'migrate', action], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
