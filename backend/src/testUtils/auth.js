const crypto = require('crypto');
const { getStore } = require('../data/store');
const jwtService = require('../services/jwtService');

function authAs(request, userId, requestedRole) {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
  }
  let user = getStore().findById('users', userId);
  if (!user) {
    user = { id: userId, name: userId, type: requestedRole || 'PROVIDER', createdAt: Date.now() };
    getStore().users.push(user);
  }
  const role = requestedRole || user.role || user.type;
  user.role = role;
  user.isActive = true;
  user.passwordHash = user.passwordHash || 'test-only-password-hash';
  const token = jwtService.signAccessToken({ id: userId, role });
  return request.set('Authorization', `Bearer ${token}`);
}

module.exports = { authAs };
