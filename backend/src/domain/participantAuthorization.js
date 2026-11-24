const { getStore } = require('../data/store');
const { UnauthorizedError } = require('../utils/errors');

function findActiveUser(userId) {
  const user = getStore().findById('users', userId);
  if (!user || user.isActive === false) throw new UnauthorizedError('Authenticated participant is unavailable');
  return user;
}

function getUserRole(user) {
  return user?.role || user?.type || null;
}

function assertActorRole(userId, allowedRoles) {
  const user = findActiveUser(userId);
  if (!allowedRoles.includes(getUserRole(user))) throw new UnauthorizedError('This role is not permitted to perform the requested operation');
  return user;
}

function assertEscrowParticipantRole(escrow, userId, allowedRoles) {
  const user = findActiveUser(userId);
  const role = getUserRole(user);
  if (!allowedRoles.includes(role)) {
    if (allowedRoles.length === 1 && allowedRoles[0] === 'CLIENT') {
      throw new UnauthorizedError('Only the agreement client is authorized to perform this operation');
    }
    if (allowedRoles.length === 1 && allowedRoles[0] === 'PROVIDER') {
      throw new UnauthorizedError('This participant is not authorized; the operation requires role PAYEE (PROVIDER)');
    }
    throw new UnauthorizedError('This role is not permitted to perform the requested operation');
  }
  const clientId = escrow.clientId || escrow.payerId;
  const providerId = escrow.freelancerId || escrow.payeeId;
  if ((role === 'CLIENT' && allowedRoles.includes('CLIENT') && userId === clientId)
    || (role === 'PROVIDER' && allowedRoles.includes('PROVIDER') && userId === providerId)) {
    return user;
  }
  throw new UnauthorizedError('This participant is not authorized for the requested operation');
}

module.exports = { findActiveUser, getUserRole, assertActorRole, assertEscrowParticipantRole };
