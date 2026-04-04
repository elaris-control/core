// src/core/db/migrations.js
// All ALTER TABLE migrations and schema evolution logic.

function applyMigration(db, name, fn) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_ts INTEGER NOT NULL)`);
  const done = db.prepare(`SELECT 1 FROM schema_migrations WHERE name = ?`).get(name);
  if (done) return false;
  const tx = db.transaction(() => {
    fn();
    db.prepare(`INSERT INTO schema_migrations(name, applied_ts) VALUES(?, ?)`).run(name, Date.now());
  });
  tx();
  return true;
}

function runMigrations(db) {
  applyMigration(db, "core_indexes_v1", () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_device_ts ON events(device_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events(topic, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_io_last_seen ON pending_io(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_io_zone_id ON io(zone_id);
      CREATE INDEX IF NOT EXISTS idx_device_site_site_id ON device_site(site_id);
      CREATE INDEX IF NOT EXISTS idx_zones_site_id ON zones(site_id);
    `);
  });

  applyMigration(db, "module_instances_config_v1", () => {
    const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    if (!tableExists) return;
    const miCols = db.prepare(`PRAGMA table_info(module_instances)`).all().map(r => r.name);
    if (!miCols.includes("config")) {
      db.exec(`ALTER TABLE module_instances ADD COLUMN config TEXT;`);
    }
  });

  applyMigration(db, "zones_unique_per_site_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS zones_NEW (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT NOT NULL,
        site_id INTEGER
      );
      INSERT OR IGNORE INTO zones_NEW(id, name, site_id)
        SELECT id, name, site_id FROM zones;
      DROP TABLE zones;
      ALTER TABLE zones_NEW RENAME TO zones;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_name_site
        ON zones(name, COALESCE(site_id, 0));
      CREATE INDEX IF NOT EXISTS idx_zones_site_id2 ON zones(site_id);
    `);
  });

  applyMigration(db, "dedupe_import_duplicates_v1", () => {
    const miExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    const scExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scenes'`).get();
    const ssExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_schedules'`).get();

    if (miExists) {
      const miDupGroups = db.prepare(`
        SELECT MIN(id) AS keeper_id, site_id, module_id, COALESCE(name,'') AS grp_name
        FROM module_instances
        GROUP BY site_id, module_id, COALESCE(name,'')
        HAVING COUNT(*) > 1
      `).all();

      const getDupInstances = db.prepare(`SELECT id FROM module_instances WHERE site_id=? AND module_id=? AND COALESCE(name,'')=? AND id != ?`);
      const deleteConflictMap = db.prepare(`DELETE FROM module_mappings WHERE instance_id=? AND input_key IN (SELECT input_key FROM module_mappings WHERE instance_id=?)`);
      const repointMappings = db.prepare(`UPDATE module_mappings SET instance_id=? WHERE instance_id=?`);
      const deleteInstance = db.prepare(`DELETE FROM module_instances WHERE id=?`);
      const getScenes = scExists ? db.prepare(`SELECT id, actions_json FROM scenes`) : null;
      const updateSceneJSON = scExists ? db.prepare(`UPDATE scenes SET actions_json=? WHERE id=?`) : null;

      for (const g of miDupGroups) {
        const dups = getDupInstances.all(g.site_id, g.module_id, g.grp_name, g.keeper_id);
        for (const dup of dups) {
          db.prepare(`DELETE FROM module_mappings WHERE instance_id=? AND id NOT IN (SELECT MIN(id) FROM module_mappings WHERE instance_id=? GROUP BY input_key)`).run(dup.id, dup.id);
          deleteConflictMap.run(dup.id, g.keeper_id);
          repointMappings.run(g.keeper_id, dup.id);
          if (getScenes) {
            for (const scene of getScenes.all()) {
              let actions; try { actions = JSON.parse(scene.actions_json || '[]'); } catch (_) { continue; }
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

    if (scExists) {
      const scDupGroups = db.prepare(`
        SELECT MIN(id) AS keeper_id, COALESCE(site_id,0) AS site_key, name
        FROM scenes
        GROUP BY COALESCE(site_id,0), name
        HAVING COUNT(*) > 1
      `).all();

      const getDupScenes = db.prepare(`SELECT id FROM scenes WHERE COALESCE(site_id,0)=? AND name=? AND id != ?`);
      const repointSchedules = ssExists ? db.prepare(`UPDATE scene_schedules SET scene_id=? WHERE scene_id=?`) : null;
      const repointLog = db.prepare(`UPDATE scene_log SET scene_id=? WHERE scene_id=?`);
      const deleteScene = db.prepare(`DELETE FROM scenes WHERE id=?`);

      for (const g of scDupGroups) {
        const dups = getDupScenes.all(g.site_key, g.name, g.keeper_id);
        for (const dup of dups) {
          if (repointSchedules) repointSchedules.run(g.keeper_id, dup.id);
          repointLog.run(g.keeper_id, dup.id);
          deleteScene.run(dup.id);
        }
      }

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

  applyMigration(db, "unique_indexes_v1", () => {
    const miExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='module_instances'`).get();
    const scExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scenes'`).get();
    const ssExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_schedules'`).get();
    if (miExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_instances_unique ON module_instances(site_id, module_id, COALESCE(name,''))`);
    if (scExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_unique ON scenes(COALESCE(site_id,0), name)`);
    if (ssExists) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_schedules_unique ON scene_schedules(scene_id, time, days)`);
  });

  applyMigration(db, "module_instances_active_unique_v1", () => {
    db.exec(`DROP INDEX IF EXISTS idx_module_instances_unique`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_instances_unique ON module_instances(site_id, module_id, COALESCE(name,'')) WHERE active = 1`);
  });

  applyMigration(db, "sites_created_ts_alignment_v1", () => {
    const siteCols = db.prepare(`PRAGMA table_info(sites)`).all().map(r => r.name);
    if (siteCols.includes("created_at") && !siteCols.includes("created_ts")) {
      db.exec(`ALTER TABLE sites ADD COLUMN created_ts INTEGER`);
      db.exec(`UPDATE sites SET created_ts = COALESCE(created_ts, created_at, strftime('%s','now') * 1000)`);
    } else if (siteCols.includes("created_ts")) {
      db.exec(`UPDATE sites SET created_ts = COALESCE(created_ts, strftime('%s','now') * 1000)`);
    }
  });
}

module.exports = { applyMigration, runMigrations };
