
const crypto = require("crypto");

function parseCookies(header = "") {
  const out = {};
  String(header || "").split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function appendSetCookie(res, cookie) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", [cookie]);
    return;
  }
  const arr = Array.isArray(prev) ? prev.slice() : [String(prev)];
  arr.push(cookie);
  res.setHeader("Set-Cookie", arr);
}

function buildCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(opts.maxAge) || 0)}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name, opts = {}) {
  return buildCookie(name, "", { ...opts, maxAge: 0 });
}

function createCsrfToken(sessionToken, secret) {
  return crypto.createHmac("sha256", String(secret || "elaris-csrf"))
    .update(`csrf:${String(sessionToken || "")}`)
    .digest("hex");
}

function makeCsrfTools({ users, secret, secure = false, sessionCookie = "elaris_session", csrfCookie = "elaris_csrf" }) {
  function ensureForRequest(req, res) {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[sessionCookie];
    if (!token) return null;
    const sess = users.verifySession(token);
    if (!sess) return null;
    const csrf = createCsrfToken(token, secret);
    if (cookies[csrfCookie] !== csrf) {
      appendSetCookie(res, buildCookie(csrfCookie, csrf, {
        path: "/",
        sameSite: "Lax",
        secure,
        maxAge: 30 * 24 * 60 * 60,
      }));
    }
    req.csrfToken = csrf;
    return csrf;
  }

  function attach(req, res, next) {
    try { ensureForRequest(req, res); } catch (_) {}
    next();
  }

  function requireToken(req, res, next) {
    const method = String(req.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();

    const cookies = parseCookies(req.headers.cookie || "");
    const sessionToken = cookies[sessionCookie];
    if (!sessionToken) return next();
    const sess = users.verifySession(sessionToken);
    if (!sess) return next();

    const expected = createCsrfToken(sessionToken, secret);
    const cookieToken = cookies[csrfCookie] || "";
    const headerToken = String(req.headers["x-csrf-token"] || req.headers["x-csrf"] || req.body?._csrf || "");

    if (!cookieToken || !headerToken || cookieToken !== expected || headerToken !== expected) {
      return res.status(403).json({ ok: false, error: "csrf_invalid" });
    }
    req.csrfToken = expected;
    next();
  }

  function clear(res) {
    appendSetCookie(res, clearCookie(csrfCookie, { path: "/", sameSite: "Lax", secure }));
  }

  return { attach, requireToken, clear, ensureForRequest, parseCookies, buildCookie, appendSetCookie };
}

function createAuthRateLimiter({ windowMs = 15 * 60 * 1000, maxFailures = 5 } = {}) {
  const bucket = new Map();

  function cleanup(now = Date.now()) {
    for (const [key, entry] of Array.from(bucket.entries())) {
      if (!entry || !entry.firstTs || (now - entry.firstTs) > windowMs) bucket.delete(key);
    }
  }

  function keyFor(req, email = "") {
    const ip = String(req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    return `${ip}|${normalizedEmail}`;
  }

  function isBlocked(key) {
    cleanup();
    const entry = bucket.get(key);
    if (!entry) return { blocked: false, retryAfterSec: 0 };
    if (entry.count < maxFailures) return { blocked: false, retryAfterSec: 0 };
    const retryAfterMs = Math.max(0, windowMs - (Date.now() - entry.firstTs));
    return { blocked: retryAfterMs > 0, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  function recordFailure(key) {
    cleanup();
    const now = Date.now();
    const prev = bucket.get(key);
    if (!prev || (now - prev.firstTs) > windowMs) {
      bucket.set(key, { count: 1, firstTs: now, lastTs: now });
      return;
    }
    prev.count += 1;
    prev.lastTs = now;
    bucket.set(key, prev);
  }

  function clear(key) {
    bucket.delete(key);
  }

  return { keyFor, isBlocked, recordFailure, clear };
}

function securityHeaders({ isProd = false } = {}) {
  const defaultCsp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws: wss: http: https:",
  ].join("; ");
  const csp = process.env.ELARIS_CSP || defaultCsp;
  return function applySecurityHeaders(req, res, next) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (process.env.ELARIS_DISABLE_CSP !== "1") {
      res.setHeader("Content-Security-Policy", csp);
    }
    const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http"));
    if (isProd && proto === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

module.exports = {
  parseCookies,
  buildCookie,
  clearCookie,
  appendSetCookie,
  createCsrfToken,
  makeCsrfTools,
  createAuthRateLimiter,
  securityHeaders,
};
