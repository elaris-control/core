// src/db.js
const Database = require("better-sqlite3");
const { getDBPath, ensureDirForFile } = require("./paths");
const { getProfile } = require("./esphome/board_profiles");
const { ensureProfileCatalogTables, seedProfileCatalog } = require("./esphome/profile_registry");

function initDB(dbPath) {
  if (!dbPath) dbPath = getDBPath();
  ensureDirForFile(dbPath);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
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
      name TEXT NOT NULL UNIQUE
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
      UNIQUE(device_id, group_name, key)
    );

    CREATE TABLE IF NOT EXISTS pending_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      key TEXT NOT NULL,
      group_name TEXT NOT NULL,
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
      PRIMARY KEY (device_id, group_name, key)
    );

    CREATE TABLE IF NOT EXISTS device_site (
      device_id TEXT PRIMARY KEY,
      site_id INTEGER NOT NULL,
      assigned_ts INTEGER NOT NULL,
      FOREIGN KEY(site_id) REFERENCES sites(id)
    );
  `);

  // Ensure optional columns exist (safe for older DBs)
  const blockedCols = db.prepare(`PRAGMA table_info(blocked_io);`).all().map(r => r.name);
  if(!blockedCols.includes("hidden")) db.exec(`ALTER TABLE blocked_io ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);

  const ioCols = db.prepare(`PRAGMA table_info(io);`).all().map(r => r.name);
  function ensureIoCol(name, ddl){
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
  try{
    const zCols = db.prepare(`PRAGMA table_info(zones);`).all().map(r=>r.name);
    if(!zCols.includes("site_id")) db.exec(`ALTER TABLE zones ADD COLUMN site_id INTEGER;`);
  }catch(_){}
  try{
    const pCols = db.prepare(`PRAGMA table_info(pending_io);`).all().map(r=>r.name);
    if(!pCols.includes("site_id")) db.exec(`ALTER TABLE pending_io ADD COLUMN site_id INTEGER;`);
  }catch(_){}


  // ensure optional sites columns exist (safe for older DBs)
  const cols = db.prepare(`PRAGMA table_info(sites);`).all().map(r => r.name);
  if (!cols.includes("note"))       { try { db.exec(`ALTER TABLE sites ADD COLUMN note TEXT;`); } catch (_) {} }
  if (!cols.includes("is_private")) { try { db.exec(`ALTER TABLE sites ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;`); } catch (_) {} }
  ["lat","lon","timezone","address"].forEach(col => {
    if (!cols.includes(col)) { try { db.exec(`ALTER TABLE sites ADD COLUMN ${col} TEXT`); } catch(_) {} }
  });


  // ── ESPHome board profile catalog (DB-backed, seeded from bundled profiles) ──
  ensureProfileCatalogTables(db);
  seedProfileCatalog(db);

  // ── ESPHome registry tables (used by installer + MQTT discovery) ─────
  // Migrations for columns added after initial deploy
  try {
    const esCols = db.prepare('PRAGMA table_info(esphome_devices)').all().map(r => r.name);
    if (!esCols.includes('deleted_at'))     db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_at TEXT`);
    if (!esCols.includes('deleted_reason')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_reason TEXT`);
  } catch (_) {}

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

  try {
    const eCols = db.prepare(`PRAGMA table_info(esphome_devices)`).all().map(r => r.name);
    if (!eCols.includes('deleted_at')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_at TEXT;`);
    if (!eCols.includes('deleted_reason')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_reason TEXT;`);
  } catch (_) {}

  // ── Lightweight migration runner / index hardening ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_ts INTEGER NOT NULL
    );
  `);

  function applyMigration(name, fn) {
    const done = db.prepare(`SELECT 1 FROM schema_migrations WHERE name = ?`).get(name);
    if (done) return false;
    const tx = db.transaction(() => {
      fn();
      db.prepare(`INSERT INTO schema_migrations(name, applied_ts) VALUES(?, ?)`).run(name, Date.now());
    });
    tx();
    return true;
  }

  applyMigration("core_indexes_v1", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_device_ts ON events(device_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events(topic, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_io_last_seen ON pending_io(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_io_zone_id ON io(zone_id);
      CREATE INDEX IF NOT EXISTS idx_device_site_site_id ON device_site(site_id);
      CREATE INDEX IF NOT EXISTS idx_zones_site_id ON zones(site_id);
    `);
  });

  // Migration: change zones UNIQUE(name) → UNIQUE(name, COALESCE(site_id,0))
  // so the same zone name can exist in different sites.
  // Migration: add config column to module_instances
  applyMigration("module_instances_config_v1", () => {
    // Guard: skip on fresh install — table doesn't exist yet, CREATE TABLE below already includes config
    const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    if (!tableExists) return;
    const miCols = db.prepare(`PRAGMA table_info(module_instances)`).all().map(r => r.name);
    if (!miCols.includes("config")) {
      db.exec(`ALTER TABLE module_instances ADD COLUMN config TEXT;`);
    }
  });

  // Migration: change zones UNIQUE(name) → UNIQUE(name, COALESCE(site_id,0))
  // so the same zone name can exist in different sites.
  applyMigration("zones_unique_per_site_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS zones_new (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT NOT NULL,
        site_id INTEGER
      );
      INSERT OR IGNORE INTO zones_new(id, name, site_id)
        SELECT id, name, site_id FROM zones;
      DROP TABLE zones;
      ALTER TABLE zones_new RENAME TO zones;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_name_site
        ON zones(name, COALESCE(site_id, 0));
      CREATE INDEX IF NOT EXISTS idx_zones_site_id2 ON zones(site_id);
    `);
  });

  // One-time dedupe: remove duplicate rows created by old import logic.
  // Repoints all references before deleting, so no FK or JSON refs are left dangling.
  applyMigration("dedupe_import_duplicates_v1", () => {
    const miExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    const scExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scenes'`).get();
    const ssExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_schedules'`).get();

    // ── 1. module_instances ──────────────────────────────────────────────
    if (miExists) {
      const miDupGroups = db.prepare(`
        SELECT MIN(id) AS keeper_id, site_id, module_id, COALESCE(name,'') AS grp_name
        FROM module_instances
        GROUP BY site_id, module_id, COALESCE(name,'')
        HAVING COUNT(*) > 1
      `).all();

      const getDupInstances    = db.prepare(`SELECT id FROM module_instances WHERE site_id=? AND module_id=? AND COALESCE(name,'')=? AND id != ?`);
      const deleteConflictMap  = db.prepare(`DELETE FROM module_mappings WHERE instance_id=? AND input_key IN (SELECT input_key FROM module_mappings WHERE instance_id=?)`);
      const repointMappings    = db.prepare(`UPDATE module_mappings SET instance_id=? WHERE instance_id=?`);
      const deleteInstance     = db.prepare(`DELETE FROM module_instances WHERE id=?`);
      const getScenes          = scExists ? db.prepare(`SELECT id, actions_json FROM scenes`) : null;
      const updateSceneJSON    = scExists ? db.prepare(`UPDATE scenes SET actions_json=? WHERE id=?`) : null;

      for (const g of miDupGroups) {
        const dups = getDupInstances.all(g.site_id, g.module_id, g.grp_name, g.keeper_id);
        for (const dup of dups) {
          // 1. Dedupe dup's own mappings (same input_key twice on same instance — keep MIN id)
          db.prepare(`DELETE FROM module_mappings WHERE instance_id=? AND id NOT IN (SELECT MIN(id) FROM module_mappings WHERE instance_id=? GROUP BY input_key)`).run(dup.id, dup.id);
          // 2. Drop dup's mappings that still conflict with keeper's existing input_keys
          deleteConflictMap.run(dup.id, g.keeper_id);
          // 3. Repoint remaining dup mappings to keeper — now guaranteed conflict-free
          repointMappings.run(g.keeper_id, dup.id);
          // Repoint set_setpoint instance_id inside scenes.actions_json
          if (getScenes) {
            for (const scene of getScenes.all()) {
              let actions; try { actions = JSON.parse(scene.actions_json || '[]'); } catch(_) { continue; }
              let changed = false;
              actions = actions.map(a => {
                if (a.type === 'set_setpoint' && a.instance_id === dup.id) { changed = true; return Object.assign({}, a, { instance_id: g.keeper_id }); }
                return a;
              });
              if (changed) updateSceneJSON.run(JSON.stringify(actions), scene.id);
            }
          }
          deleteInstance.run(dup.id);
        }
      }
    }

    // ── 2. scenes ────────────────────────────────────────────────────────
    if (scExists) {
      const scDupGroups = db.prepare(`
        SELECT MIN(id) AS keeper_id, COALESCE(site_id,0) AS site_key, name
        FROM scenes
        GROUP BY COALESCE(site_id,0), name
        HAVING COUNT(*) > 1
      `).all();

      const getDupScenes    = db.prepare(`SELECT id FROM scenes WHERE COALESCE(site_id,0)=? AND name=? AND id != ?`);
      const repointSchedules= ssExists ? db.prepare(`UPDATE scene_schedules SET scene_id=? WHERE scene_id=?`) : null;
      const repointLog      = db.prepare(`UPDATE scene_log SET scene_id=? WHERE scene_id=?`);
      const deleteScene     = db.prepare(`DELETE FROM scenes WHERE id=?`);

      for (const g of scDupGroups) {
        const dups = getDupScenes.all(g.site_key, g.name, g.keeper_id);
        for (const dup of dups) {
          if (repointSchedules) repointSchedules.run(g.keeper_id, dup.id);
          repointLog.run(g.keeper_id, dup.id);
          deleteScene.run(dup.id);
        }
      }

      // ── 3. scene_schedules (after scene repoint, keeper may now have dups) ──
      if (ssExists) {
        const ssDupGroups = db.prepare(`
          SELECT MIN(id) AS keeper_id, scene_id, time, days
          FROM scene_schedules
          GROUP BY scene_id, time, days
          HAVING COUNT(*) > 1
        `).all();
        const deleteSched = db.prepare(`DELETE FROM scene_schedules WHERE scene_id=? AND time=? AND days=? AND id != ?`);
        for (const g of ssDupGroups) {
          deleteSched.run(g.scene_id, g.time, g.days, g.keeper_id);
        }
      }
    }
  });

  // Add unique indexes to prevent logical duplicates at DB level (runs after dedupe above)
  applyMigration("unique_indexes_v1", () => {
    const miExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    const scExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scenes'`).get();
    const ssExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_schedules'`).get();
    if (miExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_instances_unique ON module_instances(site_id, module_id, COALESCE(name,''))`);
    if (scExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_unique ON scenes(COALESCE(site_id,0), name)`);
    if (ssExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_schedules_unique ON scene_schedules(scene_id, time, days)`);
  });

  applyMigration("sites_created_ts_alignment_v1", () => {
    const siteCols = db.prepare(`PRAGMA table_info(sites)`).all().map(r => r.name);
    if (siteCols.includes("created_at") && !siteCols.includes("created_ts")) {
      db.exec(`ALTER TABLE sites ADD COLUMN created_ts INTEGER`);
      db.exec(`UPDATE sites SET created_ts = COALESCE(created_ts, created_at, strftime('%s','now') * 1000)`);
    } else if (siteCols.includes("created_ts")) {
      db.exec(`UPDATE sites SET created_ts = COALESCE(created_ts, strftime('%s','now') * 1000)`);
    }
  });

  // Ensure default site exists
  db.prepare(`INSERT OR IGNORE INTO sites(name, created_ts) VALUES(?, ?)`).run("ELARIS Home", Date.now());

  const getDefaultSite = db.prepare(`SELECT id, name FROM sites ORDER BY id ASC LIMIT 1`);

  // ── Device state ──────────────────────────────────────────────────────────
  const insertEvent = db.prepare(`INSERT INTO events (device_id, topic, payload, ts) VALUES (@device_id, @topic, @payload, @ts)`);
  const getDeviceState = db.prepare(`SELECT key, value, ts FROM device_state WHERE device_id=? ORDER BY key`);
  const listDevicesFromState = db.prepare(`SELECT DISTINCT device_id FROM device_state ORDER BY device_id`);
  const listIOByDevice = db.prepare(`SELECT * FROM io WHERE device_id=? ORDER BY name`);
  const listPinnedIOWithState = db.prepare(`
    SELECT io.*,
      (SELECT sv.value FROM device_state sv WHERE sv.device_id=io.device_id AND sv.key=io.key LIMIT 1) AS value
    FROM io WHERE io.pinned=1 AND COALESCE(io.enabled,1)=1 ORDER BY io.name
  `);
  const getDeviceSite = db.prepare(`SELECT site_id FROM device_site WHERE device_id=?`);

  // ── Device-site assignment ─────────────────────────────────────────────────
  const assignDeviceToSiteStmt = db.prepare(`INSERT INTO device_site (device_id, site_id, assigned_ts) VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET site_id=excluded.site_id, assigned_ts=excluded.assigned_ts`);
  const getDeviceSiteStmt = db.prepare(`SELECT site_id FROM device_site WHERE device_id=?`);
  const listDevicesForSite = db.prepare(`SELECT device_id FROM device_site WHERE site_id=?`);

  function ensureDeviceAssigned(deviceId) {
    let row = getDeviceSiteStmt.get(deviceId);
    if (row) return row;
    const site = getDefaultSite.get();
    const siteId = site?.id || 1;
    assignDeviceToSiteStmt.run(deviceId, siteId, Date.now());
    return { site_id: siteId };
  }

  // ── Pending IO ─────────────────────────────────────────────────────────────
  const listPendingIO = db.prepare(`SELECT * FROM pending_io ORDER BY last_seen DESC`);
  const isApprovedIO = db.prepare(`SELECT 1 FROM io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const isBlockedIO = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const upsertPendingIO = db.prepare(`
    INSERT INTO pending_io (device_id, key, group_name, first_seen, last_seen, last_value)
    VALUES (@device_id, @key, @group_name, @ts, @ts, @last_value)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET last_seen=excluded.last_seen, last_value=excluded.last_value
  `);
  const hideBlockedIO = db.prepare(`UPDATE blocked_io SET hidden=1 WHERE device_id=? AND group_name=? AND key=?`);

  function deletePendingIO(id) {
    db.prepare(`DELETE FROM pending_io WHERE id=?`).run(id);
  }

  function deletePendingIOAndBlock(id) {
    const row = db.prepare(`SELECT * FROM pending_io WHERE id=?`).get(id);
    if (!row) return;
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO blocked_io (device_id, group_name, key, created_ts) VALUES (?,?,?,?)`).run(row.device_id, row.group_name, row.key, Date.now());
      db.prepare(`DELETE FROM pending_io WHERE id=?`).run(id);
    })();
  }

  function unblockPendingIO(deviceId, groupName, key) {
    db.prepare(`DELETE FROM blocked_io WHERE device_id=? AND group_name=? AND key=?`).run(deviceId, groupName, key);
  }

  function approvePending({ pending_id, name, type, zone_id, hw_type, kind, unit, source, port_id, bus_id, board_profile_id }) {
    const row = db.prepare(`SELECT * FROM pending_io WHERE id=?`).get(pending_id);
    if (!row) return { ok: false, error: 'not_found' };
    const ts = Date.now();
    const info = db.prepare(`
      INSERT INTO io (device_id, key, group_name, type, name, zone_id, created_ts, hw_type, kind, unit, source, port_id, bus_id, board_profile_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(device_id, group_name, key) DO UPDATE SET
        name=excluded.name, type=excluded.type, zone_id=excluded.zone_id,
        hw_type=excluded.hw_type, kind=excluded.kind, unit=excluded.unit,
        source=excluded.source, port_id=excluded.port_id, bus_id=excluded.bus_id,
        board_profile_id=excluded.board_profile_id
    `).run(row.device_id, row.key, row.group_name, type||'sensor', name, zone_id||null, ts, hw_type||null, kind||null, unit||null, source||null, port_id||null, bus_id||null, board_profile_id||null);
    db.prepare(`DELETE FROM pending_io WHERE id=?`).run(pending_id);
    return { ok: true, io_id: info.lastInsertRowid };
  }

  function noteDeviceAndMaybePendingIO({ deviceId, group, key, value, ts, retained }) {
    if (retained) return;
    if (isApprovedIO.get(deviceId, group, key)) return;
    if (isBlockedIO.get(deviceId, group, key)) return;
    upsertPendingIO.run({ device_id: deviceId, key, group_name: group, ts, last_value: value });
  }

  function noteDeviceConfig({ deviceId, config, ts, retained }) {
    if (!config || !deviceId) return;
    ensureDeviceAssigned(deviceId);
    const entities = Array.isArray(config.entities) ? config.entities : [];
    for (const e of entities) {
      if (!e?.key) continue;
      const group = e.group || (e.type === 'relay' ? 'state' : 'tele');
      if (isApprovedIO.get(deviceId, group, e.key)) continue;
      if (isBlockedIO.get(deviceId, group, e.key)) continue;
      upsertPendingIO.run({ device_id: deviceId, key: e.key, group_name: group, ts, last_value: null });
    }
    upsertEspHomeRegistry({ deviceId, retained, ts });
  }

  // ── Zones ──────────────────────────────────────────────────────────────────
  const listZones = db.prepare(`SELECT * FROM zones ORDER BY name`);
  const listZonesBySite = db.prepare(`SELECT * FROM zones WHERE site_id=? ORDER BY name`);
  const createZone = db.prepare(`INSERT OR IGNORE INTO zones (name, site_id) VALUES (?,?)`);
  const renameZoneStmt = db.prepare(`UPDATE zones SET name=? WHERE id=?`);
  const deleteZoneStmt = db.prepare(`DELETE FROM zones WHERE id=?`);
  const moveIOZone = db.prepare(`UPDATE io SET zone_id=? WHERE zone_id=?`);
  const clearIOZone = db.prepare(`UPDATE io SET zone_id=NULL WHERE zone_id=?`);
  const countIOByZone = db.prepare(`SELECT COUNT(*) AS c FROM io WHERE zone_id=?`);

  // ── Sites ──────────────────────────────────────────────────────────────────
  const listSites = db.prepare(`SELECT * FROM sites ORDER BY id`);
  const createSite = db.prepare(`INSERT INTO sites (name, note, is_private, created_ts) VALUES (?,?,?,?)`);
  const setSitePrivacy = db.prepare(`UPDATE sites SET is_private=? WHERE id=?`);

  function deleteSite(id) {
    db.transaction(() => {
      db.prepare(`UPDATE io SET zone_id=NULL WHERE device_id IN (SELECT device_id FROM device_site WHERE site_id=?)`).run(id);
      db.prepare(`DELETE FROM zones WHERE site_id=?`).run(id);
      db.prepare(`DELETE FROM device_site WHERE site_id=?`).run(id);
      db.prepare(`DELETE FROM sites WHERE id=?`).run(id);
    })();
  }

  const getEspHomeByName = db.prepare(`
    SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND lower(name)=lower(?) ORDER BY id DESC LIMIT 1
  `);
  const getEspHomeByTopicRoot = db.prepare(`
    SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND mqtt_topic_root=? ORDER BY id DESC LIMIT 1
  `);
  const getEspHomeAnyByName = db.prepare(`
    SELECT * FROM esphome_devices WHERE lower(name)=lower(?) ORDER BY id DESC LIMIT 1
  `);
  const getEspHomeAnyByTopicRoot = db.prepare(`
    SELECT * FROM esphome_devices WHERE mqtt_topic_root=? ORDER BY id DESC LIMIT 1
  `);
  const insertEspHomeDevice = db.prepare(`
    INSERT INTO esphome_devices (
      site_id, name, friendly_name, board_profile_id, chip, framework, transport,
      network_mode, status, serial_port, mac_address, ip_address, hostname,
      mqtt_topic_root, firmware_version, yaml_path, yaml_hash, last_validation_json,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateEspHomeDevice = db.prepare(`
    UPDATE esphome_devices
    SET friendly_name = COALESCE(?, friendly_name),
        status = COALESCE(?, status),
        hostname = COALESCE(?, hostname),
        firmware_version = COALESCE(?, firmware_version),
        mqtt_topic_root = COALESCE(?, mqtt_topic_root),
        transport = COALESCE(?, transport),
        network_mode = COALESCE(?, network_mode),
        mac_address = COALESCE(?, mac_address),
        ip_address = COALESCE(?, ip_address),
        last_seen_at = COALESCE(?, last_seen_at),
        updated_at = ?,
        deleted_at = CASE WHEN ? THEN NULL ELSE deleted_at END,
        deleted_reason = CASE WHEN ? THEN NULL ELSE deleted_reason END
    WHERE id = ?
  `);

  function seedPendingFromBoardProfile(deviceId, boardProfileId, ts) {
    const profile = getProfile(boardProfileId);
    const defaults = Array.isArray(profile?.entityDefaults) ? profile.entityDefaults : [];
    for (const e of defaults) {
      const group = e.type === 'relay' ? 'state' : 'tele';
      const alreadyApproved = isApprovedIO.get(deviceId, group, e.key);
      if (alreadyApproved) continue;
      const blocked = isBlockedIO.get(deviceId, group, e.key);
      if (blocked) continue;
      upsertPendingIO.run({
        device_id: deviceId,
        group_name: group,
        key: e.key,
        ts,
        last_value: null,
      });
    }
  }

  function upsertEspHomeRegistry({ deviceId, friendlyName = null, status = 'online', hostname = null, firmwareVersion = null, transport = null, networkMode = null, macAddress = null, ipAddress = null, retained = false, reviveDeleted = false, ts = Date.now() }) {
    const site = ensureDeviceAssigned(deviceId);
    const topicRoot = `elaris/${deviceId}`;
    const nowIso = new Date(Number.isFinite(Number(ts)) ? Number(ts) : Date.now()).toISOString();
    const visibleRow = getEspHomeByName.get(deviceId) || getEspHomeByTopicRoot.get(topicRoot);
    const anyRow = visibleRow || getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot);

    if (!visibleRow && !anyRow && retained) return null;
    if (anyRow?.deleted_at && !reviveDeleted) return { id: anyRow.id, suppressed: true, deleted_at: anyRow.deleted_at };

    let row = visibleRow || anyRow || null;
    const effectiveLastSeen = retained ? null : nowIso;
    const shouldRevive = !!(row?.deleted_at && reviveDeleted);
    if (!row) {
      const inserted = insertEspHomeDevice.run(
        site.site_id,
        deviceId,
        friendlyName || deviceId,
        'mqtt_discovered',
        null,
        null,
        transport,
        networkMode,
        retained ? 'seen' : status,
        null,
        macAddress,
        ipAddress,
        hostname,
        topicRoot,
        firmwareVersion,
        null,
        null,
        null,
        effectiveLastSeen,
        nowIso,
        nowIso,
      );
      row = { id: inserted.lastInsertRowid };
    } else {
      updateEspHomeDevice.run(
        friendlyName,
        retained ? (row.status || 'seen') : status,
        hostname,
        firmwareVersion,
        topicRoot,
        transport,
        networkMode,
        macAddress,
        ipAddress,
        effectiveLastSeen,
        nowIso,
        shouldRevive ? 1 : 0,
        shouldRevive ? 1 : 0,
        row.id,
      );
    }
    return row.id ? { id: row.id } : row;
  }

  function isEspHomeRegistrySuppressed(deviceId) {
    const topicRoot = `elaris/${deviceId}`;
    const row = getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot) || null;
    return !!(row && row.deleted_at);
  }

  function updateEspHomeIdentity(deviceId, fields = {}) {
    const topicRoot = `elaris/${deviceId}`;
    const row = getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot) || null;
    if (!row || row.deleted_at) return null;
    const mac = String(fields.mac_address || fields.macAddress || '').trim() || null;
    const ip = String(fields.ip_address || fields.ipAddress || '').trim() || null;
    const fw = String(fields.firmware_version || fields.firmwareVersion || '').trim() || null;
    const host = String(fields.hostname || '').trim() || null;
    const nowIso = new Date(Number.isFinite(Number(fields.ts)) ? Number(fields.ts) : Date.now()).toISOString();
    db.prepare(`UPDATE esphome_devices SET mac_address=COALESCE(?, mac_address), ip_address=COALESCE(?, ip_address), firmware_version=COALESCE(?, firmware_version), hostname=COALESCE(?, hostname), updated_at=? WHERE id=?`).run(mac, ip, fw, host, nowIso, row.id);
    return row.id;
  }

  function assignDeviceToSite(deviceId, siteId) {
    assignDeviceToSiteStmt.run(deviceId, siteId, Date.now());
    return { ok: true };
  }

  // ── Module instances tables ──────────────────────────────────────────
  db.exec(`
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

  const upsertState = db.prepare(`
    INSERT INTO device_state (device_id, key, value, ts) VALUES (@device_id, @key, @value, @ts)
    ON CONFLICT(device_id, key) DO UPDATE SET value=excluded.value, ts=excluded.ts
  `);

  return {
    db,

    upsertState,
    insertEvent,
    getDeviceState,
    listDevicesFromState,

    noteDeviceAndMaybePendingIO,
    noteDeviceConfig,
    listPendingIO,
    approvePending,
    listIOByDevice,
    listPinnedIOWithState,
    deletePendingIO,
    deletePendingIOAndBlock,
    unblockPendingIO,
    hideBlockedIO,

    createZone,
    listZones,
    listZonesBySite,

    renameZone: (id, name) => renameZoneStmt.run(name, id),
    deleteZone: (id, reassign_zone_id = null) => {
      const tx = db.transaction(() => {
        if (reassign_zone_id != null && Number.isFinite(reassign_zone_id)) {
          moveIOZone.run(reassign_zone_id, id);
        } else {
          clearIOZone.run(id);
        }
        deleteZoneStmt.run(id);
      });
      tx();
      return { ok: true };
    },
    countIOByZone,

    listSites,
    createSite,
    deleteSite,
    setSitePrivacy,

    ensureDeviceAssigned,
    assignDeviceToSite,
    listDevicesForSite,
    getDefaultSite,
    getDeviceSite,
    findEspHomeRegistry: (deviceId) => getEspHomeByName.get(deviceId) || getEspHomeByTopicRoot.get(`elaris/${deviceId}`) || null,
    findEspHomeRegistryAny: (deviceId) => getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(`elaris/${deviceId}`) || null,
    isEspHomeRegistrySuppressed,
    updateEspHomeIdentity,
  };
}

module.exports = { initDB };
// This is appended — handled inline in initDB below
