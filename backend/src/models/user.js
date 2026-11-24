const { ValidationError } = require('../utils/errors');

const USER_ROLES = Object.freeze(['CLIENT', 'PROVIDER', 'ADMIN']);

/** Build and validate the persisted credential-backed User entity. */
function createUserRecord({ id, username, email, passwordHash, role, createdAt, updatedAt, isActive = true }) {
  if (typeof username !== 'string' || !username.trim()) {
    throw new ValidationError('Username is required');
  }
  if (typeof email !== 'string' || !email.trim()) {
    throw new ValidationError('Email is required');
  }
  if (typeof passwordHash !== 'string' || !passwordHash) {
    throw new ValidationError('A password hash is required');
  }
  if (!USER_ROLES.includes(role)) {
    throw new ValidationError(`Role must be one of: ${USER_ROLES.join(', ')}`);
  }
  if (typeof isActive !== 'boolean') {
    throw new ValidationError('isActive must be a boolean');
  }

  const timestamp = Date.now();
  return {
    id,
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role,
    createdAt: createdAt ?? timestamp,
    updatedAt: updatedAt ?? timestamp,
    isActive
  };
}

function toPublicUser(user) {
  if (!user) return user;
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

module.exports = { USER_ROLES, createUserRecord, toPublicUser };
