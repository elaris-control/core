'use strict';
// src/api/misc_routes.js — weather, geolocate, automation logs
// These span different URL prefixes so we mount directly on app.
const { getWeather } = require('../weather');

function mountMiscRoutes(app, { db, access, requireLogin, requireEngineerAccess, integrationRegistry }) {

  // ── Version (public) ─────────────────────────────────────────────────────
  app.get('/api/version', (req, res) => {
    res.json({ ok: true, version: require('../../package.json').version });
  });

  // ── Integration adapters ───────────────────────────────────────────────
  app.get('/api/integrations', requireEngineerAccess, (req, res) => {
    try {
      res.json({ ok: true, integrations: integrationRegistry ? integrationRegistry.list() : [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/integrations/:key/import-native', requireEngineerAccess, (req, res) => {
    try {
      var key = String(req.params.key || '').trim().toLowerCase();
      if (!integrationRegistry) return res.status(404).json({ ok: false, error: 'integration_registry_unavailable' });
      var adapter = integrationRegistry.get(key);
      if (!adapter) return res.status(404).json({ ok: false, error: 'integration_not_found' });
      if (typeof adapter.importNative !== 'function') return res.status(400).json({ ok: false, error: 'integration_native_import_unsupported' });
      var out = adapter.importNative({ db: db, access: access, requireEngineerAccess: requireEngineerAccess }, req.body || {});
      res.json({ ok: true, integration_key: key, ...(out || {}) });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });


  app.get('/api/debug/mqtt/:device_id', requireEngineerAccess, (req, res) => {
    try {
      const requested = String(req.params.device_id || '').trim();
      if (!requested) return res.status(400).json({ ok: false, error: 'device_id_required' });
      const device = db.prepare(`
        SELECT * FROM esphome_devices
        WHERE lower(name)=lower(?) OR lower(COALESCE(friendly_name,''))=lower(?) OR lower(COALESCE(hostname,''))=lower(?)
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(requested, requested, requested) || null;
      const canonical = String(device?.name || requested).trim();
      const states = db.prepare(`SELECT key, value, ts FROM device_state WHERE device_id=? ORDER BY ts DESC`).all(canonical);
      const events = db.prepare(`SELECT topic, payload, ts FROM events WHERE device_id=? ORDER BY ts DESC LIMIT 200`).all(canonical);
      const summary = {
        total_state_rows: states.length,
        total_event_rows: events.length,
        state_keys: states.map(r => r.key),
        by_group: states.reduce((acc, row) => {
          const raw = String(row?.key || '');
          const group = raw.includes('.') ? raw.split('.')[0] : '_other';
          acc[group] = (acc[group] || 0) + 1;
          return acc;
        }, {}),
        recent_topics: events.slice(0, 50).map(r => ({ topic: r.topic, ts: r.ts }))
      };
      res.json({ ok: true, requested, canonical_device_id: canonical, device, summary, states, events });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── Weather ─────────────────────────────────────────────────────────────
  app.get('/api/weather/:site_id', requireLogin, async (req, res) => {
    try {
      const siteRef = access.getSiteRef(req.params.site_id);
      if (!siteRef) return res.status(404).json({ ok: false, error: 'site_not_found' });
      if (!access.canAccessSiteRef(req, siteRef)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(Number(req.params.site_id));
      if (!site.lat || !site.lon)
        return res.status(400).json({ ok: false, error: 'no_location', hint: 'Set site location in Settings' });
      const weather = await getWeather(site.lat, site.lon);
      res.json({ ok: true, weather });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // ── IP Geolocation ───────────────────────────────────────────────────────
  // Uses ipwho.is — free, HTTPS, no API key required.
  app.get('/api/geolocate', requireLogin, (req, res) => {
    const url = 'https://ipwho.is/?output=json&fields=latitude,longitude,city,region,country,timezone.id,success';
    require('https').get(url, { headers: { 'User-Agent': 'ELARIS/1.0' } }, (r) => {
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (d.success) {
            res.json({ ok: true, lat: d.latitude, lon: d.longitude, city: d.city, region: d.region, country: d.country, timezone: d.timezone?.id || d.timezone });
          } else {
            res.status(400).json({ ok: false, error: 'geolocate_failed' });
          }
        } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
      });
    }).on('error', e => res.status(500).json({ ok: false, error: String(e?.message || e) }));
  });

  // ── Automation log ───────────────────────────────────────────────────────
  app.get('/api/logs', requireEngineerAccess, (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || 50),  200);
    const offset = parseInt(req.query.offset || 0);
    const type   = req.query.type || '';
    try {
      let sql    = `SELECT instance_id, action, reason, ts FROM automation_log`;
      const params = [];
      if (type === 'solar')  sql += ` WHERE instance_id IN (SELECT id FROM module_instances WHERE module_id='solar')`;
      if (type === 'custom') sql += ` WHERE instance_id IN (SELECT id FROM module_instances WHERE module_id='custom')`;
      sql += ` ORDER BY ts DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      res.json({ ok: true, logs: db.prepare(sql).all(...params) });
    } catch { res.json({ ok: true, logs: [] }); }
  });
}

module.exports = { mountMiscRoutes };
