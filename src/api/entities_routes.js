'use strict';
// src/api/entities_routes.js — /api/entities, /api/pending-io, /api/blocked-io
const express = require('express');
const { getCatalogProfile } = require('../esphome/profile_registry');
const { findBoardPort, findBoardBus } = require('../esphome/board_port_registry');

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
    res.json({ ok: true, pending: dbApi.listPendingIO.all() });
  });

  router.post('/pending-io/:id/approve', requireEngineerAccess, (req, res) => {
    try {
      const pending_id = Number(req.params.id);
      const { name, type, zone_id, site_id, entity_class } = req.body || {};
      const source_hint = String(req.body?.source_hint || '').trim();
      let board_profile_id = String(req.body?.board_profile_id || '').trim() || null;
      if (!name || !(type || entity_class)) return res.status(400).json({ ok: false, error: 'missing_fields' });
      let device_id = null;
      try { device_id = dbApi.db.prepare('SELECT device_id FROM pending_io WHERE id=?').get(pending_id)?.device_id || null; } catch {}
      if (!board_profile_id && device_id) {
        try {
          const dev = dbApi.db.prepare(`SELECT board_profile_id FROM esphome_devices WHERE name=? OR friendly_name=? OR hostname=? ORDER BY updated_at DESC, id DESC LIMIT 1`).get(device_id, device_id, device_id);
          board_profile_id = String(dev?.board_profile_id || '').trim() || null;
        } catch {}
      }
      let source = source_hint || null;
      let port_id = null;
      let bus_id = null;
      if (board_profile_id && source_hint) {
        const profile = getCatalogProfile(dbApi.db, board_profile_id);
        if (profile) {
          const port = findBoardPort(profile, source_hint);
          const bus = port ? null : findBoardBus(profile, source_hint);
          if (port) { port_id = String(port.id || source_hint).trim() || null; source = String(port.id || source_hint).trim() || null; }
          else if (bus) { bus_id = String(bus.id || source_hint).trim() || null; source = String(bus.id || source_hint).trim() || null; }
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
      const out = dbApi.approvePending({ pending_id, name, type: finalType, zone_id, hw_type, kind, unit, source, port_id, bus_id, board_profile_id });
      const sid = (site_id === undefined || site_id === null || site_id === '') ? null : Number(site_id);
      if (sid && Number.isFinite(sid) && device_id && dbApi.assignDeviceToSite) {
        dbApi.assignDeviceToSite(device_id, sid);
      }
      res.json({ ok: true, ...out });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
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
