const { AuthenticationError, UnauthorizedError } = require('../utils/errors');

function requireRole(...allowedRoles) {
  return function roleAuthorization(req, res, next) {
    if (!req.auth?.userId || !req.auth?.role) return next(new AuthenticationError());
    if (!allowedRoles.includes(req.auth.role)) return next(new UnauthorizedError('You are not authorized to perform this operation'));
    return next();
  };
}

module.exports = requireRole;
