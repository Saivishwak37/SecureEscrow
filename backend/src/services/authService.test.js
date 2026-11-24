const authService = require('./authService');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const userRepository = require('../repositories/userRepository');
const { getStore } = require('../data/store');

describe('credential-backed demo identities', () => {
  const originalSecret = process.env.JWT_SECRET;
  const password = 'testFixturePass123';

  beforeEach(() => {
    getStore().reset();
    process.env.JWT_SECRET = randomBytes(48).toString('base64');
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test.each([
    ['client1', 'CLIENT'],
    ['provider1', 'PROVIDER'],
    ['admin1', 'ADMIN'],
  ])('authenticates %s through email and bcrypt with its stored role', async (username, role) => {
    const seededUser = userRepository.findCredentialUserByUsername(username);
    getStore().update('users', seededUser.id, { passwordHash: await bcrypt.hash(password, 4) });

    const result = await authService.login({ email: seededUser.email, password });
    expect(result.user).toEqual({ id: seededUser.id, username, email: seededUser.email, role });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(() => authService.loginDemo(username, password)).toThrow('Invalid demo username or password');
  });

  test('rejects invalid credentials', () => {
    expect(() => authService.loginDemo('provider1', 'wrong-password')).toThrow('Invalid demo username or password');
  });

  test('does not expose demo credentials through the user list', () => {
    const users = userRepository.getAllUsers();
    expect(users).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'client1', role: 'CLIENT' })]));
    for (const user of users) {
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('passwordHash');
    }
  });
});
