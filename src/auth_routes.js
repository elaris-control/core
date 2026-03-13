// src/auth_routes.js
// All /auth/* routes: register, login, logout, OAuth callbacks, /me
const crypto = require("crypto");
const { createAuthRateLimiter, makeCsrfTools, parseCookies, buildCookie, appendSetCookie, clearCookie } = require("./security");
const { buildMePayload } = require("./session_info");

function initAuthRoutes({ users, google, github, appSecret }) {
  const express = require("express");
  const router  = express.Router();

  const SESSION_COOKIE = "elaris_session";
  const SECURE = process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";
  const csrf = makeCsrfTools({ users, secret: appSecret || process.env.APP_SECRET || "elaris-csrf", secure: SECURE, sessionCookie: SESSION_COOKIE });
  const rateLimit = createAuthRateLimiter({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || (15 * 60 * 1000),
    maxFailures: Number(process.env.AUTH_RATE_LIMIT_MAX_FAILURES) || 5,
  });

  // ── State map for OAuth CSRF protection (in-memory, short-lived) ──────
  const oauthStates = new Map();
  function newState() {
    const s = crypto.randomBytes(16).toString("hex");
    oauthStates.set(s, Date.now() + 10 * 60 * 1000); // 10 min TTL
    return s;
  }
  function checkState(s) {
    const exp = oauthStates.get(s);
    oauthStates.delete(s);
    return exp && Date.now() < exp;
  }

  function setSessionCookie(req, res, token) {
    appendSetCookie(res, buildCookie(SESSION_COOKIE, token, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "Lax",
      secure: SECURE,
    }));
    try { csrf.ensureForRequest({ ...req, headers: { ...(req.headers || {}), cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } }, res); } catch (_) {}
  }

  function clearSessionCookie(res) {
    appendSetCookie(res, clearCookie(SESSION_COOKIE, { path: "/", sameSite: "Lax", secure: SECURE }));
    csrf.clear(res);
  }

  function getToken(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    return cookies[SESSION_COOKIE] || null;
  }

  // ── Setup check (first-run) ────────────────────────────────────────────
  router.get("/setup-needed", (req, res) => {
    res.json({ setup: users.ensureAdminExists() });
  });

  // ── Register (first user becomes ADMIN, rest USER) ─────────────────────
  router.post("/register", (req, res) => {
    try {
      const { email, name, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: "missing_fields" });
      if (password.length < 8)  return res.status(400).json({ ok: false, error: "password_too_short" });

      const isFirst = users.ensureAdminExists();
      const role = isFirst ? "ADMIN" : "USER";
      const rlKey = rateLimit.keyFor(req, email);
      const blocked = rateLimit.isBlocked(rlKey);
      if (blocked.blocked) return res.status(429).json({ ok: false, error: "rate_limited", retry_after: blocked.retryAfterSec });
      const user = users.createUser({ email, name, password, role });
      const token = users.createSession(user.id, { ip: req.ip, ua: req.headers["user-agent"] });
      rateLimit.clear(rlKey);
      setSessionCookie(req, res, token);
      res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
      if (req?.body?.email) rateLimit.recordFailure(rateLimit.keyFor(req, req.body.email));
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // ── Login (local) ──────────────────────────────────────────────────────
  router.post("/login", (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: "missing_fields" });
      const rlKey = rateLimit.keyFor(req, email);
      const blocked = rateLimit.isBlocked(rlKey);
      if (blocked.blocked) return res.status(429).json({ ok: false, error: "rate_limited", retry_after: blocked.retryAfterSec });
      const user  = users.loginLocal({ email, password });
      const token = users.createSession(user.id, { ip: req.ip, ua: req.headers["user-agent"] });
      rateLimit.clear(rlKey);
      setSessionCookie(req, res, token);
      res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
      if (req?.body?.email) rateLimit.recordFailure(rateLimit.keyFor(req, req.body.email));
      res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
  });

  // ── Change Password ─────────────────────────────────────────────────────
  router.post("/change-password", (req, res) => {
    try {
      const token = getToken(req);
      const session = token ? users.verifySession(token) : null;
      if (!session) return res.status(401).json({ ok: false, error: "not_logged_in" });
      const { current_password, new_password } = req.body || {};
      if (!current_password || !new_password)
        return res.status(400).json({ ok: false, error: "missing_fields" });
      users.changePassword(session.user_id, current_password, new_password);
      res.json({ ok: true });
    } catch (e) {
      const msg = e.message === 'wrong_password' ? 'Wrong current password.'
        : e.message === 'password_too_short' ? 'New password must be at least 8 characters.'
        : e.message;
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // ── Logout ─────────────────────────────────────────────────────────────
  router.post("/logout", (req, res) => {
    const token = getToken(req);
    if (token) users.destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ── /me ────────────────────────────────────────────────────────────────
  router.get("/me", (req, res) => {
    csrf.ensureForRequest(req, res);
    res.json(buildMePayload({
      req,
      users,
      csrfToken: req.csrfToken || null,
    }));
  });

  // ── Google OAuth ────────────────────────────────────────────────────────
  if (google) {
    router.get("/google", (req, res) => {
      res.redirect(google.getAuthUrl(newState()));
    });

    router.get("/google/callback", async (req, res) => {
      try {
        const { code, state } = req.query;
        if (!checkState(state)) return res.redirect("/login.html?error=oauth_state");
        const profile = await google.exchangeCode(code);
        const user    = users.findOrCreateOAuthUser({ provider: "google", ...profile });
        const token   = users.createSession(user.id, { ip: req.ip, ua: req.headers["user-agent"] });
        setSessionCookie(req, res, token);
        res.redirect("/");
      } catch (e) {
        console.error("[OAuth/Google]", e.message);
        res.redirect("/login.html?error=oauth_failed");
      }
    });
  }

  // ── GitHub OAuth ────────────────────────────────────────────────────────
  if (github) {
    router.get("/github", (req, res) => {
      res.redirect(github.getAuthUrl(newState()));
    });

    router.get("/github/callback", async (req, res) => {
      try {
        const { code, state } = req.query;
        if (!checkState(state)) return res.redirect("/login.html?error=oauth_state");
        const profile = await github.exchangeCode(code);
        const user    = users.findOrCreateOAuthUser({ provider: "github", ...profile });
        const token   = users.createSession(user.id, { ip: req.ip, ua: req.headers["user-agent"] });
        setSessionCookie(req, res, token);
        res.redirect("/");
      } catch (e) {
        console.error("[OAuth/GitHub]", e.message);
        res.redirect("/login.html?error=oauth_failed");
      }
    });
  }

  return router;
}

// ── Middleware: requireLogin ───────────────────────────────────────────────
function makeRequireLogin(users) {
  return function requireLogin(req, res, next) {
    const h   = req.headers.cookie || "";
    const m   = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
    const tok = m ? decodeURIComponent(m[1]) : null;
    const sess = users.verifySession(tok);
    if (!sess) return res.status(401).json({ ok: false, error: "not_authenticated" });
    req.user = { id: sess.uid, email: sess.email, name: sess.name, role: sess.role };
    next();
  };
}

module.exports = { initAuthRoutes, makeRequireLogin };
