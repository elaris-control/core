'use strict';
// src/api/admin_routes.js — /api/admin/*
const express = require('express');

function initAdminRoutes({ db, users, requireAdmin }) {
  const router = express.Router();

  // ── Users ──────────────────────────────────────────────────────────────
  router.get('/users', requireAdmin, (req, res) => {
    res.json({ ok: true, users: users.listUsers.all() });
  });

  router.patch('/users/:id/role', requireAdmin, (req, res) => {
    try {
      const targetId = Number(req.params.id);
      if (targetId === req.user.id)
        return res.status(400).json({ ok: false, error: 'cannot_change_self_role' });
      const all    = users.listUsers.all();
      const admins = all.filter(u => u.active && u.role === 'ADMIN');
      const target = all.find(u => u.id === targetId);
      if (target?.role === 'ADMIN' && admins.length <= 1 && req.body.role !== 'ADMIN')
        return res.status(400).json({ ok: false, error: 'cannot_remove_last_admin' });
      users.setRole(targetId, req.body.role);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/users/:id', requireAdmin, (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id)
      return res.status(400).json({ ok: false, error: 'cannot_deactivate_self' });
    const all    = users.listUsers.all();
    const target = all.find(u => u.id === targetId);
    if (!target) return res.status(404).json({ ok: false, error: 'not_found' });
    if (target.active && target.role === 'ADMIN') {
      const activeAdmins = all.filter(u => u.active && u.role === 'ADMIN');
      if (activeAdmins.length <= 1)
        return res.status(400).json({ ok: false, error: 'cannot_deactivate_last_admin' });
    }
    users.deactivate(targetId);
    res.json({ ok: true });
  });

  router.post('/users/:id/reactivate', requireAdmin, (req, res) => {
    users.reactivate(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Runtime toggles ───────────────────────────────────────────────────
  router.get('/runtime/debug', requireAdmin, (_req, res) => {
    try {
      const raw = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`).get('mqtt_debug_enabled') || null;
      let enabled = process.env.ELARIS_MQTT_DEBUG === '0' ? false : true;
      let source = process.env.ELARIS_MQTT_DEBUG === '0' ? 'env' : 'default';
      if (raw && raw.value != null) {
        const v = String(raw.value).trim().toLowerCase();
        if (['1','true','yes','on','enabled'].includes(v)) enabled = true;
        else if (['0','false','no','off','disabled'].includes(v)) enabled = false;
        source = 'db';
      }
      res.json({ ok: true, mqtt_debug_enabled: enabled, source, updated_ts: raw?.updated_ts || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch('/runtime/debug', requireAdmin, (req, res) => {
    try {
      const enabled = !!req.body?.mqtt_debug_enabled;
      const ts = Date.now();
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
      `).run('mqtt_debug_enabled', enabled ? '1' : '0', ts);
      res.json({ ok: true, mqtt_debug_enabled: enabled, updated_ts: ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get('/runtime/esphome-status', requireAdmin, (_req, res) => {
    try {
      const onlineRaw = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`).get('esphome_online_stale_minutes') || null;
      const defaultRaw = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`).get('esphome_default_stale_minutes') || null;
      const parseMinutes = (row, fallback) => {
        const n = Number(row?.value);
        if (Number.isFinite(n) && n >= 1 && n <= 10080) return Math.round(n);
        return fallback;
      };
      const onlineMinutes = parseMinutes(onlineRaw, 15);
      const defaultMinutes = parseMinutes(defaultRaw, 10);
      res.json({
        ok: true,
        online_stale_minutes: onlineMinutes,
        default_stale_minutes: defaultMinutes,
        updated_ts: Math.max(Number(onlineRaw?.updated_ts || 0), Number(defaultRaw?.updated_ts || 0)) || null,
        source: (onlineRaw || defaultRaw) ? 'db' : 'default'
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch('/runtime/esphome-status', requireAdmin, (req, res) => {
    try {
      const onlineMinutes = Math.round(Number(req.body?.online_stale_minutes));
      const defaultMinutes = Math.round(Number(req.body?.default_stale_minutes));
      if (!Number.isFinite(onlineMinutes) || onlineMinutes < 1 || onlineMinutes > 10080) {
        return res.status(400).json({ ok: false, error: 'invalid_online_stale_minutes' });
      }
      if (!Number.isFinite(defaultMinutes) || defaultMinutes < 1 || defaultMinutes > 10080) {
        return res.status(400).json({ ok: false, error: 'invalid_default_stale_minutes' });
      }
      const ts = Date.now();
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
      `).run('esphome_online_stale_minutes', String(onlineMinutes), ts);
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
      `).run('esphome_default_stale_minutes', String(defaultMinutes), ts);
      res.json({ ok: true, online_stale_minutes: onlineMinutes, default_stale_minutes: defaultMinutes, updated_ts: ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── DB management ─────────────────────────────────────────────────────
  router.get('/db/devices', requireAdmin, (req, res) => {
    try {
      const devices = db.prepare(`
        SELECT d.id, d.name, d.last_seen,
          (SELECT COUNT(*) FROM io WHERE device_id = d.id) AS io_count,
          (SELECT COUNT(*) FROM pending_io WHERE device_id = d.id) AS pending_count
        FROM devices d ORDER BY d.id ASC
      `).all();
      res.json({ ok: true, devices });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/db/devices/:deviceId', requireAdmin, (req, res) => {
    try {
      const id = req.params.deviceId;
      db.transaction(() => {
        const ioIds = db.prepare(`SELECT id FROM io WHERE device_id = ?`).all(id).map(r => r.id);
        if (ioIds.length) {
          const qm = ioIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM module_mappings WHERE io_id IN (${qm})`).run(...ioIds);
          const ioIdSet = new Set(ioIds);
          const patchScene = db.prepare(`UPDATE scenes SET actions_json=? WHERE id=?`);
          for (const scene of db.prepare(`SELECT id, actions_json FROM scenes`).all()) {
            let actions; try { actions = JSON.parse(scene.actions_json || '[]'); } catch (_) { continue; }
            let changed = false;
            actions = actions.map(a => {
              if (a.type === 'send_command' && ioIdSet.has(a.io_id)) { changed = true; return { ...a, io_id: null }; }
              return a;
            });
            if (changed) patchScene.run(JSON.stringify(actions), scene.id);
          }
        }
        db.prepare(`DELETE FROM io WHERE device_id = ?`).run(id);
        db.prepare(`DELETE FROM pending_io WHERE device_id = ?`).run(id);
        db.prepare(`DELETE FROM blocked_io WHERE device_id = ?`).run(id);
        db.prepare(`DELETE FROM device_state WHERE device_id = ?`).run(id);
        db.prepare(`DELETE FROM device_site WHERE device_id = ?`).run(id);
        db.prepare(`DELETE FROM esphome_devices WHERE name = ? OR mqtt_topic_root = ?`).run(id, `elaris/${id}`);
        db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
      })();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get('/db/pending', requireAdmin, (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, device_id, group_name, key, last_seen, last_value
        FROM pending_io ORDER BY device_id, last_seen DESC
      `).all();
      res.json({ ok: true, pending: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/db/pending/:id', requireAdmin, (req, res) => {
    try {
      db.prepare(`DELETE FROM pending_io WHERE id = ?`).run(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/db/pending', requireAdmin, (req, res) => {
    try {
      const { device_id } = req.query;
      if (device_id) db.prepare(`DELETE FROM pending_io WHERE device_id = ?`).run(device_id);
      else           db.prepare(`DELETE FROM pending_io`).run();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get('/db/profiles', requireAdmin, (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, label, platform, board, source, updated_at
        FROM esphome_board_profiles WHERE is_enabled = 1 ORDER BY label COLLATE NOCASE ASC
      `).all();
      res.json({ ok: true, profiles: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/db/profiles/:id', requireAdmin, (req, res) => {
    try {
      const id = req.params.id;
      db.prepare(`DELETE FROM esphome_profile_capabilities WHERE profile_id = ?`).run(id);
      db.prepare(`DELETE FROM esphome_board_profiles WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.post('/db/repair', requireAdmin, (req, res) => {
    try {
      const integrity = db.prepare(`PRAGMA integrity_check`).all();
      db.prepare(`PRAGMA wal_checkpoint(TRUNCATE)`).run();
      db.exec(`VACUUM`);
      const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
      res.json({ ok: true, integrity: ok ? 'ok' : 'errors', details: integrity });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.post('/db/erase', requireAdmin, (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'ERASE') return res.status(400).json({ ok: false, error: 'missing_confirm' });
    try {
      db.transaction(() => {
        for (const tbl of [
          'pending_io','blocked_io','io','device_state','events',
          'device_site','devices','esphome_devices','esphome_generated_configs',
          'esphome_install_jobs','esphome_device_overrides',
          'module_mappings','module_instances',
          'scene_schedules','scene_log','scenes','zones',
        ]) db.prepare(`DELETE FROM ${tbl}`).run();
        // Keep: users, sites, board_profiles
      })();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  return router;
}

module.exports = { initAdminRoutes };
