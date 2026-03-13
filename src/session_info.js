const { parseCookies } = require('./security');

function getSessionToken(req, sessionCookie = 'elaris_session') {
  const cookies = parseCookies(req?.headers?.cookie || '');
  return cookies[sessionCookie] || null;
}

function getSession(req, users, sessionCookie = 'elaris_session') {
  const token = getSessionToken(req, sessionCookie);
  if (!token) return null;
  return users.verifySession(token);
}

function buildMePayload({ req, users, auth, hasFeature, sessionCookie = 'elaris_session', csrfToken = null, includeTs = true }) {
  const sess = getSession(req, users, sessionCookie);
  const engineerUnlocked = auth && typeof auth.getRole === 'function' && auth.getRole(req) === 'ENGINEER';
  const accountRole = String(sess?.role || 'USER').toUpperCase();
  const effectiveRole = sess
    ? ((accountRole === 'ENGINEER' || accountRole === 'ADMIN' || engineerUnlocked)
      ? (accountRole === 'ADMIN' ? 'ADMIN' : 'ENGINEER')
      : accountRole)
    : (engineerUnlocked ? 'ENGINEER' : 'USER');

  return {
    ok: !!sess,
    role: effectiveRole,
    accountRole,
    engineerUnlocked: !!engineerUnlocked,
    engineerLicensed: !!(typeof hasFeature === 'function' ? hasFeature('engineer_tools') : false),
    user: sess ? {
      id: sess.uid,
      email: sess.email,
      name: sess.name,
      role: sess.role,
    } : null,
    csrfToken: csrfToken || null,
    ...(includeTs ? { ts: Date.now() } : {}),
  };
}

module.exports = {
  getSessionToken,
  getSession,
  buildMePayload,
};
