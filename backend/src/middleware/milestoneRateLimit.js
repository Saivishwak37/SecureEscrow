const { BaseError } = require('../utils/errors');

const WINDOW_MS = 60_000;
const MAX_USERS_PER_WINDOW = 2000;
const REQUESTS_PER_USER = 5;

function milestoneRateLimit(now = () => performance.now()) {
  const windows = new Map();
  return function limit(req, res, next) {
    const time = now();
    for (const [userId, window] of windows) {
      if (window.expires > time) break;
      windows.delete(userId);
    }
    const userId = req.auth.userId;
    let window = windows.get(userId);
    if (!window && windows.size < MAX_USERS_PER_WINDOW) {
      window = { count: 0, expires: time + WINDOW_MS };
      windows.set(userId, window);
    }
    if (!window || window.count >= REQUESTS_PER_USER) {
      const expiry = window?.expires ?? windows.values().next().value.expires;
      res.set('Retry-After', String(Math.max(1, Math.ceil((expiry - time) / 1000))));
      res.set('Access-Control-Expose-Headers', 'Retry-After');
      return next(new BaseError('Too many milestone generation requests. Try again shortly.', 429, 'AI_RATE_LIMIT'));
    }
    window.count++;
    return next();
  };
}

module.exports = milestoneRateLimit;
