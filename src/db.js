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


  // ── ESPHome board profile catalog (DB-backed, seeded from bundled profiles) ──
  ensureProfileCatalogTables(db);
  seedProfileCatalog(db);

  // ── ESPHome registry tables (used by installer + MQTT discovery) ─────
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_esphome_devices_site_id ON esphome_devices(site_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_name ON esphome_devices(name);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_status ON esphome_devices(status);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mqtt_root ON esphome_devices(mqtt_topic_root);

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


  const getEspHomeByName = db.prepare(`
    SELECT * FROM esphome_devices WHERE lower(name)=lower(?) ORDER BY id DESC LIMIT 1
  `);
  const getEspHomeByTopicRoot = db.prepare(`
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
        last_seen_at = ?,
        updated_at = ?
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

  function upsertEspHomeRegistry({ deviceId, friendlyName = null, status = 'online', hostname = null, firmwareVersion = null, transport = null, networkMode = null, ts = Date.now() }) {
    const site = ensureDeviceAssigned(deviceId);
    const topicRoot = `elaris/${deviceId}`;
    const nowIso = new Date(Number.isFinite(Number(ts)) ? Number(ts) : Date.now()).toISOString();
    let row = getEspHomeByName.get(deviceId) || getEspHomeByTopicRoot.get(topicRoot);
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
        status,
        null,
        null,
        null,
        hostname,
        topicRoot,
        firmwareVersion,
        null,
        null,
        null,
        nowIso,
        nowIso,
        nowIso,
      );
      row = { id: inserted.lastInsertRowid };
    } else {
      updateEspHomeDevice.run(
        friendlyName,
        status,
        hostname,
        firmwareVersion,
        topicRoot,
        transport,
        networkMode,
        nowIso,
        nowIso,
        row.id,
      );
    }
    return row.id;
  }

  const upsertState = db.prepare(`
    INSERT INTO device_state(device_id, key, value, ts)
    VALUES(@device_id, @key, @value, @ts)
    ON CONFLICT(device_id, key) DO UPDATE SET value=excluded.value, ts=excluded.ts
  `);

  const insertEvent = db.prepare(`
    INSERT INTO events(device_id, topic, payload, ts)
    VALUES(@device_id, @topic, @payload, @ts)
  `);

  const getDeviceState = db.prepare(`
    SELECT key, value, ts FROM device_state WHERE device_id = ? ORDER BY key ASC
  `);

  const listDevicesFromState = db.prepare(`
    SELECT DISTINCT device_id FROM device_state ORDER BY device_id ASC
  `);

  const upsertDeviceSeen = db.prepare(`
    INSERT INTO devices(id, name, last_seen)
    VALUES(?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen
  `);

  const upsertPendingIO = db.prepare(`
    INSERT INTO pending_io(device_id, group_name, key, site_id, first_seen, last_seen, last_value)
    VALUES(@device_id, @group_name, @key,
      (SELECT site_id FROM device_site WHERE device_id=@device_id),
      @ts, @ts, @last_value)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET
      last_seen=excluded.last_seen,
      last_value=excluded.last_value,
      site_id=COALESCE(excluded.site_id, pending_io.site_id)
  `);

  const listPendingIO = db.prepare(`
    SELECT id, device_id, group_name, key, site_id, first_seen, last_seen, last_value
    FROM pending_io ORDER BY last_seen DESC
  `);

  const deletePendingIO = db.prepare(`DELETE FROM pending_io WHERE id = ?`);
  // When deleting a pending IO, automatically block it so it doesn't reappear
  function deletePendingIOAndBlock(id) {
    const row = db.prepare(`SELECT device_id, group_name, key FROM pending_io WHERE id=?`).get(id);
    deletePendingIO.run(id);
    if (row) blockPendingIO.run(row.device_id, row.group_name, row.key, Date.now());
  }

  // FIX: was missing — called by approvePending
  const approvePendingIO = db.prepare(`
    INSERT INTO io(device_id, group_name, key, type, name, zone_id, created_ts, hw_type, kind, unit)
    VALUES(@device_id, @group_name, @key, @type, @name, @zone_id, @ts, @hw_type, @kind, @unit)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET
      name=excluded.name,
      type=excluded.type,
      zone_id=COALESCE(excluded.zone_id, io.zone_id),
      hw_type=excluded.hw_type,
      kind=excluded.kind,
      unit=excluded.unit
  `);

  // FIX: single consolidated approvePending (removed duplicate old version below)
  function approvePending({ pending_id, name, type, zone_id, hw_type, kind, unit }) {
    const row = db.prepare(`SELECT * FROM pending_io WHERE id = ?`).get(pending_id);
    if (!row) throw new Error("pending_not_found");

    approvePendingIO.run({
      device_id: row.device_id,
      group_name: row.group_name,
      key: row.key,
      type,
      name,
      zone_id: zone_id ?? null,
      ts: Date.now(),
      hw_type: hw_type ?? (type === "relay" ? "relay" : "di"),
      kind: kind ?? (type === "relay" ? "relay" : "generic"),
      unit: unit ?? null,
    });

    deletePendingIO.run(pending_id);
    return { ok: true };
  }

  const listIOByDevice = db.prepare(`
  SELECT io.id, io.device_id, io.group_name, io.key, io.type, io.name,
         io.zone_id, z.name AS zone_name,
         io.hw_type, io.kind, io.unit, io.pinned
  FROM io
  LEFT JOIN zones z ON z.id = io.zone_id
  WHERE io.device_id = ?
  ORDER BY io.group_name, io.key
`);

  const listPinnedIOWithState = db.prepare(`
  SELECT io.id, io.device_id, io.group_name, io.key, io.type, io.name,
         io.zone_id, z.name AS zone_name, io.unit, io.pinned,
         ds.value, ds.ts AS state_ts
  FROM io
  LEFT JOIN zones z ON z.id = io.zone_id
  LEFT JOIN device_state ds ON ds.device_id = io.device_id
    AND ds.key = (io.group_name || '.' || io.key)
  WHERE io.pinned = 1
  ORDER BY io.name, io.key
`);

  const createZone        = db.prepare(`INSERT OR IGNORE INTO zones(name, site_id) VALUES(?,?)`);
  const listZones         = db.prepare(`SELECT id, name, site_id FROM zones ORDER BY name ASC`);
  const listZonesBySite   = db.prepare(`SELECT id, name, site_id FROM zones WHERE site_id=? ORDER BY name ASC`);
  const renameZone        = db.prepare(`UPDATE zones SET name=? WHERE id=?`);
  const deleteZoneStmt    = db.prepare(`DELETE FROM zones WHERE id=?`);
  const clearIOZone = db.prepare(`UPDATE io SET zone_id=NULL WHERE zone_id=?`);
  const moveIOZone = db.prepare(`UPDATE io SET zone_id=? WHERE zone_id=?`);
  const countIOByZone = db.prepare(`SELECT COUNT(*) AS c FROM io WHERE zone_id=?`);


  // Sites
  const listSites      = db.prepare(`SELECT id, name, note, is_private, lat, lon, timezone, address, created_ts FROM sites ORDER BY id ASC`);
  const createSite     = db.prepare(`INSERT INTO sites(name, note, is_private, created_ts) VALUES(?, ?, ?, ?)`);
  const _deleteSiteRow  = db.prepare(`DELETE FROM sites WHERE id = ?`);
  const setSitePrivacy  = db.prepare(`UPDATE sites SET is_private=? WHERE id=?`);

  function deleteSite(id) {
    const tx = db.transaction(() => {
      // Block deleting the last site — many flows require at least one site to exist
      const total = db.prepare(`SELECT COUNT(*) AS c FROM sites`).get();
      if (total.c <= 1) throw new Error("cannot_delete_last_site");
      // Unlink zones — keep the zones, just remove site association
      db.prepare(`UPDATE zones SET site_id=NULL WHERE site_id=?`).run(id);
      // Unlink scenes — keep scenes, remove site association
      db.prepare(`UPDATE scenes SET site_id=NULL WHERE site_id=?`).run(id);
      // Unlink pending_io
      db.prepare(`UPDATE pending_io SET site_id=NULL WHERE site_id=?`).run(id);
      // Reassign ESPHome devices to default site (or null if no default)
      const defaultSite = db.prepare(`SELECT id FROM sites WHERE id != ? ORDER BY id ASC LIMIT 1`).get(id);
      if (defaultSite) {
        db.prepare(`UPDATE esphome_devices SET site_id=? WHERE site_id=?`).run(defaultSite.id, id);
      } else {
        // no other site: just remove association (site_id is NOT NULL on esphome_devices,
        // so we block delete if ESPHome devices exist on this site)
        const count = db.prepare(`SELECT COUNT(*) AS c FROM esphome_devices WHERE site_id=?`).get(id);
        if (count?.c > 0) throw new Error("cannot_delete_site_with_esphome_devices");
      }
      // device_site rows: reassign to defaultSite (always exists — last-site guard above)
      if (defaultSite) {
        db.prepare(`UPDATE device_site SET site_id=? WHERE site_id=?`).run(defaultSite.id, id);
      } else {
        db.prepare(`DELETE FROM device_site WHERE site_id=?`).run(id);
      }
      // Null out scene actions pointing to this site's module instances (CASCADE will delete them next)
      const siteInstIds = db.prepare(`SELECT id FROM module_instances WHERE site_id=?`).all(id).map(r => r.id);
      if (siteInstIds.length) {
        const allScenes = db.prepare(`SELECT id, actions_json FROM scenes`).all();
        const patchScene = db.prepare(`UPDATE scenes SET actions_json=? WHERE id=?`);
        for (const scene of allScenes) {
          let actions; try { actions = JSON.parse(scene.actions_json || '[]'); } catch(_) { continue; }
          let changed = false;
          actions = actions.map(a => {
            if (a.type === 'set_setpoint' && siteInstIds.includes(a.instance_id)) { changed = true; return Object.assign({}, a, { instance_id: null }); }
            return a;
          });
          if (changed) patchScene.run(JSON.stringify(actions), scene.id);
        }
      }
      // module_instances: ON DELETE CASCADE handles these when FK is ON
      _deleteSiteRow.run(id);
    });
    tx();
  }

  const assignDeviceToSiteStmt = db.prepare(`
    INSERT INTO device_site(device_id, site_id, assigned_ts)
    VALUES(?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET site_id=excluded.site_id, assigned_ts=excluded.assigned_ts
  `);

  const getDeviceSite = db.prepare(`
    SELECT s.id AS site_id, s.name AS site_name
    FROM device_site ds
    JOIN sites s ON s.id = ds.site_id
    WHERE ds.device_id = ?
  `);

  const listDevicesForSite = db.prepare(`
    SELECT ds.device_id FROM device_site ds WHERE ds.site_id = ? ORDER BY ds.device_id ASC
  `);

  function ensureDeviceAssigned(deviceId) {
    const row = getDeviceSite.get(deviceId);
    if (row) return row;
    const def = getDefaultSite.get();
    assignDeviceToSiteStmt.run(deviceId, def.id, Date.now());
    return { site_id: def.id, site_name: def.name };
  }

  // Pre-compiled check: is this device+group+key already an approved IO?
  const isApprovedIO = db.prepare(`
    SELECT 1 FROM io WHERE device_id=? AND group_name=? AND key=?
  `);

  // Pre-compiled check: is this key blocked (deleted by user)?
  // Uses the existing blocked_io table (same table used by the blocklist feature)
  const isBlockedIO = db.prepare(`
    SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=?
  `);

  const blockPendingIO = db.prepare(`
    INSERT OR REPLACE INTO blocked_io(device_id, group_name, key, created_ts, reason)
    VALUES(?, ?, ?, ?, 'pending_deleted')
  `);

  const unblockPendingIO = db.prepare(`
    DELETE FROM blocked_io WHERE device_id=? AND group_name=? AND key=?
  `);

  // Called by MQTT layer
  function noteDeviceAndMaybePendingIO({ deviceId, group, key, value, ts }) {
    upsertDeviceSeen.run(deviceId, ts);
    ensureDeviceAssigned(deviceId);

    if (group === 'meta' && key === 'status') {
      const raw = String(value ?? '').trim().toLowerCase();
      const mappedStatus = raw === 'offline' ? 'offline' : 'online';
      upsertEspHomeRegistry({ deviceId, status: mappedStatus, transport: 'ota', ts });
      return;
    }

    if (group === "tele" || group === "state") {
      upsertEspHomeRegistry({ deviceId, status: 'online', transport: 'ota', ts });
    }

    if (group === "tele" || group === "state") {
      // Skip if already approved — no point showing it in pending again
      const alreadyApproved = isApprovedIO.get(deviceId, group, key);
      if (alreadyApproved) return;

      // Skip if user explicitly deleted this pending IO (blocked)
      const isBlocked = isBlockedIO.get(deviceId, group, key);
      if (isBlocked) return;

      upsertPendingIO.run({
        device_id: deviceId,
        group_name: group,
        key,
        ts,
        last_value: value ?? null,
      });
    }
  }

  // FIX Bug 2: noteDeviceConfig — called by mqtt.js when a device sends its /config payload
  function noteDeviceConfig({ deviceId, config, ts }) {
    upsertDeviceSeen.run(deviceId, ts);
    ensureDeviceAssigned(deviceId);
    upsertEspHomeRegistry({
      deviceId,
      friendlyName: config?.device?.name || deviceId,
      hostname: config?.device?.hostname || deviceId,
      firmwareVersion: config?.device?.sw || null,
      transport: 'ota',
      status: 'online',
      ts,
    });

    let seeded = false;
    const entities = Array.isArray(config?.entities) ? config.entities : [];
    for (const e of entities) {
      if (!e?.key) continue;
      const group = e.group || (e.type === "relay" || e.type === "switch" ? "state" : "tele");
      upsertPendingIO.run({
        device_id: deviceId,
        group_name: group,
        key: e.key,
        ts,
        last_value: null,
      });
      seeded = true;
    }

    if (!seeded) {
      const reg = getEspHomeByName.get(deviceId) || getEspHomeByTopicRoot.get(`elaris/${deviceId}`);
      if (reg?.board_profile_id) {
        seedPendingFromBoardProfile(deviceId, reg.board_profile_id, ts);
      }
    }

    if (config?.device?.name) {
      db.prepare(`UPDATE devices SET name=? WHERE id=?`).run(config.device.name, deviceId);
    }
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

  // ── Site location migration (safe — idempotent) ─────────────────────
  ["lat","lon","timezone","address"].forEach(col => {
    try { db.exec(`ALTER TABLE sites ADD COLUMN ${col} TEXT`); } catch(_) {}
  });

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

    createZone,
    listZones,
    listZonesBySite,

    renameZone: (id, name) => renameZone.run(name, id),
    deleteZone: (id, reassign_zone_id=null) => {
      const tx = db.transaction(()=>{
        if (reassign_zone_id && Number.isFinite(reassign_zone_id)) {
          moveIOZone.run(reassign_zone_id, id);
        } else {
          clearIOZone.run(id);
        }
        deleteZoneStmt.run(id);
      });
      tx();
    
  return { ok:true };
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
  };
}

module.exports = { initDB };
// This is appended — handled inline in initDB below
