// src/core/db/schema.js
// All CREATE TABLE statements — no logic, just schema definitions.

function createCoreTables(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS device_state (
      device_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (device_id, key)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      last_seen INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      site_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      key TEXT NOT NULL,
      group_name TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      zone_id INTEGER,
      created_ts INTEGER NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      UNIQUE(device_id, group_name, key)
    );

    CREATE TABLE IF NOT EXISTS pending_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      key TEXT NOT NULL,
      group_name TEXT NOT NULL,
      source TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      last_value TEXT,
      UNIQUE(device_id, group_name, key)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      note TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      lat TEXT,
      lon TEXT,
      timezone TEXT,
      address TEXT,
      created_ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_io (
      device_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      key TEXT NOT NULL,
      created_ts INTEGER NOT NULL,
      reason TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, group_name, key)
    );

    CREATE TABLE IF NOT EXISTS device_site (
      device_id TEXT PRIMARY KEY,
      site_id INTEGER NOT NULL,
      assigned_ts INTEGER NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS io_history_rollups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      io_id INTEGER NOT NULL,
      bucket_start_ts INTEGER NOT NULL,
      bucket_size TEXT NOT NULL,
      min_value REAL,
      max_value REAL,
      avg_value REAL,
      last_value REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      created_ts INTEGER NOT NULL,
      UNIQUE(io_id, bucket_start_ts, bucket_size)
    );

    CREATE INDEX IF NOT EXISTS idx_io_history_rollups_lookup ON io_history_rollups(io_id, bucket_size, bucket_start_ts);

    CREATE TABLE IF NOT EXISTS module_instances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      module_id   TEXT NOT NULL,
      name        TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      config      TEXT,
      created_ts  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_mappings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
      input_key   TEXT NOT NULL,
      io_id       INTEGER,
      UNIQUE(instance_id, input_key)
    );
  `);
}

function createEspHomeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS esphome_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      friendly_name TEXT,
      board_profile_id TEXT NOT NULL,
      chip TEXT,
      framework TEXT,
      transport TEXT,
      network_mode TEXT,
      status TEXT DEFAULT 'new',
      serial_port TEXT,
      mac_address TEXT,
      ip_address TEXT,
      hostname TEXT,
      mqtt_topic_root TEXT,
      firmware_version TEXT,
      yaml_path TEXT,
      yaml_hash TEXT,
      last_validation_json TEXT,
      integration_key TEXT NOT NULL DEFAULT 'esphome',
      ownership_mode TEXT NOT NULL DEFAULT 'managed_internal',
      config_source TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      encryption_key TEXT,
      last_seen_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_esphome_devices_site_id ON esphome_devices(site_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_name ON esphome_devices(name);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_status ON esphome_devices(status);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mqtt_root ON esphome_devices(mqtt_topic_root);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mac ON esphome_devices(mac_address);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_deleted_at ON esphome_devices(deleted_at);

    CREATE TABLE IF NOT EXISTS esphome_generated_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      config_mode TEXT NOT NULL,
      board_profile_id TEXT NOT NULL,
      yaml_text TEXT NOT NULL,
      yaml_hash TEXT,
      validation_json TEXT,
      integration_key TEXT NOT NULL DEFAULT 'esphome',
      ownership_mode TEXT NOT NULL DEFAULT 'managed_internal',
      config_source TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      generated_by TEXT DEFAULT 'system',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS esphome_install_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      config_id INTEGER,
      job_type TEXT NOT NULL,
      target_port TEXT,
      target_ip TEXT,
      status TEXT DEFAULT 'queued',
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      output_log TEXT,
      error_text TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE,
      FOREIGN KEY (config_id) REFERENCES esphome_generated_configs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS esphome_device_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      override_key TEXT NOT NULL,
      override_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(esphome_device_id, override_key),
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE
    );
  `);
}

