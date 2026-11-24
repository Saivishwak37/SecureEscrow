const { PrismaClient } = require('@prisma/client');
const { testDatabaseUrl } = require('../config/database');

let client;

function getPrisma() {
  if (!client) {
    const url = process.env.NODE_ENV === 'test' ? testDatabaseUrl() : process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required to use Prisma');
    client = new PrismaClient({ datasourceUrl: url });
  }
  return client;
}

module.exports = { getPrisma };
