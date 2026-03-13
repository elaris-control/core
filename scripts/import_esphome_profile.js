#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/db');
const { upsertProfileFromFile } = require('../src/esphome/profile_registry');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import_esphome_profile.js path/to/profile.json');
  process.exit(1);
}
const full = path.resolve(file);
if (!fs.existsSync(full)) {
  console.error(`File not found: ${full}`);
  process.exit(1);
}
const dbApi = initDB();
const entry = upsertProfileFromFile(dbApi.db, full);
console.log(`[ESPHOME] imported profile: ${entry.id} (${entry.label})`);
process.exit(0);