function ensureOptionalColumns(db) {
  const blockedCols = db.prepare(`PRAGMA table_info(blocked_io);`).all().map(r => r.name);
  if (!blockedCols.includes("hidden")) db.exec(`ALTER TABLE blocked_io ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);

  const ioCols = db.prepare(`PRAGMA table_info(io);`).all().map(r => r.name);
  function ensureIoCol(name, ddl) {
    if (!ioCols.includes(name)) {
      try { db.exec(ddl); } catch (_) {}
    }
  }
  ensureIoCol("enabled", `ALTER TABLE io ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
  ensureIoCol("hw_type", `ALTER TABLE io ADD COLUMN hw_type TEXT;`);
  ensureIoCol("kind", `ALTER TABLE io ADD COLUMN kind TEXT;`);
  ensureIoCol("unit", `ALTER TABLE io ADD COLUMN unit TEXT;`);
  ensureIoCol("device_class", `ALTER TABLE io ADD COLUMN device_class TEXT;`);
  ensureIoCol("pinned", `ALTER TABLE io ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`);
  ensureIoCol("source", `ALTER TABLE io ADD COLUMN source TEXT;`);
  ensureIoCol("port_id", `ALTER TABLE io ADD COLUMN port_id TEXT;`);
  ensureIoCol("bus_id", `ALTER TABLE io ADD COLUMN bus_id TEXT;`);
  ensureIoCol("board_profile_id", `ALTER TABLE io ADD COLUMN board_profile_id TEXT;`);
  ensureIoCol("stale", `ALTER TABLE io ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;`);

  try {
    const zCols = db.prepare(`PRAGMA table_info(zones);`).all().map(r => r.name);
    if (!zCols.includes("site_id")) db.exec(`ALTER TABLE zones ADD COLUMN site_id INTEGER;`);
  } catch (_) {}

  try {
    const pCols = db.prepare(`PRAGMA table_info(pending_io);`).all().map(r => r.name);
    if (!pCols.includes("site_id")) db.exec(`ALTER TABLE pending_io ADD COLUMN site_id INTEGER;`);
    if (!pCols.includes("source")) db.exec(`ALTER TABLE pending_io ADD COLUMN source TEXT;`);
  } catch (_) {}

  const siteCols = db.prepare(`PRAGMA table_info(sites);`).all().map(r => r.name);
  if (!siteCols.includes("note")) { try { db.exec(`ALTER TABLE sites ADD COLUMN note TEXT;`); } catch (_) {} }
  if (!siteCols.includes("is_private")) { try { db.exec(`ALTER TABLE sites ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;`); } catch (_) {} }
  ["lat", "lon", "timezone", "address"].forEach(col => {
    if (!siteCols.includes(col)) { try { db.exec(`ALTER TABLE sites ADD COLUMN ${col} TEXT`); } catch (_) {} }
  });

  try {
    const esCols = db.prepare('PRAGMA table_info(esphome_devices)').all().map(r => r.name);
    if (!esCols.includes('deleted_at')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_at TEXT`);
    if (!esCols.includes('deleted_reason')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_reason TEXT`);
    if (!esCols.includes('integration_key')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN integration_key TEXT NOT NULL DEFAULT 'esphome'`);
    if (!esCols.includes('ownership_mode')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN ownership_mode TEXT NOT NULL DEFAULT 'managed_internal'`);
    if (!esCols.includes('config_source')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN config_source TEXT`);
    if (!esCols.includes('read_only')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`);
    if (!esCols.includes('encryption_key')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN encryption_key TEXT`);
  } catch (_) {}

  try {
    const cfgCols = db.prepare('PRAGMA table_info(esphome_generated_configs)').all().map(r => r.name);
    if (!cfgCols.includes('integration_key')) db.exec(`ALTER TABLE esphome_generated_configs ADD COLUMN integration_key TEXT NOT NULL DEFAULT 'esphome'`);
    if (!cfgCols.includes('ownership_mode')) db.exec(`ALTER TABLE esphome_generated_configs ADD COLUMN ownership_mode TEXT NOT NULL DEFAULT 'managed_internal'`);
    if (!cfgCols.includes('config_source')) db.exec(`ALTER TABLE esphome_generated_configs ADD COLUMN config_source TEXT`);
    if (!cfgCols.includes('read_only')) db.exec(`ALTER TABLE esphome_generated_configs ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0`);
  } catch (_) {}
}

function createIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_device_ts ON events(device_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events(topic, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_io_last_seen ON pending_io(last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_io_zone_id ON io(zone_id);
    CREATE INDEX IF NOT EXISTS idx_device_site_site_id ON device_site(site_id);
    CREATE INDEX IF NOT EXISTS idx_zones_site_id ON zones(site_id);
  `);
}

module.exports = { createCoreTables, createEspHomeTables, ensureOptionalColumns, createIndexes };
