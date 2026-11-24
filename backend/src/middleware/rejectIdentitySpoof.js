const { AuthenticationError, UnauthorizedError } = require('../utils/errors');
const fs = require('fs');

const IDENTITY_FIELDS = ['actorId', 'userId', 'senderId', 'uploadedBy', 'adminId', 'resolvedBy', 'payerId', 'clientId', 'creatorId'];

function reject(error, req, next) {
  if (req.file?.path) return fs.promises.unlink(req.file.path).catch(() => {}).finally(() => next(error));
  return next(error);
}

function rejectIdentitySpoof(req, res, next) {
  if (!req.auth?.userId || !req.auth?.role) return next(new AuthenticationError());
  for (const source of [req.body, req.query]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const field of IDENTITY_FIELDS) {
      if (source[field] !== undefined && source[field] !== req.auth.userId) {
        return reject(new UnauthorizedError('Client-supplied identity does not match the authenticated user'), req, next);
      }
    }
    if (source.role !== undefined && source.role !== req.auth.role) {
      return reject(new UnauthorizedError('Client-supplied role does not match the authenticated user'), req, next);
    }
  }
  return next();
}

module.exports = rejectIdentitySpoof;
