// src/modules/water_manager.js
// Water Manager module — MODULE definition + engine handler + API routes

const { waterManagerHandler, WATER_MANAGER_MODULE } = require('../automation/water_manager');

const MODULE = WATER_MANAGER_MODULE;

const handler = waterManagerHandler;

function routes(app, ctx) {
  // No module-specific routes — engine registration only.
}

module.exports = { MODULE, handler, routes };
