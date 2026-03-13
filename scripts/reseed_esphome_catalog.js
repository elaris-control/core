#!/usr/bin/env node
const { initDB } = require('../src/db');
const { seedProfileCatalog } = require('../src/esphome/profile_registry');

const dbApi = initDB();
const seeded = seedProfileCatalog(dbApi.db);
console.log(`[ESPHOME] catalog reseeded: ${seeded.length} profiles`);
process.exit(0);
