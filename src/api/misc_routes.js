'use strict';
// src/api/misc_routes.js — weather, geolocate, automation logs
// These span different URL prefixes so we mount directly on app.
const { getWeather } = require('../weather');

function mountMiscRoutes(app, { db, access, requireLogin, requireEngineerAccess }) {

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
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
      });
    }).on('error', e => res.status(500).json({ ok: false, error: e.message }));
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
