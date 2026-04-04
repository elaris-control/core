// src/core/db/esphome_queries.js
// ESPHome device registry, identity management, orphan cleanup.
// Receives `db` and creates all its own prepared statements.

function createEspHomeQueries(db, { getProfile, getCatalogProfile, findBoardPort, ensureProfileCatalogTables, seedProfileCatalog }) {
  // ── Prepared statements ───────────────────────────────────────────────────
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

  // IO lookup statements (used by identity logic)
  const isApprovedIO = db.prepare(`SELECT 1 FROM io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const isBlockedIO = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  const findApprovedIOByPath = db.prepare(`
    SELECT 1 FROM io
    WHERE device_id=?
      AND (upper(COALESCE(port_id,''))=upper(?) OR upper(COALESCE(source,''))=upper(?) OR upper(COALESCE(bus_id,''))=upper(?))
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
  const markAllIoStale = db.prepare(`UPDATE io SET stale=1 WHERE device_id=?`);
  const clearIoStale = db.prepare(`UPDATE io SET stale=0 WHERE device_id=? AND group_name=? AND key=?`);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getRuntimeBoardProfile(boardProfileId) {
    const id = String(boardProfileId || '').trim();
    if (!id) return null;
    return getCatalogProfile(db, id) || getProfile(id) || null;
  }

  function getDeviceEspHomeRow(deviceId) {
    const id = String(deviceId || '').trim();
    if (!id) return null;
    return getEspHomeByName.get(id) || getEspHomeAnyByName.get(id) || null;
  }

  function getDeviceBoardProfileId(deviceId) {
    const row = getDeviceEspHomeRow(deviceId);
    return row?.board_profile_id ? String(row.board_profile_id).trim() : null;
  }

  function canonicalGroupFromPortGroup(group, fallback) {
    const g = String(group || '').trim().toLowerCase();
    if (g === 'do' || g === 'ao') return 'state';
    if (g) return 'tele';
    return String(fallback || '').trim().toLowerCase() === 'state' ? 'state' : 'tele';
  }

  function canonicalizePendingIdentity({ deviceId, group, key, source = null, boardProfileId = null } = {}) {
    const rawGroup = String(group || '').trim().toLowerCase() || 'tele';
    const rawKey = String(key || '').trim();
    const rawSource = String(source || '').trim();
    const deviceRow = getDeviceEspHomeRow(deviceId);
    const configSource = String(deviceRow?.config_source || '').trim().toLowerCase();
    if (configSource === 'use_my_yaml_overlay') {
      return {
        group_name: rawGroup === 'state' ? 'state' : 'tele',
        key: rawKey, source: rawSource || null, port_id: rawSource || null,
        board_profile_id: deviceRow?.board_profile_id ? String(deviceRow.board_profile_id).trim() : null,
        canonical: false,
      };
    }
    const resolvedProfileId = String(boardProfileId || getDeviceBoardProfileId(deviceId) || '').trim();
    const profile = getRuntimeBoardProfile(resolvedProfileId);
    if (!profile || (!rawKey && !rawSource)) {
      return {
        group_name: rawGroup === 'state' ? 'state' : 'tele',
        key: rawKey, source: rawSource || null, port_id: null,
        board_profile_id: resolvedProfileId || null, canonical: false,
      };
    }

    const port = findBoardPort(profile, [rawSource, rawKey]);
    if (!port) {
      if (!rawSource && rawKey && Array.isArray(profile.entityDefaults)) {
        const def = profile.entityDefaults.find(e => String(e.key || '').trim() === rawKey);
        if (def?.source) {
          const altPort = findBoardPort(profile, def.source);
          if (altPort) {
            const canonicalKey = String(altPort.id || altPort.label || rawKey || '').trim() || rawKey;
            return {
              group_name: canonicalGroupFromPortGroup(altPort.group, rawGroup),
              key: canonicalKey, source: canonicalKey, port_id: canonicalKey,
              board_profile_id: resolvedProfileId || null, canonical: true,
              port_group: String(altPort.group || '').trim().toLowerCase() || null,
              raw_key: rawKey || null, raw_source: null,
            };
          }
        }
      }
      return {
        group_name: rawGroup === 'state' ? 'state' : 'tele',
        key: rawKey, source: rawSource || null, port_id: null,
        board_profile_id: resolvedProfileId || null, canonical: false,
      };
    }

    const canonicalKey = String(port.id || port.label || rawKey || rawSource || '').trim() || rawKey;
    return {
      group_name: canonicalGroupFromPortGroup(port.group, rawGroup),
      key: canonicalKey, source: canonicalKey, port_id: canonicalKey,
      board_profile_id: resolvedProfileId || null, canonical: true,
      port_group: String(port.group || '').trim().toLowerCase() || null,
      raw_key: rawKey || null, raw_source: rawSource || null,
    };
  }

  function normalizePendingRowsForDevice(deviceId) {
    const id = String(deviceId || '').trim();
    if (!id) return { ok: false, device_id: id, before: 0, after: 0, deduped: 0 };
    const rows = db.prepare(`SELECT * FROM pending_io WHERE device_id=? ORDER BY last_seen DESC, id DESC`).all(id);
    if (!rows.length) return { ok: true, device_id: id, before: 0, after: 0, deduped: 0 };

    const aggregated = new Map();
    for (const row of rows) {
      const meta = canonicalizePendingIdentity({ deviceId: id, group: row.group_name, key: row.key });
      const canonicalGroup = String(meta.group_name || row.group_name || 'tele').trim();
      const canonicalKey = String(meta.key || row.key || '').trim();
      if (!canonicalKey) continue;
      const mapKey = `${canonicalGroup}::${canonicalKey}`;
      const firstSeen = Number(row.first_seen) || Number(row.last_seen) || Date.now();
      const lastSeen = Number(row.last_seen) || firstSeen;
      const siteId = row.site_id == null ? null : row.site_id;
      const current = aggregated.get(mapKey);
      if (!current) {
        aggregated.set(mapKey, {
          device_id: id, group_name: canonicalGroup, key: canonicalKey,
          first_seen: firstSeen, last_seen: lastSeen,
          last_value: row.last_value == null ? null : String(row.last_value),
          site_id: siteId,
        });
        continue;
      }
      current.first_seen = Math.min(current.first_seen, firstSeen);
      if (lastSeen >= current.last_seen) {
        current.last_seen = lastSeen;
        current.last_value = row.last_value == null ? current.last_value : String(row.last_value);
      }
      if (current.site_id == null && siteId != null) current.site_id = siteId;
    }

    db.transaction(() => {
      db.prepare(`DELETE FROM pending_io WHERE device_id=?`).run(id);
      for (const row of aggregated.values()) {
        if (isApprovedIO.get(id, row.group_name, row.key)) continue;
        upsertPendingIOWithSite.run(row);
      }
    })();

    return { ok: true, device_id: id, before: rows.length, after: aggregated.size, deduped: Math.max(0, rows.length - aggregated.size) };
  }

  function seedPendingFromBoardProfile(deviceId, boardProfileId, ts) {
    const profile = getRuntimeBoardProfile(boardProfileId);
    const defaults = Array.isArray(profile?.entityDefaults) ? profile.entityDefaults : [];
    for (const e of defaults) {
      const group = e.type === 'relay' ? 'state' : 'tele';
      const canonical = canonicalizePendingIdentity({ deviceId, group, key: e.key, source: e.source || e.port_id || e.bus_id || e.pin || null, boardProfileId });
      const alreadyApproved = isApprovedIO.get(deviceId, canonical.group_name, canonical.key)
        || (canonical.port_id && findApprovedIOByPath.get(deviceId, canonical.port_id, canonical.source || canonical.port_id, canonical.port_id));
      if (alreadyApproved) continue;
      if (isBlockedIO.get(deviceId, canonical.group_name, canonical.key)) continue;
      upsertPendingIO.run({ device_id: deviceId, group_name: canonical.group_name, key: canonical.key, ts, last_value: null });
    }
    normalizePendingRowsForDevice(deviceId);
  }

  function noteDeviceAndMaybePendingIO({ deviceId, group, key, value, ts, retained, allowRetained = false, source = null, boardProfileId = null }) {
    if (retained && !allowRetained) return { ok: false, reason: 'retained_ignored' };
    const rawGroup = String(group || '').trim().toLowerCase();
    if (rawGroup === 'cmnd') return { ok: false, reason: 'command_topic_ignored' };

    const canonical = canonicalizePendingIdentity({ deviceId, group, key, source, boardProfileId });
    const finalGroup = canonical.group_name;
    const finalKey = canonical.key;

    if (isApprovedIO.get(deviceId, finalGroup, finalKey)) return { ok: false, reason: 'already_approved' };
    if (canonical.port_id && findApprovedIOByPath.get(deviceId, canonical.port_id, canonical.source || canonical.port_id, canonical.port_id)) {
      return { ok: false, reason: 'already_approved' };
    }
    if (isBlockedIO.get(deviceId, finalGroup, finalKey)) return { ok: false, reason: 'blocked' };

    upsertPendingIO.run({ device_id: deviceId, key: finalKey, group_name: finalGroup, source: canonical.source || null, ts, last_value: value });
    normalizePendingRowsForDevice(deviceId);
    return { ok: true, reason: 'pending_upserted', canonical };
  }

  function noteDeviceConfig({ deviceId, config, ts, retained, ensureDeviceAssigned, upsertEspHomeRegistry }) {
    if (!config || !deviceId) return;
    ensureDeviceAssigned(deviceId);
    const entities = Array.isArray(config.entities) ? config.entities : [];
    const boardProfileId = String(config?.board_profile_id || getDeviceBoardProfileId(deviceId) || '').trim() || null;

    const reportedKeys = [];
    for (const e of entities) {
      if (!e?.key) continue;
      const group = e.group || (e.type === 'relay' ? 'state' : 'tele');
      const canonical = canonicalizePendingIdentity({ deviceId, group, key: e.key, source: e.source || e.port_id || e.bus_id || e.pin || null, boardProfileId });
      reportedKeys.push({ group_name: canonical.group_name, key: canonical.key });
      if (isApprovedIO.get(deviceId, canonical.group_name, canonical.key)) continue;
      if (canonical.port_id && findApprovedIOByPath.get(deviceId, canonical.port_id, canonical.source || canonical.port_id, canonical.port_id)) continue;
      if (isBlockedIO.get(deviceId, canonical.group_name, canonical.key)) continue;
      upsertPendingIO.run({ device_id: deviceId, key: canonical.key, group_name: canonical.group_name, source: canonical.source || null, ts, last_value: null });
    }

    if (reportedKeys.length > 0) {
      db.transaction(() => {
        markAllIoStale.run(deviceId);
        for (const { group_name, key } of reportedKeys) {
          clearIoStale.run(deviceId, group_name, key);
        }
      })();
    }

    normalizePendingRowsForDevice(deviceId);
    upsertEspHomeRegistry({ deviceId, retained, reviveDeleted: !retained, ts });
  }

  function upsertEspHomeRegistry({ deviceId, friendlyName = null, status = 'online', hostname = null, firmwareVersion = null, transport = null, networkMode = null, macAddress = null, ipAddress = null, retained = false, reviveDeleted = false, ts = Date.now() }, ensureDeviceAssigned) {
    const site = ensureDeviceAssigned(deviceId);
    const topicRoot = `elaris/${deviceId}`;
    const nowIso = new Date(Number.isFinite(Number(ts)) ? Number(ts) : Date.now()).toISOString();
    const visibleRow = getEspHomeByName.get(deviceId) || getEspHomeByTopicRoot.get(topicRoot);
    const anyRow = visibleRow || getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot);

    if (!visibleRow && !anyRow && retained) return null;
    if (anyRow?.deleted_at && !reviveDeleted) return { id: anyRow.id, suppressed: true, deleted_at: anyRow.deleted_at };

    let row = visibleRow || anyRow || null;
    const effectiveLastSeen = retained ? (row?.last_seen_at || nowIso) : nowIso;
    const shouldRevive = !!(row?.deleted_at && reviveDeleted);
    if (!row) {
      const inserted = insertEspHomeDevice.run(
        site.site_id, deviceId, friendlyName || deviceId, 'mqtt_discovered',
        null, null, transport, networkMode, retained ? 'seen' : status,
        null, macAddress, ipAddress, hostname, topicRoot, firmwareVersion,
        null, null, null, effectiveLastSeen, nowIso, nowIso,
      );
      row = { id: inserted.lastInsertRowid };
    } else {
      updateEspHomeDevice.run(
        friendlyName, retained ? (row.status || 'seen') : status,
        hostname, firmwareVersion, topicRoot, transport, networkMode,
        macAddress, ipAddress, effectiveLastSeen, nowIso,
        shouldRevive ? 1 : 0, shouldRevive ? 1 : 0, row.id,
      );
    }
    return row.id ? { id: row.id } : row;
  }

  function touchEspHomeRegistry(deviceId, { status = 'online', ts = Date.now(), friendlyName = null, hostname = null, firmwareVersion = null, transport = null, networkMode = null, macAddress = null, ipAddress = null } = {}, ensureDeviceAssigned) {
    if (!deviceId) return null;
    return upsertEspHomeRegistry({
      deviceId, friendlyName, status, hostname, firmwareVersion,
      transport, networkMode, macAddress, ipAddress,
      retained: false, reviveDeleted: false, ts,
    }, ensureDeviceAssigned);
  }

  function isEspHomeRegistrySuppressed(deviceId) {
    const topicRoot = `elaris/${deviceId}`;
    const row = getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot) || null;
    return !!(row && row.deleted_at);
  }

  function _repointEsphomeChildren(canonicalId, dupIds) {
    if (!canonicalId || !Array.isArray(dupIds) || !dupIds.length) return;
    const placeholders = dupIds.map(() => '?').join(',');
    db.prepare(`UPDATE esphome_generated_configs SET esphome_device_id=? WHERE esphome_device_id IN (${placeholders})`).run(canonicalId, ...dupIds);
    db.prepare(`UPDATE esphome_install_jobs SET esphome_device_id=? WHERE esphome_device_id IN (${placeholders})`).run(canonicalId, ...dupIds);
    db.prepare(`UPDATE esphome_device_overrides SET esphome_device_id=? WHERE esphome_device_id IN (${placeholders})`).run(canonicalId, ...dupIds);
  }

  function _cleanupEsphomeDuplicatesForCanonical(canonicalId) {
    if (!canonicalId) return [];
    const canonical = db.prepare('SELECT * FROM esphome_devices WHERE id=?').get(canonicalId);
    if (!canonical) return [];
    const norm = (v) => String(v || '').trim().toLowerCase();
    const strong = new Set([canonical.mac_address, canonical.ip_address, canonical.serial_port, canonical.hostname, canonical.mqtt_topic_root].map(norm).filter(Boolean));
    if (!strong.size) return [];
    const rows = db.prepare('SELECT * FROM esphome_devices WHERE id<>? ORDER BY updated_at DESC, id DESC').all(canonicalId);
    const dupIds = [];
    for (const row of rows) {
      const hits = [row.mac_address, row.ip_address, row.serial_port, row.hostname, row.mqtt_topic_root].map(norm).filter(Boolean);
      if (hits.some(v => strong.has(v))) dupIds.push(row.id);
    }
    if (!dupIds.length) return [];
    db.transaction(() => {
      _repointEsphomeChildren(canonicalId, dupIds);
      db.prepare(`UPDATE esphome_devices SET deleted_at=?, deleted_reason=?, status=?, updated_at=? WHERE id IN (${dupIds.map(() => '?').join(',')})`).run(new Date().toISOString(), 'merged_duplicate', 'deleted', new Date().toISOString(), ...dupIds)
    })()
    return dupIds;
  }

  function _purgeOldEsphomeIdentityRowsByIds(deviceRows) {
    const rows = Array.isArray(deviceRows) ? deviceRows.filter(Boolean) : [];
    if (!rows.length) return { ok: true, purged: [] };
    const purged = [];
    db.transaction(() => {
      for (const row of rows) {
        const deviceId = String(row.name || '').trim();
        if (!deviceId) continue;
        const ioIds = db.prepare(`SELECT id FROM io WHERE device_id=?`).all(deviceId).map(r => Number(r.id)).filter(Boolean);
        if (ioIds.length) {
          const qm = ioIds.map(() => '?').join(',');
          try { db.prepare(`DELETE FROM module_mappings WHERE io_id IN (${qm})`).run(...ioIds); } catch (_) {}
          try { db.prepare(`DELETE FROM io_runtime_overrides WHERE io_id IN (${qm})`).run(...ioIds); } catch (_) {}
          const ioIdSet = new Set(ioIds);
          let patchScene = null;
          try { patchScene = db.prepare('UPDATE scenes SET actions_json=? WHERE id=?'); } catch (_) { patchScene = null; }
          if (patchScene) {
            for (const scene of db.prepare('SELECT id, actions_json FROM scenes').all()) {
              let actions; try { actions = JSON.parse(scene.actions_json || '[]'); } catch (_) { continue; }
              let changed = false;
              actions = actions.map(a => {
                if (a && a.type === 'send_command' && ioIdSet.has(Number(a.io_id))) { changed = true; return { ...a, io_id: null }; }
                return a;
              });
              if (changed) patchScene.run(JSON.stringify(actions), scene.id);
            }
          }
        }
        db.prepare('DELETE FROM io WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM pending_io WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM blocked_io WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM device_state WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM device_site WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM events WHERE device_id=?').run(deviceId);
        db.prepare('DELETE FROM esphome_install_jobs WHERE esphome_device_id=?').run(row.id);
        db.prepare('DELETE FROM esphome_generated_configs WHERE esphome_device_id=?').run(row.id);
        db.prepare('DELETE FROM esphome_device_overrides WHERE esphome_device_id=?').run(row.id);
        db.prepare('DELETE FROM esphome_devices WHERE id=?').run(row.id);
        purged.push({ id: row.id, device_id: deviceId, mqtt_topic_root: String(row.mqtt_topic_root || '').trim() || null });
      }
    })();
    return { ok: true, purged };
  }

  function purgeEsphomeSameMacDuplicates(deviceId, macAddress) {
    const topicRoot = `elaris/${deviceId}`;
    const row = getEspHomeAnyByName.get(deviceId) || getEspHomeAnyByTopicRoot.get(topicRoot) || null;
    const mac = String(macAddress || '').trim().toLowerCase();
    if (!row || row.deleted_at || !mac) return { ok: true, purged: [] };
    const dupRows = db.prepare(`SELECT id, name, mqtt_topic_root FROM esphome_devices WHERE id<>? AND deleted_at IS NULL AND lower(trim(coalesce(mac_address,'')))=? ORDER BY updated_at DESC, id DESC`).all(row.id, mac);
    let out = { ok: true, purged: [] };
    if (dupRows.length) out = _purgeOldEsphomeIdentityRowsByIds(dupRows);
    try { purgeOrphanEspHomeArtifacts(); } catch (_) {}
    return out;
  }

  function purgeOrphanEspHomeArtifacts() {
    const active = new Set(db.prepare(`SELECT name FROM esphome_devices WHERE deleted_at IS NULL`).all().map(r => String(r.name || '').trim()).filter(Boolean));
    if (!active.size) return { ok: true, purged: [] };
    const seen = new Set();
    const collect = (table) => {
      try {
        db.prepare(`SELECT DISTINCT device_id FROM ${table}`).all().forEach(r => {
          const id = String(r.device_id || '').trim();
          if (id && !active.has(id)) seen.add(id);
        });
      } catch (_) {}
    };
    ['pending_io', 'blocked_io', 'io', 'device_state', 'events', 'device_site'].forEach(collect);
    const purged = Array.from(seen);
    if (!purged.length) return { ok: true, purged: [] };
    db.transaction(() => {
      for (const id of purged) {
        db.prepare('DELETE FROM pending_io WHERE device_id=?').run(id);
        db.prepare('DELETE FROM blocked_io WHERE device_id=?').run(id);
        db.prepare('DELETE FROM io WHERE device_id=?').run(id);
        db.prepare('DELETE FROM device_state WHERE device_id=?').run(id);
        db.prepare('DELETE FROM device_site WHERE device_id=?').run(id);
        db.prepare('DELETE FROM events WHERE device_id=?').run(id);
      }
    })();
    return { ok: true, purged };
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
    try { _cleanupEsphomeDuplicatesForCanonical(row.id); } catch (_) {}
    try { purgeOrphanEspHomeArtifacts(); } catch (_) {}
    return row.id;
  }

  return {
    getDeviceEspHomeRow,
    getDeviceBoardProfileId,
    canonicalizePendingIdentity,
    normalizePendingRowsForDevice,
    seedPendingFromBoardProfile,
    noteDeviceAndMaybePendingIO,
    noteDeviceConfig,
    upsertEspHomeRegistry,
    touchEspHomeRegistry,
    isEspHomeRegistrySuppressed,
    purgeEsphomeSameMacDuplicates,
    purgeOrphanEspHomeArtifacts,
    updateEspHomeIdentity,
  };
}

module.exports = { createEspHomeQueries };
