// src/modules/maintenance.js
// Maintenance Tracker module — MODULE definition + engine handler + API routes

const { maintenanceHandler, MAINTENANCE_MODULE } = require('../automation/maintenance');

const MODULE = MAINTENANCE_MODULE;

const handler = maintenanceHandler;

function routes(app, ctx) {
  // No module-specific routes — engine registration only.
}

module.exports = { MODULE, handler, routes };
