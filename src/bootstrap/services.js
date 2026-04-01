'use strict';

const { getDBPath, ensureDirForFile, migrateLegacyDBIfNeeded } = require('../paths');
const { initDB } = require('../db');
const { initUsers } = require('../users');
const { initNotifications } = require('../notifications');
const { initScenes } = require('../scenes');
const { createHistoryRollupService } = require('../history_rollups');
const { createIntegrationRegistry } = require('../integrations/registry');
const { createNativeSessionManager } = require('../integrations/native/session_manager');
const { createEspHomeAdapter } = require('../integrations/esphome');

function initCoreServices() {
  const DB_PATH = getDBPath();
  migrateLegacyDBIfNeeded(DB_PATH);
  ensureDirForFile(DB_PATH);

  const dbApi = initDB(DB_PATH);
  const db = dbApi.db;
  const users = initUsers(db);
  const notifyApi = initNotifications(db);
  const scenesApi = initScenes(db);
  const historyRollups = createHistoryRollupService(db);

  return {
    DB_PATH,
    dbApi,
    db,
    users,
    notifyApi,
    scenesApi,
    historyRollups,
  };
}

function initIntegrationServices({ db, broadcast }) {
  const integrationRegistry = createIntegrationRegistry();
  integrationRegistry.register(createEspHomeAdapter());
  const nativeSessions = createNativeSessionManager({ db, broadcast });
  return { integrationRegistry, nativeSessions };
}

module.exports = {
  initCoreServices,
  initIntegrationServices,
};