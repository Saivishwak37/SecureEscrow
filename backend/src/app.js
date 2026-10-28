// Express Application for SecureEscrow
const express = require('express');
const { getStore } = require('./data/store');
const { BaseError } = require('./utils/errors');

const app = express();

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, role, provider-id'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// --- Base Routes ---

// Health check and sanity endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'SecureEscrow-Backend'
  });
});

// API Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/accounts', require('./routes/accountRoutes'));
app.use('/api/escrows', require('./routes/escrowRoutes'));
app.use('/api/milestones', require('./routes/milestoneRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));

// 404 Handler - Catch unmatched routes
app.use((req, res, next) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.url} not found.`
  });
});

// --- Central Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.name}: ${err.message}`);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));

  // If the error is a known domain exception, use its status and structure
  if (err instanceof BaseError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // For unexpected errors, hide stack traces in production
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: isDev ? err.message : 'An unexpected server error occurred.',
    ...(isDev && err.stack ? { stack: err.stack } : {})
  });
});



module.exports = app;
