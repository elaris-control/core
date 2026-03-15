'use strict';
// src/api/entities_routes.js — /api/entities, /api/pending-io, /api/blocked-io
const express = require('express');

function initEntitiesRoutes({ dbApi, requireEngineerAccess }) {
  const router = express.Router();

  // ── Approved entities list ────────────────────────────────────────────
  router.get('/entities', requireEngineerAccess, (req, res) => {
    try {
      const rows = dbApi.db.prepare(`
        SELECT io.id, io.device_id, io.group_name, io.key, io.type, io.name,
               io.zone_id, z.name AS zone_name,
               COALESCE(io.enabled, 1) AS enabled,
               io.hw_type, io.kind, io.unit, io.device_class,
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
    res.json({ ok: true, pending: dbApi.listPendingIO.all() });
  });

  router.post('/pending-io/:id/approve', requireEngineerAccess, (req, res) => {
    try {
      const pending_id = Number(req.params.id);
      const { name, type, zone_id, site_id } = req.body || {};
      if (!name || !type) return res.status(400).json({ ok: false, error: 'missing_fields' });
      let device_id = null;
      try { device_id = dbApi.db.prepare('SELECT device_id FROM pending_io WHERE id=?').get(pending_id)?.device_id || null; } catch {}
      const out = dbApi.approvePending({ pending_id, name, type, zone_id });
      const sid = (site_id === undefined || site_id === null || site_id === '') ? null : Number(site_id);
      if (sid && Number.isFinite(sid) && device_id && dbApi.assignDeviceToSite) {
        dbApi.assignDeviceToSite(device_id, sid);
      }
      res.json({ ok: true, ...out });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  router.delete('/pending-io/:id', requireEngineerAccess, (req, res) => {
    dbApi.deletePendingIOAndBlock(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Blocked IO ────────────────────────────────────────────────────────
  router.get('/blocked-io', requireEngineerAccess, (req, res) => {
    try {
      const rows = dbApi.db.prepare(
        `SELECT device_id, group_name, key, created_ts, reason FROM blocked_io ORDER BY created_ts DESC`
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
        `INSERT OR REPLACE INTO blocked_io(device_id, group_name, key, created_ts, reason) VALUES(?,?,?,?,?)`
      ).run(device_id, group_name, key, Date.now(), reason);
      res.json({ ok: true });
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
