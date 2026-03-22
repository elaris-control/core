'use strict';
// src/api/esphome/device_routes.js — devices, configs, yaml file

const fs = require('fs');
const path = require('path');
const { safeName } = require('../../esphome/schema');
const { redactSavedConfig, configSiteId, cleanupStaleEsphomeDuplicates } = require('../../esphome/helpers');
const { normalizeIntegrationKey, normalizeOwnershipMode, normalizeConfigSource, normalizeReadOnly } = require('../../esphome/schema');

function addStandardEspHomeTopics(topics, root, key) {
  var topicRoot = String(root || '').trim();
  var itemKey = String(key || '').trim();
  if (!topicRoot || !itemKey) return;
  topics.add(topicRoot + '/switch/' + itemKey + '/state');
  topics.add(topicRoot + '/binary_sensor/' + itemKey + '/state');
  topics.add(topicRoot + '/sensor/' + itemKey + '/state');
  topics.add(topicRoot + '/text_sensor/' + itemKey + '/state');
  topics.add(topicRoot + '/number/' + itemKey + '/state');
  topics.add(topicRoot + '/select/' + itemKey + '/state');
  topics.add(topicRoot + '/light/' + itemKey + '/state');
  topics.add(topicRoot + '/fan/' + itemKey + '/state');
  topics.add(topicRoot + '/cover/' + itemKey + '/state');
  topics.add(topicRoot + '/lock/' + itemKey + '/state');
  topics.add(topicRoot + '/climate/' + itemKey + '/state');
}

function collectDeviceTopics(db, deviceId, mqttTopicRoot) {
  var topics = new Set();
  var id = String(deviceId || '').trim();
  var root = String(mqttTopicRoot || '').trim();
  var roots = [id, root].map(function(v) { return String(v || '').trim(); }).filter(Boolean);
  roots.forEach(function(topicRoot) {
    topics.add(topicRoot + '/status');
  });
  try {
    db.prepare('SELECT DISTINCT topic FROM events WHERE device_id=?').all(id).forEach(function(row) {
      var topic = String(row && row.topic || '').trim();
      if (topic) topics.add(topic);
    });
  } catch (_) {}
  try {
    db.prepare('SELECT key FROM device_state WHERE device_id=?').all(id).forEach(function(row) {
      var rawKey = String(row && row.key || '').trim();
      var leaf = rawKey.includes('.') ? rawKey.split('.').slice(1).join('.') : rawKey;
      roots.forEach(function(topicRoot) { addStandardEspHomeTopics(topics, topicRoot, leaf); });
    });
  } catch (_) {}
  try {
    db.prepare('SELECT key FROM io WHERE device_id=?').all(id).forEach(function(row) {
      var key = String(row && row.key || '').trim();
      roots.forEach(function(topicRoot) { addStandardEspHomeTopics(topics, topicRoot, key); });
    });
  } catch (_) {}
  try {
    db.prepare('SELECT key, group_name FROM pending_io WHERE device_id=?').all(id).forEach(function(row) {
      var key = String(row && row.key || '').trim();
      roots.forEach(function(topicRoot) { addStandardEspHomeTopics(topics, topicRoot, key); });
    });
  } catch (_) {}
  return Array.from(topics);
}

function clearRetainedTopics(mqttApi, topics) {
  if (!mqttApi || !mqttApi.client || typeof mqttApi.client.publish !== 'function') return 0;
  var cleared = 0;
  (Array.isArray(topics) ? topics : []).forEach(function(topic) {
    var t = String(topic || '').trim();
    if (!t) return;
    try {
      mqttApi.client.publish(t, '', { qos: 0, retain: true });
      cleared += 1;
    } catch (_) {}
  });
  return cleared;
}

function detachIoReferences(db, ioIds) {
  var ids = Array.isArray(ioIds) ? ioIds.map(Number).filter(Boolean) : [];
  if (!ids.length) return { mappings: 0, scenes: 0 };
  var qm = ids.map(function() { return '?'; }).join(',');
  var mappings = db.prepare(`DELETE FROM module_mappings WHERE io_id IN (${qm})`).run.apply(null, ids).changes || 0;
  var ioIdSet = new Set(ids);
  var patchScene = db.prepare('UPDATE scenes SET actions_json=? WHERE id=?');
  var scenes = 0;
  db.prepare('SELECT id, actions_json FROM scenes').all().forEach(function(scene) {
    var actions;
    try { actions = JSON.parse(scene.actions_json || '[]'); } catch (_) { return; }
    var changed = false;
    actions = actions.map(function(action) {
      if (action && action.type === 'send_command' && ioIdSet.has(Number(action.io_id))) {
        changed = true;
        return { ...action, io_id: null };
      }
      return action;
    });
    if (changed) {
      patchScene.run(JSON.stringify(actions), scene.id);
      scenes += 1;
    }
  });
  return { mappings: mappings, scenes: scenes };
}

