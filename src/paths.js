// src/paths.js
// Centralized path/config helpers (keeps DB out of repo)

const path = require("path");
const fs   = require("fs");

function getDBPath() {
  // Prefer new name, keep DB_PATH for backward compatibility
  const env = (process.env.ELARIS_DB_PATH || process.env.DB_PATH || "").trim();
  if (env) return env;

  // Default: keep DB under <project-root>/data
  // Use __dirname (always = src/) so the path is stable regardless of where
  // `node` is launched from (avoids empty-DB-on-restart when cwd changes).
  return path.join(__dirname, "..", "data", "elaris.db");
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// One-time migration: if you previously had ./elaris.db in project root,
// move it to the new default data location (only when no env path is set).
function migrateLegacyDBIfNeeded(targetPath) {
  const env = (process.env.ELARIS_DB_PATH || process.env.DB_PATH || "").trim();
  if (env) return { migrated: false, reason: "env_path_set" };

  const legacy = path.join(__dirname, "..", "elaris.db");
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(targetPath)) {
      ensureDirForFile(targetPath);
      fs.renameSync(legacy, targetPath);
      // Best-effort: also move WAL/SHM if present (safe only when app is stopped)
      const wal = legacy + "-wal";
      const shm = legacy + "-shm";
      if (fs.existsSync(wal)) fs.renameSync(wal, targetPath + "-wal");
      if (fs.existsSync(shm)) fs.renameSync(shm, targetPath + "-shm");
      return { migrated: true, from: legacy, to: targetPath };
    }
  } catch (e) {
    return { migrated: false, reason: "error", error: String(e) };
  }
  return { migrated: false, reason: "nothing_to_do" };
}

module.exports = { getDBPath, ensureDirForFile, migrateLegacyDBIfNeeded };
