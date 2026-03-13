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
  `);

  const listScenes   = db.prepare(`SELECT * FROM scenes ORDER BY id ASC`);
  const getScene     = db.prepare(`SELECT * FROM scenes WHERE id = ?`);
  const insertScene  = db.prepare(`INSERT INTO scenes(name,icon,color,actions_json,created_ts) VALUES(?,?,?,?,?)`);
  const updateScene  = db.prepare(`UPDATE scenes SET name=?,icon=?,color=?,actions_json=? WHERE id=?`);
  const deleteScene  = db.prepare(`DELETE FROM scenes WHERE id=?`);
  const insertLog    = db.prepare(`INSERT INTO scene_log(scene_id,scene_name,triggered_by,ts) VALUES(?,?,?,?)`);
  const listLog      = db.prepare(`SELECT * FROM scene_log ORDER BY ts DESC LIMIT 50`);

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
        }
      } catch (e) {
        console.error(`[SCENES] Action failed in scene ${scene.name}:`, e.message);
      }
    }

    insertLog.run(sceneId, scene.name, triggeredBy, Date.now());
    console.log(`[SCENES] "${scene.name}" activated by ${triggeredBy}`);
    return { ok: true, scene: scene.name, actions: actions.length };
  }

  return {
    listScenes:   () => listScenes.all(),
    getScene:     (id) => getScene.get(id),
    createScene:  (name, icon, color, actions) => {
      const r = insertScene.run(name, icon || "🎬", color || "#6366f1", JSON.stringify(actions || []), Date.now());
      return r.lastInsertRowid;
    },
    updateScene:  (id, name, icon, color, actions) => {
      updateScene.run(name, icon || "🎬", color || "#6366f1", JSON.stringify(actions || []), id);
    },
    deleteScene:  (id) => deleteScene.run(id),
    activate,
    listLog:      () => listLog.all(),
  };
}

module.exports = { initScenes };