async function disconnectNativeSessions(nativeSessions, row) {
  if (!nativeSessions || typeof nativeSessions.list !== 'function' || typeof nativeSessions.disconnect !== 'function' || !row) return 0;
  var sessions = [];
  try { sessions = nativeSessions.list('esphome') || []; } catch (_) { sessions = []; }
  var wantedId = row.id != null ? String(row.id).trim() : '';
  var wantedName = String(row.name || '').trim().toLowerCase();
  var wantedHost = String(row.ip_address || row.hostname || '').trim().toLowerCase();
  var disconnected = 0;
  for (const session of sessions) {
    var sessionId = session.device_id != null ? String(session.device_id).trim() : '';
    var sessionName = String(session.device_name || '').trim().toLowerCase();
    var sessionHost = String((session.payload && (session.payload.api_host || session.payload.ip_address || session.payload.hostname)) || '').trim().toLowerCase();
    var matches = (wantedId && sessionId && wantedId === sessionId)
      || (wantedName && sessionName && wantedName === sessionName)
      || (wantedHost && sessionHost && wantedHost === sessionHost);
    if (!matches) continue;
    try {
      await nativeSessions.disconnect('esphome', {
        device_id: session.device_id,
        device_name: session.device_name,
        api_host: (session.payload && session.payload.api_host) || '',
        ip_address: (session.payload && session.payload.ip_address) || '',
        hostname: (session.payload && session.payload.hostname) || '',
      });
      disconnected += 1;
    } catch (_) {}
  }
  return disconnected;
}

