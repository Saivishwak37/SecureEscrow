const userRepository = require('../repositories/userRepository');
const accountRepository = require('../repositories/accountRepository');
const { UnauthorizedError, ValidationError } = require('../utils/errors');
const createAuthService = require('./createAuthService');

function loginDemo(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new ValidationError('Username and password are required');
  }
  const user = userRepository.authenticate(username.trim(), password);
  if (!user) throw new UnauthorizedError('Invalid demo username or password');
  return user;
}

const auth = createAuthService(userRepository, credentials => {
  const user = userRepository.createCredentialUser(credentials);
  accountRepository.createAccount({ userId: user.id, balance: 0, currency: 'INR', type: 'PERSONAL' });
  return user;
});

module.exports = { ...auth, loginDemo };
