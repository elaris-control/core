// src/users.js
// User management — local accounts + OAuth identities
const crypto = require("crypto");
const { normalizeEmailAddress } = require("./email_utils");

function initUsers(db) {
  // ── Tables ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT,
      password_hash TEXT,          -- NULL for OAuth-only users
      password_salt TEXT,
      role        TEXT NOT NULL DEFAULT 'USER', -- USER | ADMIN | ENGINEER
      active      INTEGER NOT NULL DEFAULT 1,
      created_ts  INTEGER NOT NULL,
      last_login  INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_oauth (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider    TEXT NOT NULL,   -- 'google' | 'github'
      provider_id TEXT NOT NULL,
      email       TEXT,
      created_ts  INTEGER NOT NULL,
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_ts  INTEGER NOT NULL,
      expires_ts  INTEGER NOT NULL,
      ip          TEXT,
      user_agent  TEXT
    );
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_ts)`); } catch (_) {}

  // ── Helpers ──────────────────────────────────────────────────────────
  function hashPassword(password, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return { hash: `s2$${salt}$${hash}`, salt };
  }

  function verifyPassword(password, user) {
    const stored = String(user?.password_hash || "");
    if (!stored) return false;
    if (stored.startsWith("s2$")) {
      const parts = stored.split("$");
      const salt = parts[1] || user.password_salt || "";
      const hash = parts[2] || "";
      if (!salt || !hash) return false;
      const candidate = crypto.scryptSync(String(password), salt, 64).toString("hex");
      const a = Buffer.from(candidate, "hex");
      const b = Buffer.from(hash, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const { hash } = (function legacyHash(pass, saltValue) {
      const out = crypto.createHmac("sha256", saltValue).update(pass).digest("hex");
      return { hash: out };
    })(String(password), user.password_salt);
    const a = Buffer.from(hash);
    const b = Buffer.from(stored);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function generateToken() {
    return crypto.randomBytes(32).toString("hex");
  }


  function normalizeEmail(email){
    return normalizeEmailAddress(email);
  }

// ── Prepared statements ──────────────────────────────────────────────
  const insertUser = db.prepare(`
    INSERT INTO users(email, name, password_hash, password_salt, role, active, created_ts)
    VALUES(@email, @name, @password_hash, @password_salt, @role, 1, @ts)
  `);

  const getUserByEmail   = db.prepare(`SELECT * FROM users WHERE email = ? AND active = 1`);
  const getUserById      = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`);
  const listUsers        = db.prepare(`SELECT id, email, name, role, active, created_ts, last_login FROM users ORDER BY created_ts ASC`);
  const updateLastLogin  = db.prepare(`UPDATE users SET last_login = ? WHERE id = ?`);
  const updateRole       = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);
  const deactivateUser   = db.prepare(`UPDATE users SET active = 0 WHERE id = ?`);
  const updatePassword   = db.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`);

  const upsertOAuth = db.prepare(`
    INSERT INTO user_oauth(user_id, provider, provider_id, email, created_ts)
    VALUES(@user_id, @provider, @provider_id, @email, @ts)
    ON CONFLICT(provider, provider_id) DO UPDATE SET email=excluded.email
  `);

  const getOAuthUser = db.prepare(`
    SELECT u.* FROM users u
    JOIN user_oauth o ON o.user_id = u.id
    WHERE o.provider = ? AND o.provider_id = ? AND u.active = 1
  `);

  const insertSession = db.prepare(`
    INSERT INTO user_sessions(token, user_id, created_ts, expires_ts, ip, user_agent)
    VALUES(@token, @user_id, @ts, @expires, @ip, @ua)
  `);

  const getSession = db.prepare(`
    SELECT s.*, u.id as uid, u.email, u.name, u.role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_ts > ? AND u.active = 1
  `);

  const deleteSession    = db.prepare(`DELETE FROM user_sessions WHERE token = ?`);
  const cleanSessions    = db.prepare(`DELETE FROM user_sessions WHERE expires_ts < ?`);
  const countUsers       = db.prepare(`SELECT COUNT(*) as c FROM users WHERE active = 1`);

  // ── Public API ────────────────────────────────────────────────────────

  function createUser({ email, name, password, role = "USER" }) {
    email = normalizeEmail(email);
    const existing = getUserByEmail.get(email);
    if (existing) throw new Error("email_taken");
    let password_hash = null, password_salt = null;
    if (password) {
      const h = hashPassword(password);
      password_hash = h.hash;
      password_salt = h.salt;
    }
    const info = insertUser.run({ email, name: name || email.split("@")[0], password_hash, password_salt, role, ts: Date.now() });
    return getUserById.get(info.lastInsertRowid);
  }

  function loginLocal({ email, password }) {
    email = normalizeEmail(email);
    const user = getUserByEmail.get(email);
    if (!user || !user.password_hash) throw new Error("invalid_credentials");
    const ok = verifyPassword(password, user);
    if (!ok) throw new Error("invalid_credentials");
    if (!String(user.password_hash || "").startsWith("s2$")) {
      const upgraded = hashPassword(password);
      updatePassword.run(upgraded.hash, upgraded.salt, user.id);
      return getUserByEmail.get(email);
    }
    return user;
  }

  function findOrCreateOAuthUser({ provider, provider_id, email, name }) {
    // 1. Existing OAuth link
    let user = getOAuthUser.get(provider, provider_id);
    if (user) return user;
    // 2. Email match (link to existing account)
    if (email) {
      user = getUserByEmail.get(email.toLowerCase());
      if (user) {
        upsertOAuth.run({ user_id: user.id, provider, provider_id, email, ts: Date.now() });
        return user;
      }
    }
    // 3. Create new user
    const newUser = createUser({ email: email || `${provider}_${provider_id}@oauth.local`, name, role: "USER" });
    upsertOAuth.run({ user_id: newUser.id, provider, provider_id, email: email || null, ts: Date.now() });
    return newUser;
  }

  function createSession(userId, { ip = null, ua = null } = {}) {
    const token    = generateToken();
    const ts       = Date.now();
    const expires  = ts + 30 * 24 * 60 * 60 * 1000; // 30 days
    insertSession.run({ token, user_id: userId, ts, expires, ip, ua });
    updateLastLogin.run(ts, userId);
    return token;
  }

  function verifySession(token) {
    if (!token) return null;
    return getSession.get(token, Date.now()) || null;
  }

  function destroySession(token) {
    deleteSession.run(token);
  }

  function purgeExpiredSessions() {
    cleanSessions.run(Date.now());
  }

  function ensureAdminExists() {
    const { c } = countUsers.get();
    return c === 0; // true = no users yet, setup needed
  }

  function setRole(userId, role) {
    if (!["USER", "ADMIN", "ENGINEER"].includes(role)) throw new Error("invalid_role");
    updateRole.run(role, userId);
  }

  function deactivate(userId) {
    deactivateUser.run(userId);
  }

  const reactivateUser = db.prepare(`UPDATE users SET active = 1 WHERE id = ?`);
  function reactivate(userId) {
    reactivateUser.run(userId);
  }

  function changePassword(userId, currentPassword, newPassword) {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!user) throw new Error('user_not_found');
    if (user.password_hash && !verifyPassword(currentPassword, user))
      throw new Error('wrong_password');
    if (!newPassword || newPassword.length < 8)
      throw new Error('password_too_short');
    const h = hashPassword(newPassword);
    updatePassword.run(h.hash, h.salt, userId);
  }

  return {
    createUser,
    loginLocal,
    findOrCreateOAuthUser,
    createSession,
    verifySession,
    destroySession,
    purgeExpiredSessions,
    ensureAdminExists,
    getUserById,
    listUsers,
    setRole,
    deactivate,
    reactivate,
    changePassword,
  };
}

module.exports = { initUsers };
