const crypto = require('crypto');
const request = require('supertest');
const app = require('../app');
const userRepository = require('../repositories/userRepository');
const jwtService = require('../services/jwtService');
const { getStore } = require('../data/store');

describe('GET /api/accounts/user/:userId', () => {
  beforeEach(() => {
    getStore().reset();
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    delete process.env.JWT_EXPIRES_IN;
  });

  test('repairs a missing personal account for the authenticated user', async () => {
    const user = userRepository.createCredentialUser({
      username: 'wallet-user',
      email: 'wallet@example.com',
      passwordHash: 'test-hash',
      role: 'CLIENT'
    });
    const token = jwtService.signAccessToken({ id: user.id, role: user.role });

    const response = await request(app)
      .get(`/api/accounts/user/${user.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      userId: user.id,
      balance: 0,
      currency: 'INR',
      type: 'PERSONAL'
    });
    expect(getStore().accounts.filter(account => account.userId === user.id)).toHaveLength(1);
  });

  test('does not let a user provision an account for another user', async () => {
    const owner = userRepository.createCredentialUser({
      username: 'owner-user', email: 'owner@example.com', passwordHash: 'hash', role: 'CLIENT'
    });
    const other = userRepository.createCredentialUser({
      username: 'other-user', email: 'other@example.com', passwordHash: 'hash', role: 'PROVIDER'
    });
    const token = jwtService.signAccessToken({ id: owner.id, role: owner.role });

    const response = await request(app)
      .get(`/api/accounts/user/${other.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(getStore().accounts.some(account => account.userId === other.id)).toBe(false);
  });
});
