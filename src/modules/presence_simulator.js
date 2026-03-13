// src/modules/presence_simulator.js
// Presence Simulator module — MODULE definition + engine handler + API routes

const { presenceSimulatorHandler, PRESENCE_SIMULATOR_MODULE } = require('../automation/presence_simulator');

const MODULE = PRESENCE_SIMULATOR_MODULE;

const handler = presenceSimulatorHandler;

function routes(app, ctx) {
  // No module-specific routes — engine registration only.
}

module.exports = { MODULE, handler, routes };
