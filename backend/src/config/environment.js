// Environment Configuration
require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

function getEnv(key, defaultValue) {
  return process.env[key] || defaultValue;
}

module.exports = { config, getEnv };
