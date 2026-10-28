// Server Entry Point for SecureEscrow
require('dotenv').config();
const app = require('./app');
const { getStore } = require('./data/store');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`SecureLance Server Started`);
  console.log(`Port: ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`=========================================`);

  // Log initial data state
  const store = getStore();
  console.log(`\nInitial Data:`);
  console.log(`- Users: ${store.users.length}`);
  console.log(`- Accounts: ${store.accounts.length}`);
  const clientAccount = store.getAccountByUserId('user-1');
  const freelancerAccount = store.getAccountByUserId('user-2');
  const escrowAccount = store.getEscrowAccount();
  console.log(`  - Client (user-1): ₹${clientAccount.balance}`);
  console.log(`  - Freelancer (user-2): ₹${freelancerAccount.balance}`);
  console.log(`  - Escrow: ₹${escrowAccount.balance}`);
  console.log(`\nServer ready to accept requests.`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
