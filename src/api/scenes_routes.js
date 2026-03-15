'use strict';
// src/api/scenes_routes.js — /api/scenes/*
const express = require('express');

function initScenesRoutes({ scenesApi, access, engine, mqttApi, notifyApi, wsApi, requireLogin, requireEngineerAccess }) {
  const router = express.Router();

  // ── Helpers ────────────────────────────────────────────────────────────
  function checkScene(req, res, sceneId) {
    const ref = access.getSceneSiteRef(sceneId);
    if (!ref) { res.status(404).json({ ok: false, error: 'scene_not_found' }); return null; }
    if (!access.canAccessSiteRef(req, ref)) { res.status(403).json({ ok: false, error: 'forbidden' }); return null; }
    return ref;
  }

  function checkSite(req, res, siteId) {
    const ref = access.getSiteRef(siteId);
    if (!ref) { res.status(404).json({ ok: false, error: 'site_not_found' }); return null; }
    if (!access.canAccessSiteRef(req, ref)) { res.status(403).json({ ok: false, error: 'forbidden' }); return null; }
    return ref;
  }

  // ── IMPORTANT: static routes BEFORE /:id ──────────────────────────────
  router.get('/log', requireLogin, (req, res) => {
    const log = scenesApi.listLog().filter(e => access.canAccessSite(req, e.site_id));
    res.json({ ok: true, log });
  });

  // ── Scenes CRUD ────────────────────────────────────────────────────────
  router.get('/', requireLogin, (req, res) => {
    const site_id = req.query.site_id ? Number(req.query.site_id) : null;
    if (site_id != null && !checkSite(req, res, site_id)) return;
    const scenes = scenesApi.listScenes(site_id).filter(s => access.canAccessSite(req, s.site_id));
    res.json({ ok: true, scenes });
  });

  router.post('/', requireEngineerAccess, (req, res) => {
    try {
      const { name, icon, color, actions, site_id } = req.body;
      if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
      if (site_id != null && !checkSite(req, res, site_id)) return;
      const id = scenesApi.createScene(name, icon, color, actions, site_id ?? null);
      res.json({ ok: true, id });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  router.put('/:id', requireEngineerAccess, (req, res) => {
    try {
      if (!checkScene(req, res, req.params.id)) return;
      const { name, icon, color, actions, site_id } = req.body;
      if (site_id != null && !checkSite(req, res, site_id)) return;
      scenesApi.updateScene(Number(req.params.id), name, icon, color, actions, site_id ?? null);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.delete('/:id', requireEngineerAccess, (req, res) => {
    try {
      if (!checkScene(req, res, req.params.id)) return;
      scenesApi.deleteScene(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.post('/:id/activate', requireLogin, async (req, res) => {
    try {
      const ref = checkScene(req, res, req.params.id);
      if (!ref) return;
      const result = await scenesApi.activate(Number(req.params.id), {
        engine, mqttApi, notify: notifyApi.notify, triggeredBy: 'dashboard',
      });
      wsApi.broadcast({ type: 'scene_activated', scene_id: Number(req.params.id), site_id: ref.site_id ?? null, siteId: ref.site_id ?? null, ts: Date.now() });
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Schedules — static /schedules/:id BEFORE /:id/schedules ───────────
  router.put('/schedules/:id', requireEngineerAccess, (req, res) => {
    try {
      const ref = access.getSceneScheduleSiteRef(req.params.id);
      if (!ref) return res.status(404).json({ ok: false, error: 'schedule_not_found' });
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const { time, days, enabled } = req.body;
      scenesApi.updateSchedule(Number(req.params.id), time, days, enabled);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.delete('/schedules/:id', requireEngineerAccess, (req, res) => {
    try {
      const ref = access.getSceneScheduleSiteRef(req.params.id);
      if (!ref) return res.status(404).json({ ok: false, error: 'schedule_not_found' });
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      scenesApi.deleteSchedule(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.get('/:id/schedules', requireLogin, (req, res) => {
    if (!checkScene(req, res, req.params.id)) return;
    res.json({ ok: true, schedules: scenesApi.getSchedulesByScene(Number(req.params.id)) });
  });

  router.post('/:id/schedules', requireEngineerAccess, (req, res) => {
    try {
      if (!checkScene(req, res, req.params.id)) return;
      const { time, days } = req.body;
      if (!time || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ ok: false, error: 'invalid_time' });
      const id = scenesApi.createSchedule(Number(req.params.id), time, days);
      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  return router;
}

module.exports = { initScenesRoutes };
