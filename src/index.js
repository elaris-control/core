'use strict';
// src/index.js — bootstrap: wire services, mount routes, start server

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');

const { getDBPath, ensureDirForFile, migrateLegacyDBIfNeeded } = require('./paths');
const { initDB }            = require('./db');
const { initWS }            = require('./ws');
const { initMQTT }          = require('./mqtt');
const { initUsers }         = require('./users');
const { initAuthRoutes, makeRequireLogin } = require('./auth_routes');
const { securityHeaders, makeCsrfTools }  = require('./security');
const { buildMePayload }    = require('./session_info');
const { makeGoogleOAuth, makeGithubOAuth } = require('./oauth');
const { loadLicense, hasFeature, getLicense } = require('./license');
const { makeAuth }          = require('./auth');
const { initAccess }        = require('./access');
const { initNotifications } = require('./notifications');
const { initScenes }        = require('./scenes');
const { AutomationEngine }  = require('./automation/engine');
const { initEsphomeRoutes } = require('./esphome_routes');
const { getModule }         = require('./modules/index');

// ── Domain route files ────────────────────────────────────────────────────
const { initRoutes }              = require('./routes');
const { initAdminRoutes }         = require('./api/admin_routes');
const { initAutomationRoutes }    = require('./api/automation_routes');
const { initScenesRoutes }        = require('./api/scenes_routes');
const { initNotificationsRoutes } = require('./api/notifications_routes');
const { initIoRoutes, initHistoryRoutes } = require('./api/io_routes');
const { initDevicesRoutes }       = require('./api/devices_routes');
const { initSitesRoutes }         = require('./api/sites_routes');
const { initZonesRoutes }         = require('./api/zones_routes');
const { initEntitiesRoutes }      = require('./api/entities_routes');
const { initConfigRoutes }        = require('./api/config_routes');
const { mountMiscRoutes }         = require('./api/misc_routes');
const { makeModuleHelpers }       = require('./api/middleware');
const { initModuleRoutes }        = require('./module_routes');
const { initNavRoutes }           = require('./nav_routes');

// ── ENV ───────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT      || 8080;
const MQTT_URL       = process.env.MQTT_URL  || 'mqtt://localhost:1883';
const NODE_ENV       = process.env.NODE_ENV  || 'development';
const IS_PROD        = NODE_ENV === 'production';
const ENGINEER_CODE  = process.env.ENGINEER_CODE;
const ENGINEER_SECRET = process.env.ENGINEER_SECRET;

