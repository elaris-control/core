'use strict';

const { makeGoogleOAuth, makeGithubOAuth } = require('../oauth');
const { makeAuth } = require('../auth');
const { initAccess } = require('../access');
const { makeCsrfTools } = require('../security');
const { makeRequireLogin } = require('../auth_routes');

function initAuthContext({ db, users, hasFeature, appSecret, engineerCode, engineerSecret, appUrl, googleClientId, googleClientSecret, githubClientId, githubClientSecret }) {
  const auth = makeAuth({
    hasFeature,
    engineerCode,
    users,
  });

  const access = initAccess({ db, auth });

  const google = (googleClientId && googleClientSecret)
    ? makeGoogleOAuth({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${appUrl}/auth/google/callback` })
    : null;

  const github = (githubClientId && githubClientSecret)
    ? makeGithubOAuth({ clientId: githubClientId, clientSecret: githubClientSecret, redirectUri: `${appUrl}/auth/github/callback` })
    : null;

  if (google) console.log('[AUTH] Google OAuth: enabled');
  if (github) console.log('[AUTH] GitHub OAuth: enabled');
  if (!google && !github) console.log('[AUTH] OAuth: disabled');

  const requireLogin = makeRequireLogin(users);

  function requireAdmin(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireAdmin(req, res, next));
    if (req.user.role !== 'ADMIN') return res.status(403).json({ ok: false, error: 'admin_only' });
    next();
  }

  function requireEngineerAccess(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireEngineerAccess(req, res, next));
    const unlocked = auth.getRole(req) === 'ENGINEER';
    const userRole = req.user?.role || 'USER';
    if (userRole === 'ADMIN' || userRole === 'ENGINEER' || unlocked) return next();
    return res.status(403).json({ ok: false, error: 'engineer_required' });
  }

  const csrf = makeCsrfTools({
    users,
    secret: appSecret || engineerSecret,
    secure: process.env.COOKIE_SECURE === '1',
  });

  return {
    auth,
    access,
    google,
    github,
    csrf,
    requireLogin,
    requireAdmin,
    requireEngineerAccess,
  };
}

module.exports = {
  initAuthContext,
};