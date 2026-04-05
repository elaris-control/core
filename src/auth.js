// src/auth.js
const { createAuthRateLimiter, parseCookies } = require('./security');

function makeAuth({ hasFeature, engineerCode, users }) {
  const unlockLimiter = createAuthRateLimiter({
    windowMs: Number(process.env.ENGINEER_UNLOCK_RATE_LIMIT_WINDOW_MS) || (15 * 60 * 1000),
    maxFailures: Number(process.env.ENGINEER_UNLOCK_RATE_LIMIT_MAX_FAILURES) || 10,
  });

  function getSessionToken(req) {
    const cookies = parseCookies(req?.headers?.cookie || '');
    return cookies['elaris_session'] || null;
  }

  function getRole(req) {
    const token = getSessionToken(req);
    if (!token) return 'USER';
    const sess = users.verifySession(token);
    if (sess?.engineer_unlocked) return 'ENGINEER';
    return 'USER';
  }

  function requireEngineer(req, res, next) {
    if (!hasFeature('engineer_tools')) {
      return res.status(403).json({ ok: false, error: 'engineer_not_licensed' });
    }
    if (getRole(req) !== 'ENGINEER') {
      return res.status(401).json({ ok: false, error: 'engineer_required' });
    }
    next();
  }

  function unlockEngineer(req, res) {
    if (!hasFeature('engineer_tools')) {
      return res.status(403).json({ ok: false, error: 'engineer_not_licensed' });
    }
    const rlKey = unlockLimiter.keyFor(req, 'engineer_unlock');
    const blocked = unlockLimiter.isBlocked(rlKey);
    if (blocked.blocked) {
      return res.status(429).json({ ok: false, error: 'rate_limited', retry_after: blocked.retryAfterSec });
    }
    const code = String(req.body?.code || '');
    if (!code || code !== String(engineerCode)) {
      unlockLimiter.recordFailure(rlKey);
      return res.status(401).json({ ok: false, error: 'bad_code' });
    }
    unlockLimiter.clear(rlKey);
    const token = getSessionToken(req);
    if (!token || !users.unlockEngineer(token)) {
      return res.status(401).json({ ok: false, error: 'no_session' });
    }
    res.json({ ok: true });
  }

  function lockEngineer(req, res) {
    const token = getSessionToken(req);
    if (token) users.lockEngineer(token);
    res.json({ ok: true });
  }

  return { getRole, requireEngineer, unlockEngineer, lockEngineer };
}

module.exports = { makeAuth };