if (IS_PROD) {
  const missing = Object.entries({ ENGINEER_CODE, ENGINEER_SECRET }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`[ELARIS] FATAL: Missing required env vars in production: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL              = process.env.APP_URL || `http://localhost:${PORT}`;

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const ok  = loadLicense();
  const lic = getLicense();
  console.log('[LICENSE] loaded:', ok, '| type:', lic?.type || 'NONE');
  console.log('[LICENSE] engineer_tools:', hasFeature('engineer_tools'));

  const app    = express();
  const server = http.createServer(app);
  app.disable('x-powered-by');
  app.use(securityHeaders({ isProd: IS_PROD }));

  if (!IS_PROD) {
    app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next(); });
    app.use((_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    app.use(cors());
  } else if (process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()), credentials: true }));
  }

  app.use(express.json({ limit: '256kb' }));
  app.use(morgan('dev'));

  // ── Core services ─────────────────────────────────────────────────────
  const DB_PATH = getDBPath();
  migrateLegacyDBIfNeeded(DB_PATH);
  ensureDirForFile(DB_PATH);
  const dbApi = initDB(DB_PATH);

  const users     = initUsers(dbApi.db);
  const notifyApi = initNotifications(dbApi.db);
  const scenesApi = initScenes(dbApi.db);

  // ── Auth ──────────────────────────────────────────────────────────────
  const auth = makeAuth({
    hasFeature,
    engineerCode:   ENGINEER_CODE   || '1234',
    engineerSecret: ENGINEER_SECRET || 'dev-secret-change-me',
  });
  const access = initAccess({ db: dbApi.db, auth });

  // ── WebSocket (needs auth for role resolution) ────────────────────────
  const wsApi = initWS(server, { db: dbApi.db, access, getRole: (req) => {
    const h   = req.headers?.cookie || '';
    const m   = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
    const tok = m ? decodeURIComponent(m[1]) : null;
    const sess = tok ? users.verifySession(tok) : null;
    if (sess?.role === 'ADMIN')    return 'ADMIN';
    if (sess?.role === 'ENGINEER') return 'ENGINEER';
    if (auth.getRole(req) === 'ENGINEER') return 'ENGINEER';
    return sess ? 'USER' : null;
  }});

  // ── Live log broadcast (patch stdout/stderr → WS) ─────────────────────
  const _origOut = process.stdout.write.bind(process.stdout);
  const _origErr = process.stderr.write.bind(process.stderr);
  function _emitLog(level, text) {
    for (const line of text.replace(/\n$/, '').split('\n')) {
      if (line.trim()) wsApi.broadcastLog({ level, text: line, ts: Date.now() });
    }
  }
  process.stdout.write = (chunk, ...rest) => { _origOut(chunk, ...rest); _emitLog('info', typeof chunk === 'string' ? chunk : chunk.toString('utf8')); return true; };
  process.stderr.write = (chunk, ...rest) => { _origErr(chunk, ...rest); _emitLog('warn', typeof chunk === 'string' ? chunk : chunk.toString('utf8')); return true; };

  // ── Events cleanup (30 days, every 24h) ───────────────────────────────
  function cleanupEvents() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    try { const r = dbApi.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff); if (r.changes > 0) console.log(`[CLEANUP] Deleted ${r.changes} old events`); } catch (e) { console.error('[CLEANUP]', e.message); }
    try { users.purgeExpiredSessions(); } catch {}
  }
  cleanupEvents();
  setInterval(cleanupEvents, 24 * 60 * 60 * 1000);

  // ── Automation engine ─────────────────────────────────────────────────
  const engine = new AutomationEngine({ db: dbApi.db, broadcast: wsApi.broadcast });
  engine.notify    = opts => notifyApi.notify(opts).catch(e => console.error('[NOTIFY]', e.message));
  engine.broadcast = wsApi.broadcast;
  engine.scenesApi = scenesApi;
  engine.startTick(30000);

  // ── MQTT ──────────────────────────────────────────────────────────────
  const mqttApi = initMQTT({ url: MQTT_URL, dbApi, broadcast: wsApi.broadcast, solarAuto: engine });
  engine.setMqttApi(mqttApi);
  setTimeout(() => engine.evaluateAll(), 2000);
  setInterval(() => scenesApi.tickSchedules({ engine, mqttApi, notify: notifyApi.notify }), 30_000);

  // ── OAuth ─────────────────────────────────────────────────────────────
  const google = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
    ? makeGoogleOAuth({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: `${APP_URL}/auth/google/callback` })
    : null;
  const github = (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)
    ? makeGithubOAuth({ clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, redirectUri: `${APP_URL}/auth/github/callback` })
    : null;
  if (google) console.log('[AUTH] Google OAuth: enabled');
  if (github) console.log('[AUTH] GitHub OAuth: enabled');
  if (!google && !github) console.log('[AUTH] OAuth: disabled');

  // ── Middleware factories ───────────────────────────────────────────────
  const requireLogin = makeRequireLogin(users);

  function requireAdmin(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireAdmin(req, res, next));
    if (req.user.role !== 'ADMIN') return res.status(403).json({ ok: false, error: 'admin_only' });
    next();
  }

  function requireEngineerAccess(req, res, next) {
    if (!req.user) return requireLogin(req, res, () => requireEngineerAccess(req, res, next));
    const unlocked  = auth.getRole(req) === 'ENGINEER';
    const userRole  = req.user?.role || 'USER';
    if (userRole === 'ADMIN' || userRole === 'ENGINEER' || unlocked) return next();
    return res.status(403).json({ ok: false, error: 'engineer_required' });
  }

  const csrf = makeCsrfTools({
    users,
    secret: process.env.APP_SECRET || ENGINEER_SECRET || 'elaris-csrf',
    secure: process.env.COOKIE_SECURE === '1' || IS_PROD,
  });

  // Module-level helpers (isEngineerLike, getInstanceWithDefinition, ensureUserModuleAccess)
  const moduleHelpers = makeModuleHelpers({ engine, access, auth });

  // ── CSRF ──────────────────────────────────────────────────────────────
  app.use(csrf.attach);
  app.use((req, res, next) => {
    const p = req.path || '';
    const safeAuth = ['/auth/login','/auth/register','/auth/google','/auth/github','/auth/google/callback','/auth/github/callback','/auth/setup-needed'].includes(p);
    if ((p.startsWith('/api/') || p.startsWith('/auth/')) && !safeAuth) return csrf.requireToken(req, res, next);
    next();
  });

  // ══════════════════════════════════════════════════════════════════════
  //  ROUTE ORDER (critical):
  //  1. /auth/*         — login/register/OAuth
  //  2. /api/me         — session check (special CSRF handling)
  //  3. /api/admin/*    — user & DB management
  //  4. /api/modules/*  — BEFORE generic /api to avoid prefix conflict
  //  5. /api/nav/*
  //  6. /api/*          — domain routes
  //  7. HTML guard      — redirect .html if no session
  //  8. static files
  // ══════════════════════════════════════════════════════════════════════

  // 1. Auth
  app.use('/auth', initAuthRoutes({ users, google, github, appSecret: process.env.APP_SECRET || ENGINEER_SECRET || 'elaris-csrf' }));

  // 2. /api/me (CSRF injection)
  app.get('/api/me', (req, res) => {
    csrf.ensureForRequest(req, res);
    res.json(buildMePayload({ req, users, auth, hasFeature, csrfToken: req.csrfToken || null }));
  });

  // 3. Admin
  app.use('/api/admin', initAdminRoutes({ db: dbApi.db, users, requireAdmin }));

  // 4. Modules (BEFORE /api to avoid prefix collision)
  app.use('/api/modules', initModuleRoutes({ db: dbApi.db, requireLogin, requireEngineer: requireEngineerAccess, access }));

  // 5. Nav
  app.use('/api/nav', initNavRoutes({ db: dbApi.db, requireLogin, access }));

  // 6. Domain API routes — all require login (applied per-router or per-route)
  const apiCtx = { dbApi, db: dbApi.db, access, auth, hasFeature, engine, mqttApi, wsApi, notifyApi, scenesApi, users, requireLogin, requireEngineerAccess, requireAdmin, ...moduleHelpers };

  app.use('/api/automation',    initAutomationRoutes(apiCtx));
  app.use('/api/scenes',        initScenesRoutes(apiCtx));
  app.use('/api/notifications', initNotificationsRoutes(apiCtx));
  app.use('/api/io',            requireLogin, initIoRoutes(apiCtx));
  app.use('/api/history',       requireLogin, initHistoryRoutes(apiCtx));
  app.use('/api/devices',       requireLogin, initDevicesRoutes(apiCtx));
  app.use('/api/sites',         initSitesRoutes(apiCtx));
  app.use('/api/zones',         requireLogin, initZonesRoutes(apiCtx));
  app.use('/api',               requireLogin, initEntitiesRoutes(apiCtx));
  app.use('/api/config',        initConfigRoutes(apiCtx));
  mountMiscRoutes(app, apiCtx);

  // Core (health, me alias, engineer unlock)
  app.use('/api', initRoutes({ auth, hasFeature, requireLogin, users }));

  // ESPHome
  initEsphomeRoutes(app, { wsApi, dataDir: path.join(process.cwd(), 'data'), db: dbApi.db, requireLogin, requireEngineerAccess });

  // Auto-load module route handlers from src/modules/
  const modulesDir = path.join(__dirname, 'modules');
  const moduleCtx  = { db: dbApi.db, access, requireLogin, requireEngineerAccess, requireAdmin, mqttApi, wsApi, users, engine, auth, getModule, ...moduleHelpers };
  for (const file of fs.readdirSync(modulesDir).filter(f => f.endsWith('.js') && f !== 'index.js')) {
    try {
      const mod = require(path.join(modulesDir, file));
      if (mod.MODULE && mod.handler) engine.register(mod.MODULE.id, mod.handler);
      if (typeof mod.routes === 'function') mod.routes(app, moduleCtx);
      console.log(`[modules] Loaded: ${file}`);
    } catch (e) { console.error(`[modules] Failed to load ${file}:`, e.message); }
  }

  // 7. HTML guard
  const PUBLIC_PAGES = new Set(['/login.html', '/favicon.ico']);
  app.use((req, res, next) => {
    if (!req.path.endsWith('.html')) return next();
    if (PUBLIC_PAGES.has(req.path))  return next();
    const h    = req.headers.cookie || '';
    const m    = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
    const tok  = m ? decodeURIComponent(m[1]) : null;
    if (!tok || !users.verifySession(tok)) return res.redirect('/login.html');
    next();
  });

  // 8. Static files
  app.use(express.static(path.join(__dirname, '../public')));

  server.listen(PORT, () => {
    console.log(`[ELARIS] Listening on :${PORT}  (${NODE_ENV})`);
    console.log(`[ELARIS] MQTT: ${MQTT_URL}`);
    console.log(`[ELARIS] APP_URL: ${APP_URL}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
