const authService = require('../services/authService');
const { BaseError } = require('../utils/errors');

async function register(req, res, next) {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error instanceof BaseError ? error : new BaseError('Registration failed'));
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error instanceof BaseError ? error : new BaseError('Authentication service unavailable'));
  }
}

function me(req, res) {
  const { id, username, email, role } = req.auth.user;
  res.status(200).json({ success: true, data: { id, username, email, role } });
}

module.exports = { register, login, me };
