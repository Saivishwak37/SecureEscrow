const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const authenticate = require('./authenticate');
const jwtService = require('../services/jwtService');
const userRepository = require('../repositories/userRepository');
const { getStore } = require('../data/store');
const { BaseError } = require('../utils/errors');

function makeTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/identity', authenticate, (req, res) => res.json(req.auth));
  app.use((error, req, res, next) => {
    if (error instanceof BaseError) return res.status(error.statusCode).json(error.toJSON());
    return res.status(500).json({ message: 'Internal error' });
  });
  return app;
}

function bearer(token) {
  return `Bearer ${token}`;
}

describe('authentication middleware', () => {
  let app;

  beforeEach(() => {
    getStore().reset();
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    delete process.env.JWT_EXPIRES_IN;
    app = makeTestApp();
  });

  test.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer token extra'])('rejects a missing or malformed Authorization header', async authorization => {
    const req = request(app).get('/identity');
    if (authorization !== undefined) req.set('Authorization', authorization);
    const response = await req;
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or missing authentication credentials');
  });

  test('rejects invalid, malformed, tampered, expired and unsupported-algorithm tokens', async () => {
    const secret = process.env.JWT_SECRET;
    const valid = jwtService.signAccessToken({ id: 'user-1', role: 'CLIENT' });
    const parts = valid.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
    const expired = jwt.sign({ role: 'CLIENT' }, secret, { algorithm: 'HS256', subject: 'user-1', expiresIn: -1 });
    const unsupported = jwt.sign({ role: 'CLIENT' }, secret, { algorithm: 'HS384', subject: 'user-1', expiresIn: '1m' });

    for (const token of ['not-a-token', tampered, expired, unsupported]) {
      const response = await request(app).get('/identity').set('Authorization', bearer(token));
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid or missing authentication credentials');
    }
  });

  test('rejects a token signed with a different secret', async () => {
    const token = jwtService.signAccessToken({ id: 'user-1', role: 'CLIENT' });
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    const response = await request(app).get('/identity').set('Authorization', bearer(token));
    expect(response.status).toBe(401);
  });

  test('rejects nonexistent users, inactive users, and stale role claims', async () => {
    const inactive = userRepository.createCredentialUser({
      username: 'inactive-user', email: 'inactive@example.com', passwordHash: 'hash', role: 'CLIENT', isActive: false
    });
    const client = userRepository.createCredentialUser({
      username: 'client-user', email: 'client@example.com', passwordHash: 'hash', role: 'CLIENT'
    });
    const tokens = [
      jwtService.signAccessToken({ id: 'missing-user', role: 'CLIENT' }),
      jwtService.signAccessToken({ id: inactive.id, role: 'CLIENT' }),
      jwtService.signAccessToken({ id: client.id, role: 'PROVIDER' })
    ];

    for (const token of tokens) {
      const response = await request(app).get('/identity').set('Authorization', bearer(token));
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid or missing authentication credentials');
    }
  });

  test.each(['CLIENT', 'PROVIDER', 'ADMIN'])('attaches the current %s identity to req.auth', async role => {
    const user = userRepository.createCredentialUser({
      username: `${role.toLowerCase()}-user`,
      email: `${role.toLowerCase()}@example.com`,
      passwordHash: 'hash',
      role
    });
    const token = jwtService.signAccessToken({ id: user.id, role });
    const response = await request(app).get('/identity').set('Authorization', bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: user.id,
      role,
      user: { id: user.id, username: user.username, email: user.email, role }
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });
});
