const authService = require('./authService');
const userRepository = require('../repositories/userRepository');
const { getStore } = require('../data/store');

describe('demo login', () => {
  beforeEach(() => getStore().reset());

  test.each([
    ['client1', 'client123', 'CLIENT'],
    ['provider1', 'provider123', 'PROVIDER'],
    ['admin1', 'admin123', 'ADMIN'],
  ])('authenticates %s with its demo role', (username, password, type) => {
    expect(authService.loginDemo(username, password)).toMatchObject({ type });
  });

  test('rejects invalid credentials', () => {
    expect(() => authService.loginDemo('provider1', 'wrong-password')).toThrow('Invalid demo username or password');
  });

  test('does not expose demo credentials through the user list', () => {
    expect(userRepository.getAllUsers().every(user => !('password' in user) && !('username' in user))).toBe(true);
  });
});
