const userRepository = require('../repositories/userRepository');
const { AuthenticationError, UnauthorizedError, ValidationError, ConflictError } = require('../utils/errors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwtService = require('./jwtService');
const accountRepository = require('../repositories/accountRepository');

const PASSWORD_HASH_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), PASSWORD_HASH_ROUNDS);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistration({ username, email, password, role }) {
  if (typeof username !== 'string' || !username.trim()) {
    throw new ValidationError('Username is required');
  }
  const normalizedUsername = username.trim();
  if (normalizedUsername.length < 3 || normalizedUsername.length > 30 || !/^[a-zA-Z0-9._-]+$/.test(normalizedUsername)) {
    throw new ValidationError('Username must be 3–30 characters and use only letters, numbers, dots, underscores, or hyphens');
  }
  if (typeof email !== 'string' || !email.trim() || email.trim().length > 254 || !EMAIL_PATTERN.test(email.trim())) {
    throw new ValidationError('A valid email address is required');
  }
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ValidationError('Password must be 8–72 characters and include at least one letter and one number');
  }
  if (role !== 'CLIENT' && role !== 'PROVIDER') {
    throw new ValidationError('Role must be CLIENT or PROVIDER');
  }
  return { username: normalizedUsername, email: email.trim().toLowerCase(), password, role };
}

function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Email and password are required');
  }
  const unexpectedFields = Object.keys(input).filter(key => !['email', 'password'].includes(key));
  if (unexpectedFields.length) {
    throw new ValidationError('Only email and password are accepted');
  }
  const { email, password } = input;
  if (typeof email !== 'string' || !email.trim() || email.trim().length > 254 || !EMAIL_PATTERN.test(email.trim())) {
    throw new ValidationError('A valid email address is required');
  }
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    throw new ValidationError('Password is required and must be at most 72 bytes');
  }
  return { email: email.trim().toLowerCase(), password };
}

async function register(input) {
  const { username, email, password, role } = validateRegistration(input || {});
  if (userRepository.findCredentialUserByUsername(username)) {
    throw new ConflictError('Username is already in use');
  }
  if (userRepository.findCredentialUserByEmail(email)) {
    throw new ConflictError('Email is already in use');
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
  const user = userRepository.createCredentialUser({ username, email, passwordHash, role });
  // Every public user needs a wallet before entering the authenticated UI.
  // The account is server-created and is never accepted from registration input.
  accountRepository.createAccount({ userId: user.id, balance: 0, currency: 'INR', type: 'PERSONAL' });
  return user;
}

async function login(input) {
  const { email, password } = validateLogin(input);
  const foundUser = userRepository.findCredentialUserByEmail(email);
  const hasCredentialHash = foundUser && typeof foundUser.passwordHash === 'string';
  const validPassword = await bcrypt.compare(password, hasCredentialHash ? foundUser.passwordHash : DUMMY_PASSWORD_HASH);
  if (!hasCredentialHash || !foundUser.isActive || !validPassword) {
    throw new AuthenticationError('Invalid email or password');
  }

  const user = {
    id: foundUser.id,
    username: foundUser.username,
    email: foundUser.email,
    role: foundUser.role
  };
  const accessToken = jwtService.signAccessToken({ id: user.id, role: user.role });
  return { accessToken, user };
}

function loginDemo(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new ValidationError('Username and password are required');
  }
  const user = userRepository.authenticate(username.trim(), password);
  if (!user) throw new UnauthorizedError('Invalid demo username or password');
  return user;
}

module.exports = { register, login, loginDemo };
