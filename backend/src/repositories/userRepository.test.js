const userRepository = require('./userRepository');
const { getStore } = require('../data/store');

describe('credential-backed user repository', () => {
  beforeEach(() => getStore().reset());

  test('stores a credential user with normalized email and safe public fields', () => {
    const user = userRepository.createCredentialUser({
      username: 'new-client',
      email: 'New.Client@Example.com',
      passwordHash: '$2b$test-hash',
      role: 'CLIENT'
    });

    expect(user).toMatchObject({
      username: 'new-client',
      email: 'new.client@example.com',
      role: 'CLIENT',
      isActive: true
    });
    expect(user.id).toEqual(expect.any(String));
    expect(user.createdAt).toEqual(expect.any(Number));
    expect(user.updatedAt).toEqual(expect.any(Number));
    expect(user).not.toHaveProperty('passwordHash');
    expect(userRepository.getCredentialUserById(user.id)).not.toHaveProperty('passwordHash');
    expect(userRepository.findCredentialUserByEmail('NEW.CLIENT@example.com').passwordHash).toBe('$2b$test-hash');
  });

  test('rejects duplicate usernames and emails without regard to case', () => {
    const user = {
      username: 'unique-user',
      email: 'unique@example.com',
      passwordHash: '$2b$test-hash',
      role: 'PROVIDER'
    };
    userRepository.createCredentialUser(user);

    expect(() => userRepository.createCredentialUser({ ...user, email: 'other@example.com' })).toThrow('Username is already in use');
    expect(() => userRepository.createCredentialUser({ ...user, username: 'other-user', email: 'UNIQUE@example.com' })).toThrow('Email is already in use');
  });

  test('requires a hash and a supported role', () => {
    expect(() => userRepository.createCredentialUser({ username: 'x', email: 'x@example.com', role: 'CLIENT' })).toThrow('A password hash is required');
    expect(() => userRepository.createCredentialUser({ username: 'x', email: 'x@example.com', passwordHash: 'hash', role: 'buyer' })).toThrow('Role must be one of');
  });
});
