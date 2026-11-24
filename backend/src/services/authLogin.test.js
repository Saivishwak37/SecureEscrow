const crypto = require('crypto');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../app');
const userRepository = require('../repositories/userRepository');
const { getStore } = require('../data/store');

async function createCredentialUser({ role = 'CLIENT', username = role.toLowerCase(), email, password = 'goodPass123', isActive = true }) {
  const passwordHash = await bcrypt.hash(password, 4);
  return userRepository.createCredentialUser({
    username, email, passwordHash, role, isActive
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    getStore().reset();
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    delete process.env.JWT_EXPIRES_IN;
  });

  test.each(['CLIENT', 'PROVIDER'])('logs in a %s and returns a signed access token', async role => {
    const email = `${role.toLowerCase()}@example.com`;
    const user = await createCredentialUser({ role, email });
    const response = await request(app).post('/api/auth/login').send({
      email: `  ${email.toUpperCase()}  `,
      password: 'goodPass123'
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: { id: user.id, username: user.username, email, role }
      }
    });
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(jwt.verify(response.body.data.accessToken, process.env.JWT_SECRET, { algorithms: ['HS256'] })).toMatchObject({
      sub: user.id, role
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('goodPass123');
  });

  test('uses the same generic response for an unknown email and an incorrect password', async () => {
    await createCredentialUser({ email: 'known@example.com' });
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'known@example.com', password: 'wrongPass123' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'unknown@example.com', password: 'wrongPass123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.message).toBe('Invalid email or password');
    expect(wrongPassword.body).not.toHaveProperty('data');
  });

  test.each([
    [{ password: 'goodPass123' }, 'A valid email address is required'],
    [{ email: 'user@example.com' }, 'Password is required'],
    [{ email: 'bad-email', password: 'goodPass123' }, 'A valid email address is required'],
    [{ email: 'user@example.com', password: 'goodPass123', role: 'ADMIN' }, 'Only email and password are accepted'],
    [{ email: 'user@example.com', password: 'goodPass123', actorId: 'user-admin' }, 'Only email and password are accepted']
  ])('rejects malformed login input without issuing a token', async (body, message) => {
    const response = await request(app).post('/api/auth/login').send(body);
    expect(response.status).toBe(400);
    expect(response.body.message).toContain(message);
    expect(response.body).not.toHaveProperty('data.accessToken');
  });

  test('rejects inactive users with the same generic credential error', async () => {
    await createCredentialUser({ email: 'inactive@example.com', isActive: false });
    const response = await request(app).post('/api/auth/login').send({ email: 'inactive@example.com', password: 'goodPass123' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password');
    expect(response.body).not.toHaveProperty('data');
  });
});
