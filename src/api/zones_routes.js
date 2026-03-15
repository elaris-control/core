'use strict';
// src/api/zones_routes.js — /api/zones/*
const express = require('express');

function initZonesRoutes({ dbApi, access, requireEngineerAccess }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const site_id = req.query.site_id ? Number(req.query.site_id) : null;
    if (site_id != null) {
      const ref = access.getSiteRef(site_id);
      if (!ref) return res.status(404).json({ ok: false, error: 'site_not_found' });
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      return res.json({ ok: true, zones: dbApi.listZonesBySite.all(site_id) });
    }
    const zones = dbApi.listZones.all().filter(z => access.canAccessSite(req, z.site_id));
    res.json({ ok: true, zones });
  });

  router.post('/', requireEngineerAccess, (req, res) => {
    const name    = String(req.body?.name || '').trim();
    const site_id = req.body?.site_id != null ? Number(req.body.site_id) : null;
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    dbApi.createZone.run(name, site_id);
    res.json({ ok: true });
  });

  router.post('/:id', requireEngineerAccess, (req, res) => {
    const id   = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!id || !name) return res.status(400).json({ ok: false, error: 'missing_fields' });
    try { dbApi.renameZone(id, name); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/:id', requireEngineerAccess, (req, res) => {
    const id              = Number(req.params.id);
    const reassign_zone_id = (req.body?.reassign_zone_id != null && req.body.reassign_zone_id !== '')
      ? Number(req.body.reassign_zone_id) : null;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
    try {
      const c = dbApi.countIOByZone.get(id)?.c || 0;
      dbApi.deleteZone(id, reassign_zone_id);
      res.json({ ok: true, moved: c });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  return router;
}

module.exports = { initZonesRoutes };