function mountDeviceRoutes({ app, db, cfgDir, mqttApi, nativeSessions, requireEngineerAccess, access, stmts }) {

  app.get('/api/esphome/yaml/:name', requireEngineerAccess, (req, res) => {
    const p = path.join(cfgDir, `${safeName(req.params.name)}.yaml`);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not_found' });
    res.type('text/plain').send(fs.readFileSync(p, 'utf8'));
  });

  app.get('/api/esphome/devices', requireEngineerAccess, (req, res) => {
    if (!db) return res.json({ devices: [] });
    try {
      cleanupStaleEsphomeDuplicates(db);
      const rows = db.prepare(`
        SELECT d.id, d.site_id, d.name, d.friendly_name, d.board_profile_id, d.transport, d.network_mode,
               d.status, d.serial_port, d.mac_address, d.ip_address, d.hostname, d.mqtt_topic_root,
               d.firmware_version, d.last_seen_at, d.created_at, d.updated_at,
               d.integration_key, d.ownership_mode, d.config_source, d.read_only,
               j.target_port, j.target_ip, j.status AS job_status, j.finished_at AS job_finished_at,
               (SELECT COUNT(*) FROM io WHERE io.device_id = d.name AND io.stale = 1) AS stale_io_count
        FROM esphome_devices d
        LEFT JOIN esphome_install_jobs j ON j.id = (
          SELECT j2.id FROM esphome_install_jobs j2 WHERE j2.esphome_device_id = d.id ORDER BY j2.id DESC LIMIT 1
        )
        WHERE d.deleted_at IS NULL
        ORDER BY d.id DESC
      `).all().filter(row => !access || access.canAccessSite(req, row.site_id));
      const parseMinutes = (key, fallback) => {
        const raw = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key);
        const n = Number(raw?.value);
        return (Number.isFinite(n) && n >= 1 && n <= 10080) ? Math.round(n) : fallback;
      };
      res.json({
        devices: rows,
        runtime: {
          online_stale_minutes: parseMinutes('esphome_online_stale_minutes', 15),
          default_stale_minutes: parseMinutes('esphome_default_stale_minutes', 10)
        }
      });
    } catch (e) {
      res.json({ devices: [], error: String(e?.message || e) });
    }
  });


  app.get('/api/esphome/jobs/:id', requireEngineerAccess, (req, res) => {
    if (!db) return res.status(404).json({ error: 'no_db' });
    const row = db.prepare('SELECT * FROM esphome_install_jobs WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const dev = row.esphome_device_id ? db.prepare('SELECT site_id FROM esphome_devices WHERE id=?').get(row.esphome_device_id) : null;
    if (dev && access && !access.canAccessSite(req, dev.site_id)) return res.status(403).json({ error: 'forbidden' });
    res.json({ id: row.id, status: row.status, started_at: row.started_at, finished_at: row.finished_at, exit_code: row.exit_code, output_log: row.output_log || '', error_text: row.error_text || '' });
  });

  app.delete('/api/esphome/devices/:id', requireEngineerAccess, async (req, res) => {
    if (!db) return res.json({ ok: true, removed: 0 });
    const row = db.prepare('SELECT * FROM esphome_devices WHERE id=?').get(req.params.id);
    if (!row) return res.json({ ok: true, removed: 0 });
    if (access && !access.canAccessSite(req, row.site_id)) return res.status(403).json({ error: 'forbidden' });
    const deviceName = String(row.name || '').trim();
    const mqttTopicRoot = String(row.mqtt_topic_root || '').trim() || (deviceName ? ('elaris/' + deviceName) : '');
    const retainedTopics = collectDeviceTopics(db, deviceName, mqttTopicRoot);
    const ioIds = db.prepare('SELECT id FROM io WHERE device_id=?').all(deviceName).map(function(r) { return Number(r.id); }).filter(Boolean);
    const detached = detachIoReferences(db, ioIds);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM esphome_install_jobs WHERE esphome_device_id=?').run(row.id);
      db.prepare('DELETE FROM esphome_generated_configs WHERE esphome_device_id=?').run(row.id);
      db.prepare('DELETE FROM esphome_device_overrides WHERE esphome_device_id=?').run(row.id);
      db.prepare('DELETE FROM pending_io WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM blocked_io WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM device_state WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM device_site WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM io WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM events WHERE device_id=?').run(deviceName);
      db.prepare('DELETE FROM esphome_devices WHERE id=?').run(row.id);
    });
    tx();
    const nativeSessionsDisconnected = await disconnectNativeSessions(nativeSessions, row);
    var retainedCleared = clearRetainedTopics(mqttApi, retainedTopics);
    try {
      const yamlPath = path.join(cfgDir, `${safeName(row.name || req.params.id)}.yaml`);
      if (fs.existsSync(yamlPath)) fs.unlinkSync(yamlPath);
    } catch (e) {}
    try {
      const jsonPath = path.join(cfgDir, `${safeName(row.name || req.params.id)}.json`);
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    } catch (e) {}
    res.json({ ok: true, removed: 1, purged: true, detached, retained_topics_cleared: retainedCleared, native_sessions_disconnected: nativeSessionsDisconnected });
  });
  app.patch('/api/esphome/devices/:id/ownership', requireEngineerAccess, (req, res) => {
    if (!db) return res.status(404).json({ ok: false, error: 'no_db' });
    const row = db.prepare('SELECT * FROM esphome_devices WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    if (access && !access.canAccessSite(req, row.site_id)) return res.status(403).json({ error: 'forbidden' });
    const incomingManaged = !!req.body?.managed;
    const ownershipMode = incomingManaged ? 'managed_internal' : 'external_native';
    const readOnly = incomingManaged ? 0 : 1;
    const configSource = String(row.config_source || '').trim().toLowerCase() === 'native_api' ? 'native_api' : (incomingManaged ? 'board_profile' : 'native_api');
    db.prepare('UPDATE esphome_devices SET ownership_mode=?, read_only=?, config_source=?, updated_at=?, deleted_at=NULL, deleted_reason=NULL WHERE id=?').run(ownershipMode, readOnly, configSource, new Date().toISOString(), row.id);
    res.json({ ok: true, id: row.id, ownership_mode: ownershipMode, read_only: readOnly, config_source: configSource });
  });

  app.delete('/api/esphome/devices/:id/stale-io', requireEngineerAccess, (req, res) => {
    if (!db) return res.status(404).json({ ok: false, error: 'no_db' });
    const row = db.prepare('SELECT * FROM esphome_devices WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    if (access && !access.canAccessSite(req, row.site_id)) return res.status(403).json({ error: 'forbidden' });
    try {
      const staleRows = db.prepare('SELECT id FROM io WHERE device_id=? AND stale=1').all(row.name);
      const ids = staleRows.map(r => r.id);
      db.transaction(() => {
        for (const id of ids) {
          db.prepare('DELETE FROM module_mappings WHERE io_id=?').run(id);
          db.prepare('DELETE FROM io WHERE id=?').run(id);
        }
      })();
      res.json({ ok: true, removed: ids.length });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.get('/api/esphome/configs', requireEngineerAccess, (req, res) => {
    try {
      const files = fs.readdirSync(cfgDir)
        .filter(f => f.endsWith('.json'))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(cfgDir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean)
        .filter(cfg => !access || access.canAccessSite(req, configSiteId(cfg, db, stmts.getDevicesByName)))
        .map(redactSavedConfig);
      res.json({ configs: files });
    } catch { res.json({ configs: [] }); }
  });

  app.post('/api/esphome/configs', requireEngineerAccess, (req, res) => {
    const cfg = req.body;
    if (!cfg || !cfg.device_name) return res.status(400).json({ error: 'missing_device_name' });
    const p = path.join(cfgDir, `${safeName(cfg.device_name)}.json`);
    fs.writeFileSync(p, JSON.stringify({ ...cfg, saved_at: new Date().toISOString() }, null, 2), 'utf8');
    res.json({ ok: true });
  });

  app.delete('/api/esphome/configs/:name', requireEngineerAccess, (req, res) => {
    const p = path.join(cfgDir, `${safeName(req.params.name)}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ ok: true });
  });
}

module.exports = { mountDeviceRoutes };
