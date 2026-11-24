const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../app');
const { getStore } = require('../data/store');
const authService = require('./authService');

describe('POST /api/auth/register', () => {
  beforeEach(() => getStore().reset());

  test.each(['CLIENT', 'PROVIDER'])('registers a %s and returns no password hash', async role => {
    const response = await request(app).post('/api/auth/register').send({
      username: `new-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.com`,
      password: 'goodPass123',
      role
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { role, isActive: true }
    });
    expect(response.body.data.passwordHash).toBeUndefined();

    const stored = getStore().users.find(user => user.email === `${role.toLowerCase()}@example.com`);
    expect(stored.passwordHash).not.toBe('goodPass123');
    expect(await bcrypt.compare('goodPass123', stored.passwordHash)).toBe(true);
    expect(stored).not.toHaveProperty('password');
    expect(getStore().getAccountByUserId(stored.id)).toMatchObject({ userId: stored.id, balance: 0, type: 'PERSONAL' });
  });

  test.each([
    [{ email: 'user@example.com', password: 'goodPass123', role: 'CLIENT' }, 'Username is required'],
    [{ username: 'new-user', password: 'goodPass123', role: 'CLIENT' }, 'A valid email address is required'],
    [{ username: 'new-user', email: 'user@example.com', role: 'CLIENT' }, 'Password must be'],
    [{ username: 'new-user', email: 'bad-email', password: 'goodPass123', role: 'CLIENT' }, 'A valid email address is required'],
    [{ username: 'x', email: 'user@example.com', password: 'goodPass123', role: 'CLIENT' }, 'Username must be'],
    [{ username: 'new-user', email: 'user@example.com', password: 'weak', role: 'CLIENT' }, 'Password must be'],
    [{ username: 'new-user', email: 'user@example.com', password: 'goodPass123', role: 'OTHER' }, 'Role must be CLIENT or PROVIDER'],
    [{ username: 'new-user', email: 'user@example.com', password: 'goodPass123', role: 'ADMIN' }, 'Role must be CLIENT or PROVIDER']
  ])('rejects invalid input without creating a user', async (body, message) => {
    const usersBefore = getStore().users.length;
    const response = await request(app).post('/api/auth/register').send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain(message);
    expect(getStore().users).toHaveLength(usersBefore);
  });

  test('rejects duplicate usernames and email addresses case-insensitively', async () => {
    const body = { username: 'CaseUser', email: 'Case@example.com', password: 'goodPass123', role: 'CLIENT' };
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(201);

    const duplicateUsername = await request(app).post('/api/auth/register').send({ ...body, username: 'caseuser', email: 'another@example.com' });
    expect(duplicateUsername.status).toBe(409);
    const duplicateEmail = await request(app).post('/api/auth/register').send({ ...body, username: 'another-user', email: 'CASE@EXAMPLE.COM' });
    expect(duplicateEmail.status).toBe(409);
    expect(getStore().users.filter(user => typeof user.email === 'string' && user.email.toLowerCase() === 'case@example.com')).toHaveLength(1);
  });

  test('ignores client attempts to override protected user properties', async () => {
    const response = await request(app).post('/api/auth/register').send({
      id: 'attacker-chosen-id',
      username: 'protected-check',
      email: 'protected@example.com',
      password: 'goodPass123',
      passwordHash: 'attacker-chosen-hash',
      role: 'CLIENT',
      isActive: false,
      createdAt: 0,
      updatedAt: 0,
      type: 'ADMIN'
    });

    expect(response.status).toBe(201);
    expect(response.body.data.id).not.toBe('attacker-chosen-id');
    expect(response.body.data.role).toBe('CLIENT');
    expect(response.body.data.isActive).toBe(true);
    expect(response.body.data.passwordHash).toBeUndefined();
    const stored = getStore().users.find(user => user.email === 'protected@example.com');
    expect(stored.passwordHash).not.toBe('attacker-chosen-hash');
    expect(stored.createdAt).not.toBe(0);
    expect(stored.updatedAt).not.toBe(0);
  });

  test('does not return unexpected internal errors to the caller', async () => {
    const register = jest.spyOn(authService, 'register').mockRejectedValue(new Error('internal-secret-detail'));
    try {
      const response = await request(app).post('/api/auth/register').send({
        username: 'safe-error', email: 'safe-error@example.com', password: 'goodPass123', role: 'CLIENT'
      });

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Registration failed');
      expect(JSON.stringify(response.body)).not.toContain('internal-secret-detail');
    } finally {
      register.mockRestore();
    }
  });
});
