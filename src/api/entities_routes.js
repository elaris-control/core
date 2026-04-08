'use strict';
// src/api/entities_routes.js — /api/entities, /api/pending-io, /api/blocked-io
const express = require('express');
const { getCatalogProfile } = require('../esphome/profile_registry');
const { parseEsphomeYaml } = require('../esphome/yaml_importer');
const fs = require('fs');
const { findBoardPort, findBoardBus, matchBoardPathFromText } = require('../esphome/board_port_registry');

function initEntitiesRoutes({ dbApi, requireEngineerAccess }) {
  const router = express.Router();

  // ── Approved entities list ────────────────────────────────────────────
  router.get('/entities', requireEngineerAccess, (req, res) => {
    try {
      const rows = dbApi.db.prepare(`
        SELECT io.id, io.device_id, io.group_name, io.key, io.type, io.name,
               io.zone_id, z.name AS zone_name,
               COALESCE(io.enabled, 1) AS enabled,
               COALESCE(io.pinned, 0) AS pinned,
               io.hw_type, io.kind, io.unit, io.device_class,
               io.source, io.port_id, io.bus_id, io.board_profile_id,
               ds.site_id AS site_id, s.name AS site_name
        FROM io
        LEFT JOIN zones z ON z.id = io.zone_id
        LEFT JOIN device_site ds ON ds.device_id = io.device_id
        LEFT JOIN sites s ON s.id = ds.site_id
        ORDER BY io.device_id, io.group_name, io.key
      `).all();
      res.json({ ok: true, entities: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // ── Pending IO ────────────────────────────────────────────────────────
  router.get('/pending-io', requireEngineerAccess, (req, res) => {
    try {
      if (typeof dbApi.purgeOrphanEspHomeArtifacts === 'function') dbApi.purgeOrphanEspHomeArtifacts();
      if (typeof dbApi.normalizePendingRowsForDevice === 'function') {
        const ids = dbApi.db.prepare(`SELECT DISTINCT device_id FROM pending_io ORDER BY device_id`).all().map(r => String(r.device_id || '').trim()).filter(Boolean);
        for (const id of ids) dbApi.normalizePendingRowsForDevice(id);
      }
      const pending = dbApi.listPendingIO.all();
      const devRows = dbApi.db.prepare(`SELECT name, friendly_name, hostname, board_profile_id, yaml_path, config_source FROM esphome_devices WHERE deleted_at IS NULL`).all();
      const yamlMetaByDevice = new Map();
      for (const dev of devRows) {
        const deviceId = String(dev.name || '').trim();
        const yamlPath = String(dev.yaml_path || '').trim();
        if (!deviceId || !yamlPath || !fs.existsSync(yamlPath)) continue;
        try {
          const parsed = parseEsphomeYaml(fs.readFileSync(yamlPath, 'utf8'));
          const map = new Map();
          for (const ent of Array.isArray(parsed.entityDefaults) ? parsed.entityDefaults : []) {
            const k = String(ent.key || '').trim();
            if (!k) continue;
            map.set(k, ent);
          }
          yamlMetaByDevice.set(deviceId, { parsed, entities: map });
        } catch (_) {}
      }
      const enriched = pending.map((row) => {
        const meta = yamlMetaByDevice.get(String(row.device_id || '').trim());
        const ent = meta?.entities?.get(String(row.key || '').trim()) || null;
        return Object.assign({}, row, ent ? {
          source: ent.source || null,
          port_id: ent.port_id || null,
          bus_id: ent.bus_id || null,
          pin: ent.pin || null,
          entity_name: ent.name || null,
        } : {});
      });
      res.json({ ok: true, pending: enriched });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/pending-io/resync', requireEngineerAccess, (req, res) => {
    try {
      const requested = String(req.body?.device_id || req.body?.deviceId || '').trim();
      if (!requested) return res.status(400).json({ ok: false, error: 'device_id_required' });
      const clearBlocked = !!req.body?.clear_blocked;
      const clearPending = !!req.body?.clear_pending;
      const seedFromProfile = req.body?.seed_from_profile !== false;

      const deviceRow = dbApi.db.prepare(`
        SELECT * FROM esphome_devices
        WHERE deleted_at IS NULL
          AND (
            lower(name)=lower(?) OR
            lower(COALESCE(friendly_name,''))=lower(?) OR
            lower(COALESCE(hostname,''))=lower(?)
          )
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(requested, requested, requested) || null;

      const canonicalDeviceId = String(deviceRow?.name || requested).trim();
      const siteId = deviceRow?.site_id != null ? Number(deviceRow.site_id) : null;
      const rows = dbApi.db.prepare(`SELECT key, value, ts FROM device_state WHERE device_id=? ORDER BY ts DESC`).all(canonicalDeviceId);
      const isBlocked = dbApi.db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
      const isApproved = dbApi.db.prepare(`SELECT 1 FROM io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
      const isApprovedByPath = dbApi.db.prepare(`
        SELECT 1 FROM io WHERE device_id=?
          AND (upper(COALESCE(port_id,''))=upper(?) OR upper(COALESCE(source,''))=upper(?) OR upper(COALESCE(bus_id,''))=upper(?))
        LIMIT 1
      `);
      const upsert = dbApi.db.prepare(`
        INSERT INTO pending_io(device_id, key, group_name, first_seen, last_seen, last_value, site_id)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, group_name, key)
        DO UPDATE SET last_seen=excluded.last_seen, last_value=excluded.last_value, site_id=COALESCE(excluded.site_id, pending_io.site_id)
      `);

      let imported = 0;
      let skipped = 0;
      let scanned = 0;
      let profileSeeded = 0;
      let clearedBlocked = 0;
      let clearedPending = 0;
      const acceptedGroups = new Set(['state', 'tele']);

      if (clearBlocked || clearPending) {
        const reset = typeof dbApi.resetPendingForDevice === 'function'
          ? dbApi.resetPendingForDevice(canonicalDeviceId, { clearBlocked, clearPending })
          : { cleared_blocked: 0, cleared_pending: 0 };
        clearedBlocked = Number(reset?.cleared_blocked || 0);
        clearedPending = Number(reset?.cleared_pending || 0);
      }

      dbApi.db.transaction(() => {
        for (const row of rows) {
          const stateKey = String(row?.key || '').trim();
          if (!stateKey || stateKey.indexOf('.') < 0) { skipped++; continue; }
          const idx = stateKey.indexOf('.');
          const group = stateKey.slice(0, idx).trim();
          const key = stateKey.slice(idx + 1).trim();
          if (!acceptedGroups.has(group) || !key) { skipped++; continue; }
          scanned++;
          const canonical = typeof dbApi.canonicalizePendingIdentity === 'function'
            ? dbApi.canonicalizePendingIdentity({ deviceId: canonicalDeviceId, group, key, boardProfileId: deviceRow?.board_profile_id || null })
            : { group_name: group, key, port_id: null, source: null };
          const finalGroup = String(canonical.group_name || group).trim();
          const finalKey = String(canonical.key || key).trim();
          if (!finalKey) { skipped++; continue; }

          // Skip AO entries in 'tele' group if AO already exists in 'state' (approved or pending)
          if (finalKey.startsWith('ao_') && finalGroup === 'tele') {
            const stateApproved = dbApi.db.prepare(
              `SELECT 1 FROM io WHERE device_id=? AND key=? AND group_name='state' AND (type='ao' OR hw_type='ao') LIMIT 1`
            ).get(canonicalDeviceId, finalKey);
            const statePending = dbApi.db.prepare(
              `SELECT 1 FROM pending_io WHERE device_id=? AND key=? AND group_name='state' LIMIT 1`
            ).get(canonicalDeviceId, finalKey);
            if (stateApproved || statePending) { skipped++; continue; }
          }

          if (isBlocked.get(canonicalDeviceId, finalGroup, finalKey)) { skipped++; continue; }
          if (isApproved.get(canonicalDeviceId, finalGroup, finalKey)) { skipped++; continue; }
          if (canonical.port_id && isApprovedByPath.get(canonicalDeviceId, canonical.port_id, canonical.source || canonical.port_id, canonical.port_id)) { skipped++; continue; }
          const ts = Number(row?.ts) || Date.now();
          upsert.run(canonicalDeviceId, finalKey, finalGroup, ts, ts, row?.value == null ? null : String(row.value), siteId);
          imported++;
        }
      })();

      const deviceConfigSource = String(deviceRow?.config_source || '').trim().toLowerCase();
      const allowProfileSeed = deviceConfigSource !== 'use_my_yaml_overlay' && deviceConfigSource !== 'native_api';

      if (seedFromProfile && allowProfileSeed && deviceRow?.board_profile_id && typeof dbApi.seedPendingFromBoardProfile === 'function') {
        const before = Number(dbApi.db.prepare(`SELECT COUNT(*) AS c FROM pending_io WHERE device_id=?`).get(canonicalDeviceId)?.c || 0);
        dbApi.seedPendingFromBoardProfile(canonicalDeviceId, deviceRow.board_profile_id, Date.now());
        if (typeof dbApi.normalizePendingRowsForDevice === 'function') dbApi.normalizePendingRowsForDevice(canonicalDeviceId);
        const after = Number(dbApi.db.prepare(`SELECT COUNT(*) AS c FROM pending_io WHERE device_id=?`).get(canonicalDeviceId)?.c || 0);
        profileSeeded = Math.max(0, after - before);
      }

      if (seedFromProfile && !allowProfileSeed && deviceRow?.yaml_path) {
        const yamlPath = String(deviceRow.yaml_path || '').trim();
        if (yamlPath && fs.existsSync(yamlPath)) {
          try {
            const parsed = parseEsphomeYaml(fs.readFileSync(yamlPath, 'utf8'));
            const entities = Array.isArray(parsed?.entityDefaults) ? parsed.entityDefaults : [];
            const before = Number(dbApi.db.prepare(`SELECT COUNT(*) AS c FROM pending_io WHERE device_id=?`).get(canonicalDeviceId)?.c || 0);
            dbApi.db.transaction(() => {
              for (const e of entities) {
                const key = String(e?.key || '').trim();
                if (!key) continue;
                const group = ['relay', 'ao', 'analog_out', 'dimmer'].includes(e.type) ? 'state' : 'tele';
                if (isBlocked.get(canonicalDeviceId, group, key)) continue;
                if (isApproved.get(canonicalDeviceId, group, key)) continue;
                const ts = Date.now();
                upsert.run(canonicalDeviceId, key, group, ts, ts, null, siteId);
              }
            })();
            if (typeof dbApi.normalizePendingRowsForDevice === 'function') dbApi.normalizePendingRowsForDevice(canonicalDeviceId);
            const after = Number(dbApi.db.prepare(`SELECT COUNT(*) AS c FROM pending_io WHERE device_id=?`).get(canonicalDeviceId)?.c || 0);
            profileSeeded = Math.max(0, after - before);
          } catch {}
        }
      }

      const note = scanned
        ? null
        : 'No cached MQTT state rows found for this device yet.';

      res.json({
        ok: true,
        device_id: canonicalDeviceId,
        scanned,
        imported,
        skipped,
        profile_seeded: profileSeeded,
        cleared_blocked: clearedBlocked,
        cleared_pending: clearedPending,
        board_profile_id: deviceRow?.board_profile_id || null,
        note,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/pending-io/:id/approve', requireEngineerAccess, (req, res) => {
    try {
      const pending_id = Number(req.params.id);
      const { name, type, zone_id, site_id, entity_class } = req.body || {};
      const source_hint = String(req.body?.source_hint || '').trim();
      let board_profile_id = String(req.body?.board_profile_id || '').trim() || null;
      if (!name || !(type || entity_class)) return res.status(400).json({ ok: false, error: 'missing_fields' });

      let device_id = null;
      let pendingRow = null;
      try {
        pendingRow = dbApi.db.prepare('SELECT * FROM pending_io WHERE id=?').get(pending_id) || null;
        device_id = pendingRow?.device_id || null;
      } catch {}

      let deviceRow = null;
      let deviceConfigSource = '';
      if (device_id) {
        try {
          deviceRow = dbApi.db.prepare(`
            SELECT board_profile_id, config_source, yaml_path
            FROM esphome_devices
            WHERE name=? OR friendly_name=? OR hostname=?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
          `).get(device_id, device_id, device_id) || null;

          if (!board_profile_id) {
            board_profile_id = String(deviceRow?.board_profile_id || '').trim() || null;
          }
          deviceConfigSource = String(deviceRow?.config_source || '').trim().toLowerCase();
        } catch {}
      }

      let source = null;
      let port_id = null;
      let bus_id = null;

      const isYamlOverlay = deviceConfigSource === 'use_my_yaml_overlay';

      if (isYamlOverlay) {
        let yamlMeta = null;

        try {
          const yamlPath = String(deviceRow?.yaml_path || '').trim();
          if (yamlPath && fs.existsSync(yamlPath)) {
            const parsed = parseEsphomeYaml(fs.readFileSync(yamlPath, 'utf8'));
            const wantedKey = String(pendingRow?.key || '').trim();
            if (wantedKey) {
              yamlMeta = (Array.isArray(parsed?.entityDefaults) ? parsed.entityDefaults : [])
                .find(e => String(e?.key || '').trim() === wantedKey) || null;
            }
          }
        } catch {}

        source = String(
          yamlMeta?.source ||
          yamlMeta?.port_id ||
          yamlMeta?.bus_id ||
          yamlMeta?.pin ||
          ''
        ).trim() || null;

        port_id = String(
          yamlMeta?.port_id ||
          yamlMeta?.pin ||
          ''
        ).trim() || null;

        bus_id = String(
          yamlMeta?.bus_id ||
          ''
        ).trim() || null;

        board_profile_id = null;
      } else {
        source = source_hint || null;

        if (board_profile_id) {
          const profile = getCatalogProfile(dbApi.db, board_profile_id);
          if (profile) {
            const preferClass = String(entity_class || '').trim().toUpperCase() || null;
            let port = source_hint ? findBoardPort(profile, source_hint) : null;
            let bus = (!port && source_hint) ? findBoardBus(profile, source_hint) : null;
            let matched = null;

            if (!port && !bus) {
              matched = matchBoardPathFromText(
                profile,
                [source_hint, pendingRow?.key, `${pendingRow?.group_name || ''}.${pendingRow?.key || ''}`],
                { entityClass: preferClass }
              );
              if (matched?.kind === 'port') port = matched.port;
              else if (matched?.kind === 'bus') bus = matched.bus;
            }

            if (port) {
              port_id = String(port.id || source_hint || matched?.source || '').trim() || null;
              source = String(port.id || source_hint || matched?.source || '').trim() || null;
            } else if (bus) {
              bus_id = String(bus.id || source_hint || matched?.source || '').trim() || null;
              source = String(bus.id || source_hint || matched?.source || '').trim() || null;
            }
          }
        }
      }

      const klass = String(entity_class || '').trim().toUpperCase();
      let finalType = type;
      let hw_type = null;
      let kind = null;
      let unit = null;
      if (klass === 'DO') { finalType = 'relay'; hw_type = 'relay'; kind = 'relay'; }
      else if (klass === 'DI') { finalType = 'sensor'; hw_type = 'di'; kind = 'digital_input'; }
      else if (klass === 'AI') { finalType = 'sensor'; hw_type = 'analog'; kind = 'analog_input'; }
      else if (klass === 'AO') { finalType = 'ao'; hw_type = 'ao'; kind = 'analog_output'; }

      // Prevent approving AO in tele group if AO already exists in state group
      if (finalType === 'ao' && pendingRow?.group_name === 'tele') {
        const stateAOExists = dbApi.db.prepare(
          `SELECT 1 FROM io WHERE device_id=? AND key=? AND group_name='state' AND (type='ao' OR hw_type='ao') LIMIT 1`
        ).get(device_id, pendingRow.key);
        if (stateAOExists) {
          return res.status(400).json({ ok: false, error: 'AO already exists in state group, cannot approve in tele' });
        }
      }

      const out = dbApi.approvePending({
        pending_id,
        name,
        type: finalType,
        zone_id,
        hw_type,
        kind,
        unit,
        source,
        port_id,
        bus_id,
        board_profile_id
      });

      const sid = (site_id === undefined || site_id === null || site_id === '') ? null : Number(site_id);
      if (sid && Number.isFinite(sid) && device_id && dbApi.assignDeviceToSite) {
        dbApi.assignDeviceToSite(device_id, sid);
      }

      res.json({ ok: true, ...out });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/pending-io/by-device/:device_id', requireEngineerAccess, (req, res) => {
    const deviceId = String(req.params.device_id || '').trim();
    if (!deviceId) return res.status(400).json({ ok: false, error: 'invalid_device_id' });
    try {
      const result = dbApi.db.prepare('DELETE FROM pending_io WHERE device_id=?').run(deviceId);
      res.json({ ok: true, removed: result.changes });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete('/pending-io/:id', requireEngineerAccess, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'invalid_id' });
    }
    try {
      dbApi.deletePendingIOAndBlock(id);
      res.json({ ok: true });
    } catch (e) {
      if (String(e?.message || e) === 'pending_not_found' || (e?.message || '').includes('not found')) {
        return res.status(404).json({ ok: false, error: 'pending_not_found' });
      }
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── Blocked IO ────────────────────────────────────────────────────────
  router.get('/blocked-io', requireEngineerAccess, (req, res) => {
    try {
      const rows = dbApi.db.prepare(
        `SELECT device_id, group_name, key, created_ts, reason FROM blocked_io WHERE COALESCE(hidden,0)=0 ORDER BY created_ts DESC`
      ).all();
      res.json({ ok: true, blocked: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.post('/blocked-io', requireEngineerAccess, (req, res) => {
    try {
      const device_id  = String(req.body?.device_id  || '').trim();
      const group_name = String(req.body?.group_name || '').trim();
      const key        = String(req.body?.key        || '').trim();
      const reason     = req.body?.reason == null ? null : String(req.body.reason);
      if (!device_id || !group_name || !key) return res.status(400).json({ ok: false, error: 'missing_fields' });
      dbApi.db.prepare(
        `INSERT OR REPLACE INTO blocked_io(device_id, group_name, key, created_ts, reason, hidden) VALUES(?,?,?,?,?,0)`
      ).run(device_id, group_name, key, Date.now(), reason);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.post('/blocked-io/hide', requireEngineerAccess, (req, res) => {
    try {
      const device_id  = String(req.body?.device_id  || '').trim();
      const group_name = String(req.body?.group_name || '').trim();
      const key        = String(req.body?.key        || '').trim();
      if (!device_id || !group_name || !key) return res.status(400).json({ ok: false, error: 'missing_fields' });
      const info = dbApi.hideBlockedIO.run(device_id, group_name, key);
      res.json({ ok: true, changes: info.changes || 0 });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/blocked-io', requireEngineerAccess, (req, res) => {
    try {
      const device_id  = String(req.body?.device_id  || '').trim();
      const group_name = String(req.body?.group_name || '').trim();
      const key        = String(req.body?.key        || '').trim();
      if (!device_id || !group_name || !key) return res.status(400).json({ ok: false, error: 'missing_fields' });
      const info = dbApi.db.prepare(
        `DELETE FROM blocked_io WHERE device_id=? AND group_name=? AND key=?`
      ).run(device_id, group_name, key);
      res.json({ ok: true, changes: info.changes || 0 });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  return router;
}

module.exports = { initEntitiesRoutes };