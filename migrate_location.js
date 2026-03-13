// migrate_location.js — run once on Pi to add lat/lon columns
// Usage: node migrate_location.js
const path   = require("path");
const Database = require("better-sqlite3");

// Find the DB path same way as the app
const DB_PATH = process.env.ELARIS_DB_PATH || process.env.DB_PATH || path.join(__dirname, "data", "elaris.db");

console.log("Opening DB:", DB_PATH);
const db = new Database(DB_PATH);

const cols = ["lat", "lon", "timezone", "address"];
let added = 0;

for (const col of cols) {
  try {
    db.exec(`ALTER TABLE sites ADD COLUMN ${col} TEXT`);
    console.log(`✓ Added column: ${col}`);
    added++;
  } catch(e) {
    if (e.message.includes("duplicate column")) {
      console.log(`  Already exists: ${col}`);
    } else {
      console.error(`✗ Error on ${col}:`, e.message);
    }
  }
}

console.log(`\nDone — ${added} column(s) added. Restart ELARIS now.`);
db.close();
