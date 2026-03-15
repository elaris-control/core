// src/scenes.js
// 🎬 Scenes — one-tap multi-action presets
//
// A scene is a named collection of actions:
//   - set_setpoint: change a module setting (e.g. dt_on, profile)
//   - send_command: send ON/OFF/value to an IO
//   - notify:       send a notification
//
// Scenes can be triggered:
//   1. Dashboard button (POST /api/scenes/:id/activate)
//   2. Custom logic action type "activate_scene" (scene_id)

function initScenes(db) {
  // DB setup
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '🎬',
      color       TEXT NOT NULL DEFAULT '#6366f1',
      actions_json TEXT NOT NULL DEFAULT '[]',
      created_ts  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id   INTEGER,
      scene_name TEXT,
      triggered_by TEXT,
      ts         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_schedules (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id  INTEGER NOT NULL,
      time      TEXT NOT NULL,
      days      TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
      enabled   INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Migration: add site_id to scenes if missing
  const sceneCols = db.prepare(`PRAGMA table_info(scenes)`).all().map(r => r.name);
  if (!sceneCols.includes('site_id')) {
    db.exec(`ALTER TABLE scenes ADD COLUMN site_id INTEGER;`);
  }

  const listScenes        = db.prepare(`SELECT * FROM scenes ORDER BY id ASC`);
  const listScenesBySite  = db.prepare(`SELECT * FROM scenes WHERE site_id=? ORDER BY id ASC`);
  const getScene          = db.prepare(`SELECT * FROM scenes WHERE id = ?`);
  const insertScene       = db.prepare(`INSERT INTO scenes(name,icon,color,actions_json,site_id,created_ts) VALUES(?,?,?,?,?,?)`);
  const updateScene       = db.prepare(`UPDATE scenes SET name=?,icon=?,color=?,actions_json=?,site_id=? WHERE id=?`);
  const deleteScene       = db.prepare(`DELETE FROM scenes WHERE id=?`);
  const insertLog    = db.prepare(`INSERT INTO scene_log(scene_id,scene_name,triggered_by,ts) VALUES(?,?,?,?)`);
  const listLog      = db.prepare(`
    SELECT sl.*, sc.site_id
    FROM scene_log sl
    LEFT JOIN scenes sc ON sc.id = sl.scene_id
    ORDER BY sl.ts DESC
    LIMIT 50
  `);

  const listSchedules          = db.prepare(`SELECT * FROM scene_schedules ORDER BY id ASC`);
  const getSchedulesByScene    = db.prepare(`SELECT * FROM scene_schedules WHERE scene_id=?`);
  const insertSchedule         = db.prepare(`INSERT INTO scene_schedules(scene_id,time,days,enabled) VALUES(?,?,?,?)`);
  const updateSchedule         = db.prepare(`UPDATE scene_schedules SET time=?,days=?,enabled=? WHERE id=?`);
  const deleteSchedule         = db.prepare(`DELETE FROM scene_schedules WHERE id=?`);
  const deleteSchedulesByScene = db.prepare(`DELETE FROM scene_schedules WHERE scene_id=?`);

  // ── Activate a scene ─────────────────────────────────────────────────────
  async function activate(sceneId, { engine, mqttApi, notify, triggeredBy = "manual" } = {}) {
    const scene = getScene.get(sceneId);
    if (!scene) throw new Error("scene_not_found");

    let actions;
    try { actions = JSON.parse(scene.actions_json); } catch { actions = []; }

    for (const action of actions) {
      try {
        if (action.type === "set_setpoint") {
          // { type, instance_id, key, value }
          if (engine) engine.setSetting(action.instance_id, action.key, String(action.value));

        } else if (action.type === "send_command") {
          // { type, io_id, value }
          const io = db.prepare(`SELECT * FROM io WHERE id=?`).get(action.io_id);
          if (io) {
            if (engine?.sendIOCommand) engine.sendIOCommand(io, action.value, { reason: `Scene: ${scene.name}` });
            else if (mqttApi) mqttApi.sendCommand(io.device_id, io.key, action.value);
          }

        } else if (action.type === "notify") {
          // { type, title, body, level }
          if (notify) {
            await notify({
              title:      action.title || `Scene: ${scene.name}`,
              body:       action.body  || `Scene "${scene.name}" activated`,
              level:      action.level || "info",
              tag:        `scene_${sceneId}`,
              cooldown_s: 0,
            });
          }
        } else if (action.type === 'delay') {
          const ms = Math.min(Math.max(Number(action.seconds) || 1, 1), 300) * 1000;
          await new Promise(resolve => setTimeout(resolve, ms));
        }
      } catch (e) {
        console.error(`[SCENES] Action failed in scene ${scene.name}:`, e.message);
      }
    }

    insertLog.run(sceneId, scene.name, triggeredBy, Date.now());
    console.log(`[SCENES] "${scene.name}" activated by ${triggeredBy}`);
    return { ok: true, scene: scene.name, actions: actions.length };
  }

  let _lastScheduleMin = '';
  function tickSchedules({ engine, mqttApi, notify } = {}) {
    const now = new Date();
    const hhmm = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    if (hhmm === _lastScheduleMin) return; // already fired this minute
    _lastScheduleMin = hhmm;
    const dow = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon...7=Sun
    const schedules = listSchedules.all();
    for (const sch of schedules) {
      if (!sch.enabled) continue;
      if (sch.time !== hhmm) continue;
      const days = String(sch.days || '1,2,3,4,5,6,7').split(',').map(Number);
      if (!days.includes(dow)) continue;
      activate(sch.scene_id, { engine, mqttApi, notify, triggeredBy: 'schedule' })
        .catch(e => console.error('[SCENES] Schedule trigger failed:', e.message));
    }
  }

  return {
    listScenes:   (site_id) => site_id != null ? listScenesBySite.all(site_id) : listScenes.all(),
    getScene:     (id) => getScene.get(id),
    createScene:  (name, icon, color, actions, site_id) => {
      try {
        const r = insertScene.run(name, icon || "🎬", color || "#6366f1", JSON.stringify(actions || []), site_id ?? null, Date.now());
        return r.lastInsertRowid;
      } catch (e) {
        const isUnique = e.code === 'SQLITE_CONSTRAINT_UNIQUE' || (e.message||'').includes('UNIQUE');
        if (isUnique) { const err = new Error('scene_already_exists'); err.status = 409; throw err; }
        throw e;
      }
    },
    updateScene:  (id, name, icon, color, actions, site_id) => {
      updateScene.run(name, icon || "🎬", color || "#6366f1", JSON.stringify(actions || []), site_id ?? null, id);
    },
    deleteScene:  (id) => {
      deleteSchedulesByScene.run(id);
      deleteScene.run(id);
    },
    activate,
    listLog:      () => listLog.all(),
    tickSchedules,
    listSchedules:          () => listSchedules.all(),
    getSchedulesByScene:    (id) => getSchedulesByScene.all(id),
    createSchedule:         (scene_id, time, days) => insertSchedule.run(scene_id, time, days || '1,2,3,4,5,6,7', 1).lastInsertRowid,
    updateSchedule:         (id, time, days, enabled) => updateSchedule.run(time, days, enabled ? 1 : 0, id),
    deleteSchedule:         (id) => deleteSchedule.run(id),
    deleteSchedulesByScene: (id) => deleteSchedulesByScene.run(id),
  };
}

module.exports = { initScenes };
