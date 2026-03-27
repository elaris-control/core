'use strict';
// src/esphome_routes.js — ESPHome installer entry point

const path = require('path');
const fs = require('fs');
const { ensureEsphomeTables } = require('./esphome/helpers');
const { mountCatalogRoutes } = require('./api/esphome/catalog_routes');
const { mountFlashRoutes } = require('./api/esphome/flash_routes');
const { mountDeviceRoutes } = require('./api/esphome/device_routes');
const { mountPeripheralRoutes } = require('./api/esphome/peripheral_routes');
const { mountBrowserRoutes } = require('./api/esphome/browser_routes');

function initEsphomeRoutes(app, { wsApi, dataDir, db, dbApi, mqttApi, nativeSessions, requireLogin, requireEngineerAccess, access }) {
  const cfgDir = path.join(dataDir, 'esphome');
  const venvDir = path.join(dataDir, 'esphome_venv');
  fs.mkdirSync(cfgDir, { recursive: true });
  ensureEsphomeTables(db);

  const state = { activeFlash: null, activeSetup: null };
  const stmts = db ? {
    getDeviceById: db.prepare('SELECT * FROM esphome_devices WHERE id=?'),
    getDevicesByName: db.prepare('SELECT * FROM esphome_devices WHERE lower(name)=lower(?) ORDER BY id DESC'),
  } : {};

  const ctx = { app, db, dbApi, wsApi, dataDir, cfgDir, venvDir, mqttApi, nativeSessions, requireLogin, requireEngineerAccess, access, state, stmts };

  mountCatalogRoutes(ctx);
  mountFlashRoutes(ctx);
  mountDeviceRoutes(ctx);
  mountPeripheralRoutes(ctx);
  mountBrowserRoutes(ctx);
}

module.exports = { initEsphomeRoutes };
