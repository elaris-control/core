'use strict';
// src/api/esphome/device_routes.js — devices, configs, yaml file

const fs = require('fs');
const path = require('path');
const { safeName } = require('../../esphome/schema');
const { redactSavedConfig, configSiteId, cleanupStaleEsphomeDuplicates } = require('../../esphome/helpers');

function mountDeviceRoutes({ app, db, cfgDir, requireEngineerAccess, access, stmts }) {

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
               j.target_port, j.target_ip, j.status AS job_status, j.finished_at AS job_finished_at
        FROM esphome_devices d
        LEFT JOIN esphome_install_jobs j ON j.id = (
          SELECT j2.id FROM esphome_install_jobs j2 WHERE j2.esphome_device_id = d.id ORDER BY j2.id DESC LIMIT 1
        )
        WHERE d.deleted_at IS NULL
        ORDER BY d.id DESC
      `).all().filter(row => !access || access.canAccessSite(req, row.site_id));
      res.json({ devices: rows });
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

  app.delete('/api/esphome/devices/:id', requireEngineerAccess, (req, res) => {
    if (!db) return res.json({ ok: true, removed: 0 });
    const row = db.prepare('SELECT * FROM esphome_devices WHERE id=?').get(req.params.id);
    if (!row) return res.json({ ok: true, removed: 0 });
    if (access && !access.canAccessSite(req, row.site_id)) return res.status(403).json({ error: 'forbidden' });
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE esphome_devices SET status=?, deleted_at=?, deleted_reason=?, last_seen_at=NULL, updated_at=? WHERE id=?').run('deleted', now, 'user_deleted', now, row.id);
      db.prepare('DELETE FROM esphome_install_jobs WHERE esphome_device_id=?').run(row.id);
      db.prepare('DELETE FROM esphome_generated_configs WHERE esphome_device_id=?').run(row.id);
      db.prepare('DELETE FROM esphome_device_overrides WHERE esphome_device_id=?').run(row.id);
    });
    tx();
    try {
      const yamlPath = path.join(cfgDir, `${safeName(row.name || req.params.id)}.yaml`);
      if (fs.existsSync(yamlPath)) fs.unlinkSync(yamlPath);
    } catch (e) {}
    try {
      const jsonPath = path.join(cfgDir, `${safeName(row.name || req.params.id)}.json`);
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    } catch (e) {}
    res.json({ ok: true, removed: 1, tombstoned: true });
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
