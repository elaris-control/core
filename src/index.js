'use strict';

const http = require('http');
const path = require('path');

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
const ENGINEER_CODE = process.env.ENGINEER_CODE;
const ENGINEER_SECRET = process.env.ENGINEER_SECRET;
const APP_SECRET = process.env.APP_SECRET;

if (IS_PROD) {
  const missing = Object.entries({ ENGINEER_CODE, ENGINEER_SECRET, APP_SECRET })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`[ELARIS] FATAL: Missing required env vars in production: ${missing.join(', ')}`);
    console.error('[ELARIS] Copy .env.example to .env and fill in all required values.');
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

  startMaintenanceJobs({ db, users, historyRollups });

  const runtime = initRealtimeRuntime({
    server,
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
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});