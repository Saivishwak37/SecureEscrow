const { getPrisma } = require('./data/prisma');
const createPostgresApp = require('./postgresApp');
const { getJwtConfig } = require('./services/jwtService');

async function start() {
  getJwtConfig();
  const db = getPrisma();
  await db.$connect();
  const port = Number(process.env.POSTGRES_PORT ?? process.env.PORT ?? 3000);
  const server = createPostgresApp(db).listen(port, '127.0.0.1', () => {
    console.log(`SecureEscrow PostgreSQL listening on 127.0.0.1:${server.address().port}`);
  });
  server.on('error', async error => {
    console.error('PostgreSQL listener failed:', error.code || error.name);
    await db.$disconnect();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => db.$disconnect()));
  }
}

start().catch(error => {
  console.error('PostgreSQL startup failed:', error.errorCode || error.code || error.name);
  process.exitCode = 1;
});
