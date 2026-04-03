'use strict';

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

const http = require('http');
const { loadLicense, hasFeature, getLicense } = require('./license');
const { createHttpApp, mountHtmlGuardAndStatic } = require('./bootstrap/app');
const { initCoreServices, initIntegrationServices } = require('./bootstrap/services');
const { initAuthContext } = require('./bootstrap/auth');
const { initRealtimeRuntime, startMaintenanceJobs } = require('./bootstrap/runtime');
const { mountAllRoutes } = require('./bootstrap/routes');

const PORT = process.env.PORT || 8080;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

function randomHex(bytes = 32) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

function randomCode(digits = 6) {
  let out = '';
  for (let i = 0; i < digits; i++) out += require('crypto').randomInt(0, 10);
  return out;
}

const ENGINEER_CODE = process.env.ENGINEER_CODE || randomCode();
const ENGINEER_SECRET = process.env.ENGINEER_SECRET || randomHex();
const APP_SECRET = process.env.APP_SECRET || randomHex();

if (!process.env.ENGINEER_CODE || !process.env.ENGINEER_SECRET || !process.env.APP_SECRET) {
  const missing = [];
  if (!process.env.ENGINEER_CODE) missing.push('ENGINEER_CODE');
  if (!process.env.ENGINEER_SECRET) missing.push('ENGINEER_SECRET');
  if (!process.env.APP_SECRET) missing.push('APP_SECRET');
  console.warn(`[ELARIS] WARNING: Auto-generated random secrets for: ${missing.join(', ')}`);
  console.warn(`[ELARIS] Set these in .env for persistent sessions.`);
  if (IS_PROD) {
    console.error(`[ELARIS] FATAL: Secrets must be set via env vars in production.`);
    process.exit(1);
  }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

async function main() {
  const ok = loadLicense();
  const lic = getLicense();
  console.log('[LICENSE] loaded:', ok, '| type:', lic?.type || 'NONE');
  console.log('[LICENSE] engineer_tools:', hasFeature('engineer_tools'));

  const app = createHttpApp({ isProd: IS_PROD });
  const server = http.createServer(app);

  const services = initCoreServices();
  const { dbApi, db, users, notifyApi, scenesApi, historyRollups } = services;

  const authCtx = initAuthContext({
    db,
    users,
    hasFeature,
    appSecret: APP_SECRET,
    engineerCode: ENGINEER_CODE,
    engineerSecret: ENGINEER_SECRET,
    appUrl: APP_URL,
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    githubClientId: GITHUB_CLIENT_ID,
    githubClientSecret: GITHUB_CLIENT_SECRET,
  });

  const maint = startMaintenanceJobs({ db, users, historyRollups });

  const runtime = initRealtimeRuntime({
    server,
    dbApi,
    db,
    access: authCtx.access,
    users,
    auth: authCtx.auth,
    scenesApi,
    notifyApi,
    mqttUrl: MQTT_URL,
  });

  const integrations = initIntegrationServices({ db, broadcast: runtime.wsApi.broadcast });
  runtime.engine.setNativeSessionManager(integrations.nativeSessions, integrations.integrationRegistry.get('esphome'));

  mountAllRoutes(app, {
    dbApi,
    db,
    users,
    hasFeature,
    auth: authCtx.auth,
    access: authCtx.access,
    google: authCtx.google,
    github: authCtx.github,
    csrf: authCtx.csrf,
    requireLogin: authCtx.requireLogin,
    requireAdmin: authCtx.requireAdmin,
    requireEngineerAccess: authCtx.requireEngineerAccess,
    historyRollups,
    mqttApi: runtime.mqttApi,
    engine: runtime.engine,
    wsApi: runtime.wsApi,
    notifyApi,
    scenesApi,
    integrationRegistry: integrations.integrationRegistry,
    nativeSessions: integrations.nativeSessions,
  });

  mountHtmlGuardAndStatic(app, {
    users,
    publicDir: path.join(__dirname, '../public'),
  });

  server.listen(PORT, () => {
    console.log(`[ELARIS] Listening on :${PORT}  (${NODE_ENV})`);
    console.log(`[ELARIS] MQTT: ${MQTT_URL}`);
    console.log(`[ELARIS] APP_URL: ${APP_URL}`);
  });

  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ELARIS] ${signal} received, shutting down...`);
    server.close(() => {
      runtime.shutdown();
      maint.stopAll();
      db.close();
      console.log('[ELARIS] Shutdown complete.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[ELARIS] Forced shutdown after timeout.');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});