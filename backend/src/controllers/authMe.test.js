const crypto = require('crypto');
const request = require('supertest');
const app = require('../app');
const userRepository = require('../repositories/userRepository');
const jwtService = require('../services/jwtService');
const { getStore } = require('../data/store');

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    getStore().reset();
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    delete process.env.JWT_EXPIRES_IN;
  });

  test('returns the current safe user and ignores request-supplied identities', async () => {
    const user = userRepository.createCredentialUser({
      username: 'current-user', email: 'current@example.com', passwordHash: 'hash', role: 'CLIENT'
    });
    const other = userRepository.createCredentialUser({
      username: 'other-user', email: 'other@example.com', passwordHash: 'hash', role: 'PROVIDER'
    });
    const token = jwtService.signAccessToken({ id: user.id, role: user.role });
    const response = await request(app).get('/api/auth/me')
      .query({ actorId: other.id, userId: other.id, role: other.role })
      .set('Authorization', `Bearer ${token}`)
      .send({ actorId: other.id, userId: other.id, role: other.role });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('hash');
  });

  test('rejects requests without a valid token', async () => {
    const missing = await request(app).get('/api/auth/me');
    expect(missing.status).toBe(401);

    const invalid = await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid-token');
    expect(invalid.status).toBe(401);
  });
});
