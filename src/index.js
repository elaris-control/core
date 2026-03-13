// src/index.js
const express = require("express");
const http    = require("http");
const cors    = require("cors");
const morgan  = require("morgan");
const path    = require("path");
const fs      = require("fs");


const { getDBPath, ensureDirForFile, migrateLegacyDBIfNeeded } = require("./paths");
const { initDB }           = require("./db");
const { initWS }           = require("./ws");
const { initMQTT }         = require("./mqtt");
const { initRoutes }       = require("./routes");
const { initUsers }        = require("./users");
const { initAuthRoutes, makeRequireLogin } = require("./auth_routes");
const { securityHeaders, makeCsrfTools } = require("./security");
const { buildMePayload } = require("./session_info");
const { makeGoogleOAuth, makeGithubOAuth } = require("./oauth");
const { loadLicense, hasFeature, getLicense } = require("./license");
const { makeAuth }         = require("./auth");
const { initModuleRoutes }    = require("./module_routes");
const { initNavRoutes }       = require("./nav_routes");
const { getWeather }           = require("./weather");
const { AutomationEngine }      = require("./automation/engine");
const { initNotifications }     = require("./notifications");
const { initScenes }            = require("./scenes");
const { getModule }            = require("./modules/index");
const { initEsphomeRoutes }    = require("./esphome_routes");

// ── ENV validation — fail loudly in production ────────────────────────────
const PORT      = process.env.PORT      || 8080;
const MQTT_URL  = process.env.MQTT_URL  || "mqtt://localhost:1883";
const NODE_ENV  = process.env.NODE_ENV  || "development";
const IS_PROD   = NODE_ENV === "production";

// Engineer legacy auth (for engineer unlock flow)
const ENGINEER_CODE = process.env.ENGINEER_CODE;
const ENGINEER_SECRET = process.env.ENGINEER_SECRET;

if (IS_PROD) {
  const required = { ENGINEER_CODE, ENGINEER_SECRET };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`[ELARIS] FATAL: Missing required env vars in production: ${missing.join(", ")}`);
    console.error(`[ELARIS] Set them before starting. Refusing to start with insecure defaults.`);
    process.exit(1);
  }
}

// OAuth config (optional — only enabled if env vars are set)
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL              = process.env.APP_URL || `http://localhost:${PORT}`;

