'use strict';
// src/api/sites_routes.js — /api/sites/*
const express = require('express');

function initSitesRoutes({ dbApi, access, requireLogin, requireEngineerAccess, requireAdmin }) {
  const router = express.Router();

  function requireSiteAccess(req, res, siteId) {
    const ref = access.getSiteRef(siteId);
    if (!ref) { res.status(404).json({ ok: false, error: 'site_not_found' }); return null; }
    if (!access.canAccessSiteRef(req, ref)) { res.status(403).json({ ok: false, error: 'forbidden' }); return null; }
    return ref;
  }

  router.get('/', requireLogin, (req, res) => {
    const all   = dbApi.listSites.all();
    const sites = access.canSeePrivate(req) ? all : all.filter(s => !s.is_private);
    res.json({ ok: true, sites });
  });

  router.post('/', requireAdmin, (req, res) => {
    const name       = String(req.body?.name || '').trim();
    const note       = req.body?.note == null ? null : String(req.body.note);
    const is_private = req.body?.is_private ? 1 : 0;
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    try {
      dbApi.createSite.run(name, note, is_private, Date.now());
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get('/:id', requireLogin, (req, res) => {
    const site = dbApi.db.prepare('SELECT * FROM sites WHERE id=?').get(Number(req.params.id));
    if (!site) return res.status(404).json({ ok: false, error: 'not_found' });
    if (site.is_private && !access.canSeePrivate(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    res.json({ ok: true, site });
  });

  router.patch('/:id', requireAdmin, (req, res) => {
    const id   = Number(req.params.id);
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const note = req.body?.note != null ? String(req.body.note) : null;
    if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
    try {
      dbApi.db.prepare(`UPDATE sites SET name=?, note=? WHERE id=?`).run(name, note, id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.patch('/:id/visibility', requireAdmin, (req, res) => {
    dbApi.setSitePrivacy.run(req.body?.is_private ? 1 : 0, Number(req.params.id));
    res.json({ ok: true });
  });

  router.patch('/:id/location', requireEngineerAccess, (req, res) => {
    if (!requireSiteAccess(req, res, req.params.id)) return;
    const { lat, lon, timezone, address } = req.body || {};
    dbApi.db.prepare(`UPDATE sites SET lat=?, lon=?, timezone=?, address=? WHERE id=?`).run(
      lat != null ? String(lat) : null,
      lon != null ? String(lon) : null,
      timezone || 'Europe/Athens',
      address  || null,
      Number(req.params.id)
    );
    res.json({ ok: true });
  });

  router.delete('/:id', requireAdmin, (req, res) => {
    try { dbApi.deleteSite(Number(req.params.id)); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.get('/:id/devices', requireLogin, (req, res) => {
    const siteId = Number(req.params.id);
    if (!requireSiteAccess(req, res, siteId)) return;
    const devices = dbApi.listDevicesForSite.all(siteId).map(r => r.device_id);
    res.json({ ok: true, siteId, devices });
  });

  router.post('/:id/assign-device', requireEngineerAccess, (req, res) => {
    const siteId = Number(req.params.id);
    if (!requireSiteAccess(req, res, siteId)) return;
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!deviceId) return res.status(400).json({ ok: false, error: 'missing_deviceId' });
    dbApi.assignDeviceToSite(deviceId, siteId);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { initSitesRoutes };
