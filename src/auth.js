// src/auth.js
const crypto = require("crypto");
const { createAuthRateLimiter } = require("./security");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function unb64url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function signToken(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  const expSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const obj = JSON.parse(unb64url(payload).toString("utf8"));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

function makeAuth({ hasFeature, engineerCode, engineerSecret }) {
  const COOKIE_NAME = "elaris_eng";
  const unlockLimiter = createAuthRateLimiter({
    windowMs: Number(process.env.ENGINEER_UNLOCK_RATE_LIMIT_WINDOW_MS) || (15 * 60 * 1000),
    maxFailures: Number(process.env.ENGINEER_UNLOCK_RATE_LIMIT_MAX_FAILURES) || 10,
  });

  function getRole(req) {
    // default USER
    const cookies = parseCookies(req.headers.cookie);
    const tok = cookies[COOKIE_NAME];
    const data = verifyToken(tok, engineerSecret);
    if (data?.role === "ENGINEER") return "ENGINEER";
    return "USER";
  }

  function requireEngineer(req, res, next) {
    if (!hasFeature("engineer_tools")) {
      return res.status(403).json({ ok: false, error: "engineer_not_licensed" });
    }
    if (getRole(req) !== "ENGINEER") {
      return res.status(401).json({ ok: false, error: "engineer_required" });
    }
    next();
  }

  function unlockEngineer(req, res) {
    if (!hasFeature("engineer_tools")) {
      return res.status(403).json({ ok: false, error: "engineer_not_licensed" });
    }
    const rlKey = unlockLimiter.keyFor(req, "engineer_unlock");
    const blocked = unlockLimiter.isBlocked(rlKey);
    if (blocked.blocked) {
      return res.status(429).json({ ok: false, error: "rate_limited", retry_after: blocked.retryAfterSec });
    }
    const code = String(req.body?.code || "");
    if (!code || code !== String(engineerCode)) {
      unlockLimiter.recordFailure(rlKey);
      return res.status(401).json({ ok: false, error: "bad_code" });
    }
    unlockLimiter.clear(rlKey);
    const now = Date.now();
    const exp = now + 30 * 24 * 60 * 60 * 1000; // 30 days
    const token = signToken({ role: "ENGINEER", iat: now, exp }, engineerSecret);
    const secure = process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";
    setCookie(res, COOKIE_NAME, token, { httpOnly: true, secure, maxAge: 30 * 24 * 60 * 60 });
    res.json({ ok: true });
  }

  function lockEngineer(req, res) {
    clearCookie(res, COOKIE_NAME);
    res.json({ ok: true });
  }

  return { getRole, requireEngineer, unlockEngineer, lockEngineer };
}

module.exports = { makeAuth };
