const userRepository = require('../repositories/userRepository');
const jwtService = require('../services/jwtService');
const { AuthenticationError, NotFoundError, BaseError } = require('../utils/errors');

function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return next(new AuthenticationError());

  try {
    const claims = jwtService.verifyAccessToken(match[1]);
    const user = userRepository.getCredentialUserById(claims.sub);
    if (!user.isActive || user.role !== claims.role) {
      return next(new AuthenticationError());
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    };
    return next();
  } catch (error) {
    if (error instanceof AuthenticationError) return next(error);
    if (error instanceof NotFoundError) return next(new AuthenticationError());
    return next(new BaseError('Authentication service unavailable'));
  }
}

module.exports = authenticate;
