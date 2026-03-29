'use strict';
// src/api/admin_routes.js — /api/admin/*
const fs = require('fs');
const path = require('path');
const express = require('express');

function clearRetainedTopics(mqttApi, topics) {
  if (!mqttApi || !mqttApi.client || typeof mqttApi.client.publish !== 'function') return 0;
  let cleared = 0;
  for (const raw of Array.isArray(topics) ? topics : []) {
    const topic = String(raw || '').trim();
    if (!topic) continue;
    try {
      mqttApi.client.publish(topic, '', { qos: 0, retain: true });
      cleared += 1;
    } catch (_) {}
  }
  return cleared;
}

function initAdminRoutes({ db, users, requireAdmin, historyRollups, mqttApi }) {
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

  router.get('/runtime/history-retention', requireAdmin, (_req, res) => {
    try {
      const raw = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`).get('events_retention_days') || null;
      const stats = db.prepare(`SELECT COUNT(*) AS count, MIN(ts) AS oldest_ts, MAX(ts) AS newest_ts FROM events`).get() || {};
      const retentionDays = (Number(raw?.value) >= 1 && Number(raw?.value) <= 3650) ? Math.round(Number(raw.value)) : 30;
      res.json({ ok: true, events_retention_days: retentionDays, updated_ts: raw?.updated_ts || null, source: raw ? 'db' : 'default', stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch('/runtime/history-retention', requireAdmin, (req, res) => {
    try {
      const retentionDays = Math.round(Number(req.body?.events_retention_days));
      if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
        return res.status(400).json({ ok: false, error: 'invalid_events_retention_days' });
      }
      const ts = Date.now();
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
      `).run('events_retention_days', String(retentionDays), ts);
      res.json({ ok: true, events_retention_days: retentionDays, updated_ts: ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get('/runtime/rollups', requireAdmin, (_req, res) => {
    try {
      const raw = db.prepare(`SELECT value, updated_ts FROM app_settings WHERE key = ?`).get('rollups_retention_days') || null;
      const retentionDays = (Number(raw?.value) >= 30 && Number(raw?.value) <= 3650) ? Math.round(Number(raw.value)) : (historyRollups?.getRetentionDays?.() || 1095);
      const stats = {
        '5m': historyRollups?.getStats?.('5m') || { count: 0, oldest_ts: null, newest_ts: null },
        '1h': historyRollups?.getStats?.('1h') || { count: 0, oldest_ts: null, newest_ts: null },
        '1d': historyRollups?.getStats?.('1d') || { count: 0, oldest_ts: null, newest_ts: null },
      };
      res.json({ ok: true, rollups_retention_days: retentionDays, updated_ts: raw?.updated_ts || null, source: raw ? 'db' : 'default', stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch('/runtime/rollups', requireAdmin, (req, res) => {
    try {
      const retentionDays = Math.round(Number(req.body?.rollups_retention_days));
      if (!Number.isFinite(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
        return res.status(400).json({ ok: false, error: 'invalid_rollups_retention_days' });
      }
      const ts = Date.now();
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_ts) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
      `).run('rollups_retention_days', String(retentionDays), ts);
      res.json({ ok: true, rollups_retention_days: retentionDays, updated_ts: ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post('/runtime/rollups/rebuild', requireAdmin, (_req, res) => {
    try {
      let changed = 0;
      const h = historyRollups?.buildMissingHourlyRollups?.({ lookbackHours: 24 * 30 }) || { changed: 0 };
      changed += Number(h.changed || 0);
      const d = historyRollups?.buildDailyRollups?.({ lookbackDays: 180 }) || { changed: 0 };
      changed += Number(d.changed || 0);
      const m = historyRollups?.build5mRollups?.({ lookbackMs: 4 * 3600000 }) || { changed: 0 };
      changed += Number(m.changed || 0);
      const stats = {
        '5m': historyRollups?.getStats?.('5m') || { count: 0, oldest_ts: null, newest_ts: null },
        '1h': historyRollups?.getStats?.('1h') || { count: 0, oldest_ts: null, newest_ts: null },
        '1d': historyRollups?.getStats?.('1d') || { count: 0, oldest_ts: null, newest_ts: null },
      };
      res.json({ ok: true, changed, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });


  router.post('/logs/export', requireAdmin, (_req, res) => {
    try {
      const rows = db.prepare(`
        SELECT instance_id, action, reason, ts
        FROM automation_log
        ORDER BY ts DESC
      `).all();
      const logsDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
      const filename = `automation_logs_${stamp}.txt`;
      const filepath = path.join(logsDir, filename);
      const content = rows.map(r => {
        const dt = new Date(Number(r.ts) || Date.now());
        const ts = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
        return `${ts} | instance=${Number(r.instance_id) || 0} | ${String(r.action || '').trim()} | ${String(r.reason || '').trim()}`;
      }).join('\n') + (rows.length ? '\n' : '');
      fs.writeFileSync(filepath, content, 'utf8');
      res.json({ ok: true, count: rows.length, filename, filepath, folder: logsDir });
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
      const id = String(req.params.deviceId || '').trim();
      const esphome = db.prepare(`SELECT id, name, mqtt_topic_root FROM esphome_devices WHERE name = ? OR mqtt_topic_root = ? ORDER BY id DESC LIMIT 1`).get(id, `elaris/${id}`) || null;
      const retainedTopics = new Set([`${id}/status`, `elaris/${id}/status`]);
      db.prepare(`SELECT DISTINCT topic FROM events WHERE device_id = ?`).all(id).forEach(r => {
        const topic = String(r?.topic || '').trim();
        if (topic) retainedTopics.add(topic);
      });
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
        db.prepare(`DELETE FROM events WHERE device_id = ?`).run(id);
        if (esphome) {
          db.prepare(`DELETE FROM esphome_install_jobs WHERE esphome_device_id = ?`).run(esphome.id);
          db.prepare(`DELETE FROM esphome_generated_configs WHERE esphome_device_id = ?`).run(esphome.id);
          db.prepare(`DELETE FROM esphome_device_overrides WHERE esphome_device_id = ?`).run(esphome.id);
        }
        db.prepare(`DELETE FROM esphome_devices WHERE name = ? OR mqtt_topic_root = ?`).run(id, `elaris/${id}`);
        db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
      })();
      const cleared = clearRetainedTopics(mqttApi, Array.from(retainedTopics));
      res.json({ ok: true, purged: true, retained_topics_cleared: cleared });
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

  // ── Stale Retained MQTT Topics ─────────────────────────────────────────
  router.get('/mqtt/stale-retained', requireAdmin, (req, res) => {
    try {
      const devices = typeof mqttApi?.getMissedRetained === 'function' ? mqttApi.getMissedRetained() : [];
      res.json({ ok: true, devices });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.post('/mqtt/stale-retained/clear', requireAdmin, (req, res) => {
    try {
      const { device_id } = req.body || {};
      if (!device_id) return res.status(400).json({ ok: false, error: 'device_id required' });
      const topics = typeof mqttApi?.clearMissedRetainedForDevice === 'function'
        ? mqttApi.clearMissedRetainedForDevice(String(device_id))
        : [];
      const cleared = clearRetainedTopics(mqttApi, topics);
      res.json({ ok: true, device_id, topics_cleared: cleared });
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
