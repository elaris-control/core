// src/core/db/index.js
// Orchestrator — re-exports the existing db.js for now.
// The db.js monolith will be split incrementally.
// New code should require this file, not the root db.js.

const { initDB } = require('../../db');

module.exports = { initDB };
