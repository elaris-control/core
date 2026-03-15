'use strict';
// src/api/io_routes.js — /api/io/* (history, overrides, entity updates)
// Also mounts /api/history/* for site-level history queries.
const express = require('express');

function initIoRoutes({ db, engine, access, requireLogin, requireEngineerAccess }) {
  const router = express.Router();

  // ── IMPORTANT: static paths BEFORE /:id wildcards ─────────────────────

  // GET /api/io/overrides
  router.get('/overrides', requireEngineerAccess, (req, res) => {
    res.json({ ok: true, overrides: engine.getIOOverrides() });
  });

  // GET /api/io/pinned
  router.get('/pinned', requireLogin, (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT io.*, ds.site_id,
               (SELECT sv.value FROM device_state sv WHERE sv.device_id=io.device_id AND sv.key=io.key ORDER BY sv.ts DESC LIMIT 1) AS value
        FROM io
        LEFT JOIN device_site ds ON ds.device_id = io.device_id
        WHERE io.pinned = 1 AND COALESCE(io.enabled, 1) = 1
        ORDER BY io.name
      `).all().filter(row => access.canAccessSiteRef(req, access.getDeviceSiteRef(row.device_id)));
      res.json({ ok: true, io: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // Helper: verify caller has access to a single IO entity by id.
  function checkIoAccess(req, res, ioId) {
    const ref = access.getIoSiteRef(ioId);
    if (!ref) { res.status(404).json({ ok: false, error: 'io_not_found' }); return false; }
    if (!access.canAccessSiteRef(req, ref)) { res.status(403).json({ ok: false, error: 'forbidden' }); return false; }
    return true;
  }

  // Helper: verify caller has access to ALL ids in a bulk operation.
  function checkBulkIoAccess(req, res, ids) {
    for (const id of ids) {
      const ref = access.getIoSiteRef(id);
      if (!access.canAccessSiteRef(req, ref)) {
        res.status(403).json({ ok: false, error: 'forbidden', id });
        return false;
      }
    }
    return true;
  }

  // POST /api/io/update  (entity field update — legacy endpoint)
  router.post('/update', requireEngineerAccess, (req, res) => {
    try {
      const id = Number(req.body?.id);
      if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
      if (!checkIoAccess(req, res, id)) return;
      const name    = req.body?.name    !== undefined ? String(req.body.name).trim() : undefined;
      const zone_id = req.body?.zone_id === '' || req.body?.zone_id === undefined ? undefined : (req.body.zone_id === null ? null : Number(req.body.zone_id));
      const enabled = req.body?.enabled === undefined ? undefined : (Number(req.body.enabled) ? 1 : 0);
      const parts = []; const params = [];
      if (name    !== undefined && name !== '') { parts.push('name=?');    params.push(name); }
      if (zone_id !== undefined)               { parts.push('zone_id=?'); params.push(zone_id); }
      if (enabled !== undefined)               { parts.push('enabled=?'); params.push(enabled); }
      if (!parts.length) return res.json({ ok: true, changed: 0 });
      params.push(id);
      const info = db.prepare(`UPDATE io SET ${parts.join(', ')} WHERE id=?`).run(...params);
      res.json({ ok: true, changed: info.changes || 0 });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  // POST /api/io/bulk
  router.post('/bulk', requireEngineerAccess, (req, res) => {
    try {
      const action = String(req.body?.action || '');
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'no_ids' });
      if (!checkBulkIoAccess(req, res, ids)) return;
      const qm = ids.map(() => '?').join(',');
      let info = { changes: 0 };
      if (action === 'enable')  { info = db.prepare(`UPDATE io SET enabled=1 WHERE id IN (${qm})`).run(...ids); }
      else if (action === 'disable') { info = db.prepare(`UPDATE io SET enabled=0 WHERE id IN (${qm})`).run(...ids); }
      else if (action === 'zone') {
        const zone_id = (req.body?.zone_id === null || req.body?.zone_id === '' || req.body?.zone_id === undefined) ? null : Number(req.body.zone_id);
        info = db.prepare(`UPDATE io SET zone_id=? WHERE id IN (${qm})`).run(zone_id, ...ids);
      } else if (action === 'delete') {
        db.prepare(`DELETE FROM module_mappings WHERE io_id IN (${qm})`).run(...ids);
        info = db.prepare(`DELETE FROM io WHERE id IN (${qm})`).run(...ids);
      } else { return res.status(400).json({ ok: false, error: 'bad_action' }); }
      res.json({ ok: true, changes: info.changes || 0 });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  // PATCH /api/io/:id  (entity field update — settings page)
  router.patch('/:id', requireEngineerAccess, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
      if (!checkIoAccess(req, res, id)) return;
      const name    = req.body?.name    !== undefined ? String(req.body.name).trim() : undefined;
      const zone_id = req.body?.zone_id === undefined ? undefined : (req.body.zone_id === null ? null : Number(req.body.zone_id));
      const enabled = req.body?.enabled === undefined ? undefined : (Number(req.body.enabled) ? 1 : 0);
      const pinned  = req.body?.pinned  === undefined ? undefined : (req.body.pinned ? 1 : 0);
      const parts = []; const params = [];
      if (name    !== undefined) { parts.push('name=?');    params.push(name); }
      if (zone_id !== undefined) {
        if (zone_id === null || Number.isNaN(zone_id)) parts.push('zone_id=NULL');
        else { parts.push('zone_id=?'); params.push(zone_id); }
      }
      if (enabled !== undefined) { parts.push('enabled=?'); params.push(enabled); }
      if (pinned  !== undefined) { parts.push('pinned=?');  params.push(pinned); }
      if (!parts.length) return res.json({ ok: true, changes: 0 });
      params.push(id);
      const info = db.prepare(`UPDATE io SET ${parts.join(', ')} WHERE id=?`).run(...params);
      res.json({ ok: true, changes: info.changes || 0 });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  // GET /api/io/:io_id/history
  router.get('/:io_id/history', requireLogin, (req, res) => {
    try {
      const io_id = Number(req.params.io_id);
      const hours = Math.min(Number(req.query.hours) || 24, 168);
      const since = Date.now() - hours * 3600 * 1000;
      const io = db.prepare('SELECT * FROM io WHERE id=?').get(io_id);
      if (!io) return res.status(404).json({ ok: false, error: 'IO not found' });
      const siteRef = access.getIoSiteRef(io_id);
      if (!siteRef || !access.canAccessSiteRef(req, siteRef)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const rows = db.prepare(`
        SELECT payload as value, ts FROM events
        WHERE device_id=? AND topic LIKE ? AND ts >= ?
        ORDER BY ts ASC LIMIT 2000
      `).all(io.device_id, `%/${io.key}`, since);
      const isNumeric = ['sensor', 'analog', 'ai'].includes(io.type);
      const points = rows.map(r => {
        let v;
        if (isNumeric) { v = parseFloat(r.value); if (isNaN(v)) return null; }
        else { const s = String(r.value).toUpperCase().trim(); v = (s === 'ON' || s === '1' || s === 'TRUE') ? 1 : 0; }
        return { ts: r.ts, v };
      }).filter(Boolean);
      res.json({ ok: true, io: { id: io_id, key: io.key, name: io.name || io.key, type: io.type, unit: io.unit || '' }, points });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // PATCH /api/io/:io_id/override
  router.patch('/:io_id/override', requireEngineerAccess, (req, res) => {
    try {
      const io_id   = Number(req.params.io_id);
      if (!checkIoAccess(req, res, io_id)) return;
      const body    = req.body || {};
      const override = engine.setIOOverride(io_id, {
        value:            body.value ?? '',
        active:           !!body.active,
        duration_ms:      body.duration_ms,
        duration_minutes: body.duration_minutes,
        duration_s:       body.duration_s,
        expires_at:       body.expires_at,
        permanent:        body.permanent,
        duration:         body.duration,
      });
      res.json({ ok: true, io_id, override });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  return router;
}

// GET /api/history/site/:site_id — mounted separately
function initHistoryRoutes({ db, access, requireLogin }) {
  const router = express.Router();

  router.get('/site/:site_id', requireLogin, (req, res) => {
    try {
      const site_id = Number(req.params.site_id);
      const siteRef = access.getSiteRef(site_id);
      if (!siteRef) return res.status(404).json({ ok: false, error: 'site_not_found' });
      if (!access.canAccessSiteRef(req, siteRef)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const ios = db.prepare(`
        SELECT io.id, io.key, io.name, io.type, io.unit, io.device_id, io.group_name
        FROM io
        JOIN device_site ds ON ds.device_id = io.device_id
        WHERE ds.site_id = ? AND io.enabled = 1
        ORDER BY io.type, io.name
      `).all(site_id);
      res.json({ ok: true, ios });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
}

module.exports = { initIoRoutes, initHistoryRoutes };
