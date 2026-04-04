// src/core/db/queries.js
// Prepared statements + CRUD functions for core platform operations.

function createQueries(db) {
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
  const getDeviceSiteStmt = db.prepare(`SELECT site_id FROM device_site WHERE device_id=?`);
  const upsertState = db.prepare(`
    INSERT INTO device_state (device_id, key, value, ts) VALUES (@device_id, @key, @value, @ts)
    ON CONFLICT(device_id, key) DO UPDATE SET value=excluded.value, ts=excluded.ts
  `);

  // ── App settings ──────────────────────────────────────────────────────────
  const getAppSettingStmt = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`);
  const setAppSettingStmt = db.prepare(`
    INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
  `);
  const deleteAppSettingStmt = db.prepare(`DELETE FROM app_settings WHERE key = ?`);

  function getAppSetting(key, fallback = null) {
    const row = getAppSettingStmt.get(String(key || '').trim());
    return row ? row.value : fallback;
  }

  function setAppSetting(key, value, ts = Date.now()) {
    const k = String(key || '').trim();
    if (!k) return { ok: false, error: 'missing_key' };
    if (value == null) {
      deleteAppSettingStmt.run(k);
      return { ok: true, deleted: true };
    }
    setAppSettingStmt.run(k, String(value), Number.isFinite(Number(ts)) ? Number(ts) : Date.now());
    return { ok: true };
  }

  function getBoolAppSetting(key, fallback = false) {
    const raw = getAppSetting(key, null);
    if (raw == null) return !!fallback;
    const v = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(v)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(v)) return false;
    return !!fallback;
  }

  // ── Zones ─────────────────────────────────────────────────────────────────
  const listZones = db.prepare(`SELECT * FROM zones ORDER BY name`);
  const listZonesBySite = db.prepare(`SELECT * FROM zones WHERE site_id=? ORDER BY name`);
  const createZone = db.prepare(`INSERT OR IGNORE INTO zones (name, site_id) VALUES (?,?)`);
  const renameZoneStmt = db.prepare(`UPDATE zones SET name=? WHERE id=?`);
  const deleteZoneStmt = db.prepare(`DELETE FROM zones WHERE id=?`);
  const moveIOZone = db.prepare(`UPDATE io SET zone_id=? WHERE zone_id=?`);
  const clearIOZone = db.prepare(`UPDATE io SET zone_id=NULL WHERE zone_id=?`);
  const countIOByZone = db.prepare(`SELECT COUNT(*) AS c FROM io WHERE zone_id=?`);

  // ── Sites ─────────────────────────────────────────────────────────────────
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

  // ── Pending IO ────────────────────────────────────────────────────────────
  const listPendingIO = db.prepare(`SELECT * FROM pending_io ORDER BY device_id, group_name, key COLLATE NOCASE`);
  const isApprovedIO = db.prepare(`SELECT 1 FROM io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const isBlockedIO = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const findApprovedIOByPath = db.prepare(`
    SELECT 1 FROM io
    WHERE device_id=?
      AND (
        upper(COALESCE(port_id,''))=upper(?) OR
        upper(COALESCE(source,''))=upper(?) OR
        upper(COALESCE(bus_id,''))=upper(?)
      )
    LIMIT 1
  `);
  const upsertPendingIO = db.prepare(`
    INSERT INTO pending_io (device_id, key, group_name, source, first_seen, last_seen, last_value)
    VALUES (@device_id, @key, @group_name, @source, @ts, @ts, @last_value)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET last_seen=excluded.last_seen, last_value=excluded.last_value, source=COALESCE(excluded.source, pending_io.source)
  `);
  const upsertPendingIOWithSite = db.prepare(`
    INSERT INTO pending_io (device_id, key, group_name, first_seen, last_seen, last_value, site_id)
    VALUES (@device_id, @key, @group_name, @first_seen, @last_seen, @last_value, @site_id)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET
      first_seen=MIN(pending_io.first_seen, excluded.first_seen),
      last_seen=MAX(pending_io.last_seen, excluded.last_seen),
      last_value=COALESCE(excluded.last_value, pending_io.last_value),
      site_id=COALESCE(excluded.site_id, pending_io.site_id)
  `);
  const hideBlockedIO = db.prepare(`UPDATE blocked_io SET hidden=1 WHERE device_id=? AND group_name=? AND key=?`);
  const markAllIoStale = db.prepare(`UPDATE io SET stale=1 WHERE device_id=?`);
  const clearIoStale = db.prepare(`UPDATE io SET stale=0 WHERE device_id=? AND group_name=? AND key=?`);
  const listStaleIO = db.prepare(`SELECT id FROM io WHERE device_id=? AND stale=1`);
  const deleteStaleIO = db.prepare(`DELETE FROM io WHERE id=?`);
  const deleteModMapById = db.prepare(`DELETE FROM module_mappings WHERE io_id=?`);

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

  function resetPendingForDevice(deviceId, { clearBlocked = true, clearPending = true } = {}) {
    const id = String(deviceId || '').trim();
    if (!id) return { ok: false, error: 'device_required', cleared_blocked: 0, cleared_pending: 0 };
    let clearedBlocked = 0;
    let clearedPending = 0;
    db.transaction(() => {
      if (clearBlocked) clearedBlocked = db.prepare(`DELETE FROM blocked_io WHERE device_id=?`).run(id).changes || 0;
      if (clearPending) clearedPending = db.prepare(`DELETE FROM pending_io WHERE device_id=?`).run(id).changes || 0;
    })();
    return { ok: true, device_id: id, cleared_blocked: clearedBlocked, cleared_pending: clearedPending };
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
    `).run(row.device_id, row.key, row.group_name, type || 'sensor', name, zone_id || null, ts, hw_type || null, kind || null, unit || null, source || null, port_id || null, bus_id || null, board_profile_id || null);
    db.prepare(`DELETE FROM pending_io WHERE id=?`).run(pending_id);
    return { ok: true, io_id: info.lastInsertRowid };
  }

  function removeStaleIO(deviceId) {
    const rows = listStaleIO.all(deviceId);
    db.transaction(() => {
      for (const { id } of rows) {
        deleteModMapById.run(id);
        deleteStaleIO.run(id);
      }
    })();
    return rows.length;
  }

  return {
    insertEvent,
    getDeviceState,
    listDevicesFromState,
    listIOByDevice,
    listPinnedIOWithState,
    upsertState,
    getDeviceSiteStmt,

    getAppSetting,
    setAppSetting,
    getBoolAppSetting,

    listZones,
    listZonesBySite,
    createZone,
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

    listPendingIO,
    isApprovedIO,
    isBlockedIO,
    findApprovedIOByPath,
    upsertPendingIO,
    upsertPendingIOWithSite,
    hideBlockedIO,
    markAllIoStale,
    clearIoStale,
    listStaleIO,
    deleteStaleIO,
    deleteModMapById,
    deletePendingIO,
    deletePendingIOAndBlock,
    unblockPendingIO,
    resetPendingForDevice,
    approvePending,
    removeStaleIO,
  };
}

module.exports = { createQueries };
