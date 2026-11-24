const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function testDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must point to the local secureescrow_test database');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.pathname !== '/secureescrow_test'
      || [...url.searchParams].some(([key, val]) => key !== 'schema' || val !== 'public')
      || url.hash) {
    throw new Error('TEST_DATABASE_URL must point to the local secureescrow_test database');
  }
  return value;
}

module.exports = { testDatabaseUrl };
