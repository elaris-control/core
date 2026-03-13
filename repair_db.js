#!/usr/bin/env node
// repair_db.js — Fix corrupted SQLite database
// Run: node repair_db.js

const path     = require("path");
const fs       = require("fs");
const { execSync } = require("child_process");

const DB_PATH  = process.env.ELARIS_DB_PATH || process.env.DB_PATH || path.join(__dirname, "data", "elaris.db");
const BAK_PATH = DB_PATH + ".bak_" + Date.now();

console.log("=== ELARIS DB Repair Tool ===\n");
console.log("DB path:", DB_PATH);

if (!fs.existsSync(DB_PATH)) {
  console.log("❌ DB file not found:", DB_PATH);
  process.exit(1);
}

// Step 1: Backup
fs.copyFileSync(DB_PATH, BAK_PATH);
console.log("✓ Backup created:", BAK_PATH);

// Step 2: Try sqlite3 CLI repair (dump + reimport)
const DUMP_PATH  = DB_PATH + ".dump.sql";
const NEW_PATH   = DB_PATH + ".repaired";

try {
  console.log("\n→ Attempting repair via sqlite3 CLI...");
  
  // Check if sqlite3 is available
  try { execSync("which sqlite3", { stdio:"pipe" }); }
  catch { 
    console.log("⚠️  sqlite3 CLI not found. Installing...");
    execSync("sudo apt-get install -y sqlite3", { stdio:"inherit" });
  }

  // Dump whatever is recoverable
  try {
    execSync(`sqlite3 "${DB_PATH}" ".recover" > "${DUMP_PATH}" 2>/dev/null || sqlite3 "${DB_PATH}" ".dump" > "${DUMP_PATH}" 2>/dev/null`, 
      { stdio:"pipe", shell:true });
    console.log("✓ Dump created:", DUMP_PATH);
  } catch(e) {
    console.log("⚠️  .recover failed, trying .dump...");
    execSync(`sqlite3 "${DB_PATH}" ".dump" > "${DUMP_PATH}" 2>/dev/null`, 
      { stdio:"pipe", shell:true });
  }

  const dumpSize = fs.statSync(DUMP_PATH).size;
  console.log(`✓ Dump size: ${Math.round(dumpSize/1024)} KB`);

  if (dumpSize < 100) {
    throw new Error("Dump too small — DB may be unrecoverable");
  }

  // Import dump into new DB
  if (fs.existsSync(NEW_PATH)) fs.unlinkSync(NEW_PATH);
  execSync(`sqlite3 "${NEW_PATH}" < "${DUMP_PATH}"`, { stdio:"pipe", shell:true });
  console.log("✓ New DB created:", NEW_PATH);

  // Verify new DB
  const Database = require("better-sqlite3");
  const testDb = new Database(NEW_PATH, { readonly: true });
  const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  testDb.close();
  console.log("✓ Tables in repaired DB:", tables.map(t=>t.name).join(", "));

  // Replace original with repaired
  fs.copyFileSync(NEW_PATH, DB_PATH);
  fs.unlinkSync(NEW_PATH);
  fs.unlinkSync(DUMP_PATH);
  console.log("\n✅ Database repaired successfully!");
  console.log("   Original backed up to:", BAK_PATH);
  console.log("\n→ Run: node src/index.js");

} catch(e) {
  console.log("\n❌ Repair failed:", e.message);
  console.log("\n→ Trying fresh start (data will be lost)...");
  
  const answer = process.argv[2];
  if (answer === "--fresh") {
    fs.unlinkSync(DB_PATH);
    console.log("✓ Old DB removed. Starting fresh on next boot.");
    console.log("  Your backup is at:", BAK_PATH);
    console.log("\n→ Run: node src/index.js");
  } else {
    console.log("\nTo start fresh (⚠️  loses all data): node repair_db.js --fresh");
    console.log("Your backup is at:", BAK_PATH);
  }
}