async function main() {
  const ok  = loadLicense();
  const lic = getLicense();
  console.log("[LICENSE] loaded:", ok, "| type:", lic?.type || "NONE");
  console.log("[LICENSE] engineer_tools:", hasFeature("engineer_tools"));

  const app    = express();
  const server = http.createServer(app);
  app.disable("x-powered-by");
  app.use(securityHeaders({ isProd: IS_PROD }));

  // ── Dev helpers ────────────────────────────────────────────────────────
  if (!IS_PROD) {
    app.use((_, res, next) => { res.removeHeader("Content-Security-Policy"); next(); });
    app.use((_, res, next) => {
      res.setHeader("Cache-Control", "no-store"); next();
    });
    app.use(cors());
  } else if (process.env.CORS_ORIGIN) {
    const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
    app.use(cors({ origin: origins, credentials: true }));
  }

  app.use(express.json({ limit: "256kb" }));
  app.use(morgan("dev"));

  // ── Core services ──────────────────────────────────────────────────────
  const dbApi = (() => {
  const DB_PATH = getDBPath();
  // If upgrading from older versions, move ./elaris.db to ./data/elaris.db automatically
  migrateLegacyDBIfNeeded(DB_PATH);
  ensureDirForFile(DB_PATH);
  return initDB(DB_PATH);
})();
  const wsApi = initWS(server, { db: dbApi.db });

  // ── Live log broadcasting ───────────────────────────────────────────────
  const _origLog        = console.log.bind(console);
  const _origWarn       = console.warn.bind(console);
  const _origError      = console.error.bind(console);
  const _origStdoutWrite = process.stdout.write.bind(process.stdout);
  const _origStderrWrite = process.stderr.write.bind(process.stderr);

  function _fmtArgs(args) { return args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "); }
  function _emitLog(level, text) {
    const lines = text.replace(/\n$/, "").split("\n");
    for (const line of lines) {
      if (line.trim()) wsApi.broadcastLog({ level, text: line, ts: Date.now() });
    }
  }

  console.log   = (...a) => { _origLog(...a);   _emitLog("info",  _fmtArgs(a)); };
  console.warn  = (...a) => { _origWarn(...a);  _emitLog("warn",  _fmtArgs(a)); };
  console.error = (...a) => { _origError(...a); _emitLog("error", _fmtArgs(a)); };

  // Capture Morgan + anything written directly to stdout/stderr
  process.stdout.write = (chunk, ...rest) => {
    _origStdoutWrite(chunk, ...rest);
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    _emitLog("info", text);
    return true;
  };
  process.stderr.write = (chunk, ...rest) => {
    _origStderrWrite(chunk, ...rest);
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    _emitLog("warn", text);
    return true;
  };

  const users = initUsers(dbApi.db);

  // ── Notifications + Scenes ──────────────────────────────────────────────
  const notifyApi = initNotifications(dbApi.db);
  const scenesApi = initScenes(dbApi.db);

  // ── Events cleanup — keep 30 days, run every 24h ───────────────────────
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  function cleanupEvents() {
    const cutoff = Date.now() - THIRTY_DAYS;
    try {
      const r = dbApi.db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
      if (r.changes > 0) console.log(`[CLEANUP] Deleted ${r.changes} old events`);
    } catch (e) { console.error("[CLEANUP] events error:", e.message); }
    // also purge expired sessions
    try { users.purgeExpiredSessions(); } catch (_) {}
  }
  cleanupEvents();
  setInterval(cleanupEvents, 24 * 60 * 60 * 1000);

  // ── Automation Engine ────────────────────────────────────────────────────
  const engine = new AutomationEngine({ db: dbApi.db, broadcast: wsApi.broadcast });

  // Wire notify into engine so modules can call ctx._engine.notify(...)
  engine.notify = (opts) => notifyApi.notify(opts).catch(e => console.error("[NOTIFY]", e.message));
  // Also wire broadcast so ctx.broadcastState() works
  engine.broadcast = wsApi.broadcast;

  // Start periodic 30s tick so schedule/sunset/sunrise triggers never miss their minute
  engine.startTick(30000);
  // Wire scenesApi into engine for custom logic scene triggers
  engine.scenesApi = scenesApi;

  // ── MQTT ───────────────────────────────────────────────────────────────
  const mqttApi = initMQTT({ url: MQTT_URL, dbApi, broadcast: wsApi.broadcast, solarAuto: engine });
  engine.setMqttApi(mqttApi);

  // Evaluate all instances on startup
  setTimeout(() => engine.evaluateAll(), 2000);

  // ── Auth (legacy engineer cookie) ─────────────────────────────────────
  const auth = makeAuth({
    hasFeature,
    engineerCode:   ENGINEER_CODE   || "1234",
    engineerSecret: ENGINEER_SECRET || "dev-secret-change-me",
  });

  // ── OAuth providers ────────────────────────────────────────────────────
  const google = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
    ? makeGoogleOAuth({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: `${APP_URL}/auth/google/callback` })
    : null;

  const github = (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)
    ? makeGithubOAuth({ clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, redirectUri: `${APP_URL}/auth/github/callback` })
    : null;

  if (google) console.log("[AUTH] Google OAuth: enabled");
  if (github) console.log("[AUTH] GitHub OAuth: enabled");
  if (!google && !github) console.log("[AUTH] OAuth: disabled (no env vars set)");

  // ── requireLogin middleware ────────────────────────────────────────────
  const requireLogin = makeRequireLogin(users);
  const { requireEngineer } = auth;
  const csrf = makeCsrfTools({ users, secret: process.env.APP_SECRET || ENGINEER_SECRET || "elaris-csrf", secure: process.env.COOKIE_SECURE === "1" || IS_PROD });

  function requireAdmin(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireAdmin(req, res, next));
    if (req.user.role !== "ADMIN") return res.status(403).json({ ok: false, error: "admin_only" });
    next();
  }

  function requireEngineerAccess(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireEngineerAccess(req, res, next));
    const unlocked = auth.getRole(req) === "ENGINEER";
    const userRole = req.user?.role || "USER";
    if (userRole === "ADMIN" || userRole === "ENGINEER" || unlocked) return next();
    return res.status(403).json({ ok: false, error: "engineer_required" });
  }

  function isEngineerLike(req) {
    if (!req?.user) return false;
    const unlocked = auth.getRole(req) === "ENGINEER";
    const userRole = String(req.user?.role || "USER").toUpperCase();
    return userRole === "ADMIN" || userRole === "ENGINEER" || unlocked;
  }

  function getInstanceWithDefinition(instanceId) {
    const inst = engine._getInstances.all().find(i => i.id === Number(instanceId));
    if (!inst) return { inst: null, def: null, ui: null };
    const def = getModule(inst.module_id);
    return { inst, def, ui: def?.ui || {} };
  }

  function ensureUserModuleAccess(req, res, instanceId, check) {
    const { inst, def, ui } = getInstanceWithDefinition(instanceId);
    if (!inst || !def) {
      res.status(404).json({ ok: false, error: "instance_not_found" });
      return null;
    }
    if (isEngineerLike(req)) return { inst, def, ui };
    const allowed = typeof check === "function" ? !!check({ inst, def, ui }) : false;
    if (!allowed) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return null;
    }
    return { inst, def, ui };
  }

  app.use(csrf.attach);
  app.use((req, res, next) => {
    const path = req.path || "";
    const safeAuth = ["/auth/login", "/auth/register", "/auth/google", "/auth/github", "/auth/google/callback", "/auth/github/callback", "/auth/setup-needed"].includes(path);
    if ((path.startsWith("/api/") || path.startsWith("/auth/")) && !safeAuth) return csrf.requireToken(req, res, next);
    next();
  });

  // ══════════════════════════════════════════════════════════════════════
  //  MIDDLEWARE ORDER (critical):
  //  1. /auth/*        login / register / OAuth  ← BEFORE static
  //  2. /api/me        session check
  //  3. /api/admin/*   user management
  //  4. /api/*         all other API
  //  5. HTML guard     redirect .html if no session
  //  6. static         serve public/ files  ← LAST
  // ══════════════════════════════════════════════════════════════════════

  // ── 1. Auth routes ────────────────────────────────────────────────────
  app.use("/auth", initAuthRoutes({ users, google, github, appSecret: process.env.APP_SECRET || ENGINEER_SECRET || "elaris-csrf" }));

  // ── 2. /api/me ────────────────────────────────────────────────────────
  app.get("/api/me", (req, res) => {
    csrf.ensureForRequest(req, res);
    res.json(buildMePayload({
      req,
      users,
      auth,
      hasFeature,
      csrfToken: req.csrfToken || null,
    }));
  });

  // ── 3. Admin API ──────────────────────────────────────────────────────
  app.get("/api/admin/users", requireAdmin, (req, res) => {
    res.json({ ok: true, users: users.listUsers.all() });
  });

  app.patch("/api/admin/users/:id/role", requireAdmin, (req, res) => {
    try {
      const targetId = Number(req.params.id);
      if (targetId === req.user.id) return res.status(400).json({ ok: false, error: "cannot_change_self_role" });
      const all    = users.listUsers.all();
      const admins = all.filter(u => u.active && u.role === "ADMIN");
      const target = all.find(u => u.id === targetId);
      if (target?.role === "ADMIN" && admins.length <= 1 && req.body.role !== "ADMIN")
        return res.status(400).json({ ok: false, error: "cannot_remove_last_admin" });
      users.setRole(targetId, req.body.role);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ ok: false, error: "cannot_deactivate_self" });
    const all = users.listUsers.all();
    const target = all.find(u => u.id === targetId);
    if (!target) return res.status(404).json({ ok: false, error: "not_found" });
    if (target.active && target.role === "ADMIN") {
      const activeAdmins = all.filter(u => u.active && u.role === "ADMIN");
      if (activeAdmins.length <= 1) return res.status(400).json({ ok: false, error: "cannot_deactivate_last_admin" });
    }
    users.deactivate(targetId);
    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/reactivate", requireAdmin, (req, res) => {
    users.reactivate(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Admin DB management ───────────────────────────────────────────────
  const _db = dbApi.db;

  app.get("/api/admin/db/devices", requireAdmin, (req, res) => {
    try {
      const devices = _db.prepare(`
        SELECT d.id, d.name, d.last_seen,
          (SELECT COUNT(*) FROM io WHERE device_id = d.id) AS io_count,
          (SELECT COUNT(*) FROM pending_io WHERE device_id = d.id) AS pending_count
        FROM devices d ORDER BY d.id ASC
      `).all();
      res.json({ ok: true, devices });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/admin/db/devices/:deviceId", requireAdmin, (req, res) => {
    try {
      const id = req.params.deviceId;
      _db.transaction(() => {
        _db.prepare(`DELETE FROM io WHERE device_id = ?`).run(id);
        _db.prepare(`DELETE FROM pending_io WHERE device_id = ?`).run(id);
        _db.prepare(`DELETE FROM blocked_io WHERE device_id = ?`).run(id);
        _db.prepare(`DELETE FROM device_state WHERE device_id = ?`).run(id);
        _db.prepare(`DELETE FROM device_site WHERE device_id = ?`).run(id);
        _db.prepare(`DELETE FROM esphome_devices WHERE name = ? OR mqtt_topic_root = ?`).run(id, `elaris/${id}`);
        _db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
      })();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get("/api/admin/db/pending", requireAdmin, (req, res) => {
    try {
      const rows = _db.prepare(`
        SELECT id, device_id, group_name, key, last_seen, last_value
        FROM pending_io ORDER BY device_id, last_seen DESC
      `).all();
      res.json({ ok: true, pending: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/admin/db/pending/:id", requireAdmin, (req, res) => {
    try {
      _db.prepare(`DELETE FROM pending_io WHERE id = ?`).run(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/admin/db/pending", requireAdmin, (req, res) => {
    try {
      const { device_id } = req.query;
      if (device_id) {
        _db.prepare(`DELETE FROM pending_io WHERE device_id = ?`).run(device_id);
      } else {
        _db.prepare(`DELETE FROM pending_io`).run();
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get("/api/admin/db/profiles", requireAdmin, (req, res) => {
    try {
      const rows = _db.prepare(`
        SELECT id, label, platform, board, source, updated_at
        FROM esphome_board_profiles WHERE is_enabled = 1 ORDER BY label COLLATE NOCASE ASC
      `).all();
      res.json({ ok: true, profiles: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/admin/db/profiles/:id", requireAdmin, (req, res) => {
    try {
      const id = req.params.id;
      _db.prepare(`DELETE FROM esphome_profile_capabilities WHERE profile_id = ?`).run(id);
      _db.prepare(`DELETE FROM esphome_board_profiles WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Repair: integrity check + WAL checkpoint + VACUUM
  app.post("/api/admin/db/repair", requireAdmin, (req, res) => {
    try {
      const integrity = _db.prepare(`PRAGMA integrity_check`).all();
      _db.prepare(`PRAGMA wal_checkpoint(TRUNCATE)`).run();
      _db.exec(`VACUUM`);
      const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
      res.json({ ok: true, integrity: ok ? 'ok' : 'errors', details: integrity });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Erase all data (factory reset) — keeps schema, deletes all rows
  app.post("/api/admin/db/erase", requireAdmin, (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'ERASE') return res.status(400).json({ ok: false, error: 'missing_confirm' });
    try {
      _db.transaction(() => {
        _db.prepare(`DELETE FROM pending_io`).run();
        _db.prepare(`DELETE FROM blocked_io`).run();
        _db.prepare(`DELETE FROM io`).run();
        _db.prepare(`DELETE FROM device_state`).run();
        _db.prepare(`DELETE FROM events`).run();
        _db.prepare(`DELETE FROM device_site`).run();
        _db.prepare(`DELETE FROM devices`).run();
        _db.prepare(`DELETE FROM esphome_devices`).run();
        _db.prepare(`DELETE FROM esphome_generated_configs`).run();
        _db.prepare(`DELETE FROM esphome_install_jobs`).run();
        _db.prepare(`DELETE FROM esphome_device_overrides`).run();
        _db.prepare(`DELETE FROM module_mappings`).run();
        _db.prepare(`DELETE FROM module_instances`).run();
        _db.prepare(`DELETE FROM zones`).run();
        // Keep users, sites, board_profiles — only wipe device/IO data
      })();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── 4. Module routes (BEFORE generic /api to avoid prefix conflict) ──
  app.use("/api/modules", initModuleRoutes({ db: dbApi.db, requireLogin, requireEngineer: requireEngineerAccess }));
  app.use("/api/nav",     initNavRoutes({ db: dbApi.db, requireLogin }));

  // ── 4b. API routes ────────────────────────────────────────────────────
  app.use("/api", initRoutes({ dbApi, mqttApi, auth, hasFeature, requireLogin, requireEngineerAccess, users }));

  // ── 4b2. IP Geolocation (server-side, no HTTPS needed) ─────────────────
  app.get("/api/geolocate", requireLogin, (req, res) => {
    const https = require("https");
    // ip-api.com free tier — no key needed, 45 req/min
    const url = "http://ip-api.com/json/?fields=lat,lon,city,regionName,country,timezone,status";
    require("http").get(url, (r) => {
      let body = "";
      r.on("data", d => body += d);
      r.on("end", () => {
        try {
          const d = JSON.parse(body);
          if (d.status === "success") {
            res.json({ ok:true, lat:d.lat, lon:d.lon, city:d.city, region:d.regionName, country:d.country, timezone:d.timezone });
          } else {
            res.status(400).json({ ok:false, error:"geolocate_failed" });
          }
        } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
      });
    }).on("error", e => res.status(500).json({ ok:false, error:e.message }));
  });

  // ── 4b3. Logs API ────────────────────────────────────────────────────
  app.get("/api/logs", requireLogin, (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit||50), 200);
    const offset = parseInt(req.query.offset||0);
    const type   = req.query.type || "";
    try {
      let sql = `SELECT instance_id, action, reason, ts FROM automation_log`;
      const params = [];
      if (type === "solar")  { sql += ` WHERE instance_id IN (SELECT id FROM module_instances WHERE module_id='solar')`; }
      if (type === "custom") { sql += ` WHERE instance_id IN (SELECT id FROM module_instances WHERE module_id='custom')`; }
      sql += ` ORDER BY ts DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      const rows = dbApi.db.prepare(sql).all(...params);
      res.json({ ok:true, logs: rows });
    } catch(e) {
      res.json({ ok:true, logs:[] });
    }
  });

  // ── 4c. Weather API ──────────────────────────────────────────────────────
  // GET /api/weather/:site_id
  app.get("/api/weather/:site_id", requireLogin, async (req, res) => {
    try {
      const site = dbApi.db.prepare("SELECT * FROM sites WHERE id=?").get(Number(req.params.site_id));
      if (!site) return res.status(404).json({ ok:false, error:"site_not_found" });
      if (!site.lat || !site.lon) return res.status(400).json({ ok:false, error:"no_location", hint:"Set site location in Settings" });
      const weather = await getWeather(site.lat, site.lon);
      res.json({ ok:true, weather });
    } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
  });

  // ── 4d. Generic Automation API ────────────────────────────────────────
  // Generic automation status endpoint (works for any module via engine)
  app.get("/api/automation/status/:id", requireLogin, (req, res) => {
    try {
      const access = ensureUserModuleAccess(req, res, Number(req.params.id), ({ ui }) => !!ui.user_view);
      if (!access) return;
      const s=engine.getLiveStatus(Number(req.params.id));
      res.json({ok:true,...s});
    } catch(e){ res.status(500).json({ok:false,error:e.message}); }
  });
  app.get("/api/automation/settings/:id", requireEngineerAccess, (req, res) => {
    try { res.json({ok:true,settings:engine.getSettings(Number(req.params.id))}); }
    catch(e){ res.status(500).json({ok:false,error:e.message}); }
  });
  app.patch("/api/automation/settings/:id", requireEngineerAccess, (req, res) => {
    try { const {key,value}=req.body; const v=engine.setSetting(Number(req.params.id),key,value); res.json({ok:true,value:v}); }
    catch(e){ res.status(400).json({ok:false,error:e.message}); }
  });
  app.get("/api/automation/log/:id", requireLogin, (req, res) => {
    try {
      const access = ensureUserModuleAccess(req, res, Number(req.params.id), ({ ui }) => !!ui.user_view);
      if (!access) return;
      const log = engine.getLog(Number(req.params.id), 100);
      res.json({ ok:true, log });
    } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
  });

  // POST /api/automation/instances/:id/command
  // Runs a module command (e.g. custom.reset_alarm / custom.reset_lock)
  const _getInstanceForCommand = dbApi.db.prepare(`SELECT * FROM module_instances WHERE id = ? AND active = 1`);
  app.post("/api/automation/instances/:id/command", requireEngineerAccess, (req, res) => {
    try {
      const instId = Number(req.params.id);
      const inst = _getInstanceForCommand.get(instId);
      if (!inst) return res.status(404).json({ ok:false, error:"instance_not_found" });

      const { command, args } = req.body || {};
      if (!command) return res.status(400).json({ ok:false, error:"missing_command" });

      // Safety: unlocking a LOCK requires engineer role + license
      if (String(command) === "reset_lock") {
        if (!hasFeature("engineer_tools")) return res.status(403).json({ ok:false, error:"engineer_not_licensed" });
        if (auth.getRole(req) !== "ENGINEER") return res.status(401).json({ ok:false, error:"engineer_required" });
      }

      const def = getModule(inst.module_id);
      const fn = def?.commands?.[command];
      if (!fn) return res.status(404).json({ ok:false, error:"command_not_supported" });

      const ctx = engine.makeCtx(inst);
      const result = fn(ctx, args || {});
      res.json({ ok:true, result });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  app.post("/api/automation/override/:id", requireEngineerAccess, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = getInstanceWithDefinition(id);
      if (!access.inst) return res.status(404).json({ ok: false, error: "instance_not_found" });
      const paused = !!req.body?.paused;
      engine.setOverride(id, paused);
      res.json({ ok: true, paused });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── IO Overrides (test/debug mode) ──────────────────────────────────────────
  // GET /api/io/:io_id/history?hours=24  → time-series for any IO
  app.get("/api/io/:io_id/history", requireLogin, (req, res) => {
    try {
      const io_id = Number(req.params.io_id);
      const hours = Math.min(Number(req.query.hours) || 24, 168); // max 7d
      const since = Date.now() - hours * 3600 * 1000;

      const io = dbApi.db.prepare("SELECT * FROM io WHERE id=?").get(io_id);
      if (!io) return res.status(404).json({ ok:false, error:"IO not found" });

      const rows = dbApi.db.prepare(`
        SELECT payload as value, ts FROM events
        WHERE device_id=? AND topic LIKE ?
          AND ts >= ?
        ORDER BY ts ASC
        LIMIT 2000
      `).all(io.device_id, `%/${io.key}`, since);

      // For numeric sensors: parse floats. For relay/DI: map ON/OFF → 1/0
      const isNumeric = ["sensor","analog","ai"].includes(io.type);
      const points = rows.map(r => {
        let v;
        if (isNumeric) {
          v = parseFloat(r.value);
          if (isNaN(v)) return null;
        } else {
          const s = String(r.value).toUpperCase().trim();
          v = (s === "ON" || s === "1" || s === "TRUE") ? 1 : 0;
        }
        return { ts: r.ts, v };
      }).filter(Boolean);

      res.json({ ok:true, io: { id:io_id, key:io.key, name:io.name||io.key, type:io.type, unit:io.unit||"" }, points });
    } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
  });

  // GET /api/history/site/:site_id?hours=24  → all IOs for a site (for chart picker)
  app.get("/api/history/site/:site_id", requireLogin, (req, res) => {
    try {
      const site_id = Number(req.params.site_id);
      const ios = dbApi.db.prepare(`
        SELECT io.id, io.key, io.name, io.type, io.unit, io.device_id, io.group_name
        FROM io
        JOIN device_site ds ON ds.device_id = io.device_id
        WHERE ds.site_id = ?
          AND io.enabled = 1
        ORDER BY io.type, io.name
      `).all(site_id);
      res.json({ ok:true, ios });
    } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
  });

  // GET  /api/io/overrides           → all active overrides { io_id: {value,active,ts} }
  // PATCH /api/io/:io_id/override    → { value, active } set or clear override
  app.get("/api/io/overrides", requireEngineerAccess, (req, res) => {
    res.json({ ok: true, overrides: engine.getIOOverrides() });
  });
  app.patch("/api/io/:io_id/override", requireEngineerAccess, (req, res) => {
    try {
      const io_id = Number(req.params.io_id);
      const body = req.body || {};
      const override = engine.setIOOverride(io_id, {
        value: body.value ?? "",
        active: !!body.active,
        duration_ms: body.duration_ms,
        duration_minutes: body.duration_minutes,
        duration_s: body.duration_s,
        expires_at: body.expires_at,
        permanent: body.permanent,
        duration: body.duration,
      });
      res.json({ ok: true, io_id, override });
    } catch(e) { res.status(400).json({ ok: false, error: e.message }); }
  });

// ── 4e. Notifications API ─────────────────────────────────────────────────
  app.get("/api/notifications/channels", requireLogin, (req, res) => {
    res.json({ ok: true, channels: notifyApi.listChannels() });
  });
  app.post("/api/notifications/channels", requireEngineerAccess, (req, res) => {
    try {
      const { name, type, config } = req.body;
      if (!name || !type || !config) return res.status(400).json({ ok: false, error: "missing_fields" });
      const id = notifyApi.createChannel(name, type, config);
      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.put("/api/notifications/channels/:id", requireEngineerAccess, (req, res) => {
    try {
      const { name, type, config, enabled } = req.body;
      notifyApi.updateChannel(Number(req.params.id), name, type, config, enabled);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.delete("/api/notifications/channels/:id", requireEngineerAccess, (req, res) => {
    try { notifyApi.deleteChannel(Number(req.params.id)); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.post("/api/notifications/test/:id", requireEngineerAccess, async (req, res) => {
    try {
      const result = await notifyApi.notifyOne(Number(req.params.id), {
        title: "ELARIS Test",
        body: "Channel test successful.",
        level: "info",
        tag: `test_${Date.now()}`
      });
      res.json({ ok: !!result.ok, result });
    } catch (e) {
      const status = e.message === "not_found" ? 404 : 400;
      res.status(status).json({ ok: false, error: e.message });
    }
  });
  app.post("/api/notifications/send", requireEngineerAccess, async (req, res) => {
    try {
      const { title, body, level } = req.body;
      const results = await notifyApi.notify({ title, body, level: level||"info", tag:"manual", cooldown_s:0 });
      const ok = results.length > 0 && results.every(r => r.ok);
      res.json({ ok, results, success_count: results.filter(r => r.ok).length, fail_count: results.filter(r => !r.ok).length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get("/api/notifications/log", requireEngineerAccess, (req, res) => {
    res.json({ ok: true, log: notifyApi.listLog() });
  });

  // ── 4f. Scenes API ────────────────────────────────────────────────────────
  app.get("/api/scenes", requireLogin, (req, res) => {
    res.json({ ok: true, scenes: scenesApi.listScenes() });
  });
  app.post("/api/scenes", requireEngineerAccess, (req, res) => {
    try {
      const { name, icon, color, actions } = req.body;
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
      const id = scenesApi.createScene(name, icon, color, actions);
      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.put("/api/scenes/:id", requireEngineerAccess, (req, res) => {
    try {
      const { name, icon, color, actions } = req.body;
      scenesApi.updateScene(Number(req.params.id), name, icon, color, actions);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.delete("/api/scenes/:id", requireEngineerAccess, (req, res) => {
    try { scenesApi.deleteScene(Number(req.params.id)); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  app.post("/api/scenes/:id/activate", requireLogin, async (req, res) => {
    try {
      const result = await scenesApi.activate(Number(req.params.id), {
        engine, mqttApi, notify: notifyApi.notify, triggeredBy: "dashboard",
      });
      wsApi.broadcast({ type: "scene_activated", scene_id: Number(req.params.id), ts: Date.now() });
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get("/api/scenes/log", requireLogin, (req, res) => {
    res.json({ ok: true, log: scenesApi.listLog() });
  });

  // ── ESPHome installer routes ───────────────────────────────────────────
  initEsphomeRoutes(app, {
    wsApi,
    dataDir: path.join(process.cwd(), "data"),
    db: dbApi.db,
    requireLogin,
    requireEngineerAccess,
  });

  // ── Auto-load modules from src/modules/ ──────────────────────────────────
  const modulesDir = path.join(__dirname, 'modules');
  const moduleFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith('.js') && f !== 'index.js');

  const moduleCtx = {
    db:                    dbApi.db,
    requireLogin,
    requireEngineerAccess,
    requireAdmin,
    mqttApi,
    wsApi,
    users,
    engine,
    auth,
    getModule,
    isEngineerLike,
    getInstanceWithDefinition,
    ensureUserModuleAccess,
  };

  for (const file of moduleFiles) {
    try {
      const mod = require(path.join(modulesDir, file));
      if (mod.MODULE && mod.handler) engine.register(mod.MODULE.id, mod.handler);
      if (typeof mod.routes === 'function') mod.routes(app, moduleCtx);
      console.log(`[modules] Loaded: ${file}`);
    } catch (e) {
      console.error(`[modules] Failed to load ${file}:`, e.message);
    }
  }

  // ── 5. HTML guard ─────────────────────────────────────────────────────
  const PUBLIC_PAGES = new Set(["/login.html", "/favicon.ico"]);

  app.use((req, res, next) => {
    const url = req.path;
    if (!url.endsWith(".html")) return next();   // only .html pages
    if (PUBLIC_PAGES.has(url)) return next();    // login is always accessible

    const h    = req.headers.cookie || "";
    const m    = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
    const tok  = m ? decodeURIComponent(m[1]) : null;
    const sess = tok ? users.verifySession(tok) : null;
    if (!sess) return res.redirect("/login.html");
    next();
  });

  // ── 6. Static files ───────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, "../public")));

    // ── Server start ───────────────────────────────────────────────────────
  server.listen(PORT, () => {
    console.log(`[ELARIS] Listening on :${PORT}  (${NODE_ENV})`);
    console.log(`[ELARIS] MQTT: ${MQTT_URL}`);
    console.log(`[ELARIS] APP_URL: ${APP_URL}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
