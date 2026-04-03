'use strict';

const fs = require('fs');
const path = require('path');

const { initAuthRoutes } = require('../auth_routes');
const { buildMePayload } = require('../session_info');
const { initRoutes } = require('../routes');
const { initAdminRoutes } = require('../api/admin_routes');
const { initAutomationRoutes } = require('../api/automation_routes');
const { initScenesRoutes } = require('../api/scenes_routes');
const { initNotificationsRoutes } = require('../api/notifications_routes');
const { initIoRoutes, initHistoryRoutes } = require('../api/io_routes');
const { initDevicesRoutes } = require('../api/devices_routes');
const { initSitesRoutes } = require('../api/sites_routes');
const { initZonesRoutes } = require('../api/zones_routes');
const { initEntitiesRoutes } = require('../api/entities_routes');
const { initConfigRoutes } = require('../api/config_routes');
const { mountMiscRoutes } = require('../api/misc_routes');
const { makeModuleHelpers } = require('../api/middleware');
const { initModuleRoutes } = require('../module_routes');
const { initNavRoutes } = require('../nav_routes');
const { getModule } = require('../modules/index');

function mountAllRoutes(app, ctx) {
  const {
    dbApi, db, users, hasFeature,
    auth, access, google, github, csrf,
    requireLogin, requireAdmin, requireEngineerAccess,
    historyRollups, mqttApi, engine, wsApi, notifyApi, scenesApi,
    integrationRegistry, nativeSessions,
  } = ctx;

  const moduleHelpers = makeModuleHelpers({ engine, access, auth });

  app.use(csrf.attach);
  app.use((req, res, next) => {
    const p = req.path || '';
    const safeAuth = ['/auth/login','/auth/register','/auth/google','/auth/github','/auth/google/callback','/auth/github/callback','/auth/setup-needed'].includes(p);
    if ((p.startsWith('/api/') || p.startsWith('/auth/')) && !safeAuth) return csrf.requireToken(req, res, next);
    next();
  });

  app.use('/auth', initAuthRoutes({ users, google, github, appSecret: process.env.APP_SECRET || process.env.ENGINEER_SECRET }));

  app.get('/api/me', (req, res) => {
    csrf.ensureForRequest(req, res);
    res.json(buildMePayload({ req, users, auth, hasFeature, csrfToken: req.csrfToken || null }));
  });

  app.use('/api/admin', initAdminRoutes({ db, users, requireAdmin, historyRollups, mqttApi }));
  app.use('/api/modules', initModuleRoutes({ db, requireLogin, requireEngineer: requireEngineerAccess, access, engine }));
  app.use('/api/nav', initNavRoutes({ db, requireLogin, access }));

  const apiCtx = {
    dbApi, db, access, auth, hasFeature, engine, mqttApi, wsApi, notifyApi, scenesApi,
    users, requireLogin, requireEngineerAccess, requireAdmin,
    integrationRegistry, nativeSessions,
    ...moduleHelpers,
  };

  app.use('/api/automation', initAutomationRoutes(apiCtx));
  app.use('/api/scenes', initScenesRoutes(apiCtx));
  app.use('/api/notifications', initNotificationsRoutes(apiCtx));
  app.use('/api/io', requireLogin, initIoRoutes(apiCtx));
  app.use('/api/history', requireLogin, initHistoryRoutes(apiCtx));
  app.use('/api/devices', requireLogin, initDevicesRoutes(apiCtx));
  app.use('/api/sites', initSitesRoutes(apiCtx));
  app.use('/api/zones', requireLogin, initZonesRoutes(apiCtx));
  app.use('/api', requireLogin, initEntitiesRoutes(apiCtx));
  app.use('/api/config', initConfigRoutes(apiCtx));
  mountMiscRoutes(app, apiCtx);

  app.use('/api', initRoutes({ auth, hasFeature, requireLogin, users }));

  integrationRegistry.mountAll(app, {
    wsApi,
    dataDir: path.join(process.cwd(), 'data'),
    db,
    dbApi,
    mqttApi,
    nativeSessions,
    requireLogin,
    requireEngineerAccess,
    access,
  });

  const modulesDir = path.join(__dirname, '../modules');
  const moduleCtx = {
    db,
    access,
    requireLogin,
    requireEngineerAccess,
    requireAdmin,
    mqttApi,
    wsApi,
    users,
    engine,
    auth,
    getModule,
    ...moduleHelpers,
  };

  for (const file of fs.readdirSync(modulesDir).filter(f => f.endsWith('.js') && f !== 'index.js')) {
    try {
      const mod = require(path.join(modulesDir, file));
      if (mod.MODULE && mod.handler) engine.register(mod.MODULE.id, mod.handler);
      if (typeof mod.routes === 'function') mod.routes(app, moduleCtx);
      console.log(`[modules] Loaded: ${file}`);
    } catch (e) {
      console.error(`[modules] Failed to load ${file}:`, e.message);
    }
  }
}

module.exports = {
  mountAllRoutes,
};