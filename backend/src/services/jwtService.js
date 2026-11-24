const jwt = require('jsonwebtoken');
require('../config/environment');
const { USER_ROLES } = require('../models/user');
const { AuthenticationError } = require('../utils/errors');

const DEFAULT_EXPIRES_IN = '15m';
const MAX_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 || /^(.)\1{31,}$/.test(secret) || /^(your|change[-_ ]?me|secret|password|development)/i.test(secret)) {
    throw new Error('JWT_SECRET must contain at least 32 bytes of strong random material');
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
  const match = typeof expiresIn === 'string' && expiresIn.match(/^([1-9]\d*)(s|m|h|d)$/);
  if (!match) {
    throw new Error('JWT_EXPIRES_IN must be a positive duration such as 15m, 1h, or 1d');
  }
  const value = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  const durationSeconds = value * unitSeconds;
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error('JWT_EXPIRES_IN must not exceed 30 days');
  }

  return { secret, expiresIn };
}

function signAccessToken({ id, role }) {
  if (typeof id !== 'string' || !id || !USER_ROLES.includes(role)) {
    throw new Error('Cannot issue an access token for an invalid identity');
  }
  const { secret, expiresIn } = getJwtConfig();
  return jwt.sign({ role }, secret, {
    algorithm: 'HS256',
    subject: id,
    expiresIn
  });
}

function verifyAccessToken(token) {
  const { secret } = getJwtConfig();
  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (_error) {
    throw new AuthenticationError();
  }

  if (
    !claims || typeof claims !== 'object' ||
    typeof claims.sub !== 'string' || !claims.sub ||
    !USER_ROLES.includes(claims.role) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp)
  ) {
    throw new AuthenticationError();
  }

  return { sub: claims.sub, role: claims.role, iat: claims.iat, exp: claims.exp };
}

module.exports = { DEFAULT_EXPIRES_IN, getJwtConfig, signAccessToken, verifyAccessToken };
