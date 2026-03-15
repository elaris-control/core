'use strict';
// src/api/automation_routes.js — /api/automation/*
const express = require('express');
const { getModule } = require('../modules/index');

function initAutomationRoutes({ engine, access, auth, hasFeature, requireLogin, requireEngineerAccess, isEngineerLike, getInstanceWithDefinition, ensureUserModuleAccess }) {
  const router = express.Router();

  router.get('/status/:id', requireLogin, (req, res) => {
    try {
      const result = ensureUserModuleAccess(req, res, Number(req.params.id), ({ ui }) => !!ui.user_view);
      if (!result) return;
      res.json({ ok: true, ...engine.getLiveStatus(Number(req.params.id)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/settings/:id', requireEngineerAccess, (req, res) => {
    try {
      const id  = Number(req.params.id);
      const ref = access.getModuleInstanceSiteRef(id);
      if (!ref) return res.status(404).json({ ok: false, error: 'instance_not_found' });
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      res.json({ ok: true, settings: engine.getSettings(id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.patch('/settings/:id', requireEngineerAccess, (req, res) => {
    try {
      const id  = Number(req.params.id);
      const ref = access.getModuleInstanceSiteRef(id);
      if (!ref) return res.status(404).json({ ok: false, error: 'instance_not_found' });
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const { key, value } = req.body;
      const v = engine.setSetting(id, key, value);
      res.json({ ok: true, value: v });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.get('/log/:id', requireLogin, (req, res) => {
    try {
      const result = ensureUserModuleAccess(req, res, Number(req.params.id), ({ ui }) => !!ui.user_view);
      if (!result) return;
      res.json({ ok: true, log: engine.getLog(Number(req.params.id), 100) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  const _getInstanceForCommand = engine._db
    ? engine._db.prepare(`SELECT * FROM module_instances WHERE id = ? AND active = 1`)
    : null;

  router.post('/instances/:id/command', requireEngineerAccess, (req, res) => {
    try {
      const instId = Number(req.params.id);
      const inst = (_getInstanceForCommand || engine._getInstances).get
        ? _getInstanceForCommand.get(instId)
        : engine._getInstances.all().find(i => i.id === instId);
      if (!inst) return res.status(404).json({ ok: false, error: 'instance_not_found' });
      const ref = access.getModuleInstanceSiteRef(instId);
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });

      const { command, args } = req.body || {};
      if (!command) return res.status(400).json({ ok: false, error: 'missing_command' });

      if (String(command) === 'reset_lock') {
        if (!hasFeature('engineer_tools')) return res.status(403).json({ ok: false, error: 'engineer_not_licensed' });
        if (auth.getRole(req) !== 'ENGINEER') return res.status(401).json({ ok: false, error: 'engineer_required' });
      }

      const def = getModule(inst.module_id);
      const fn  = def?.commands?.[command];
      if (!fn) return res.status(404).json({ ok: false, error: 'command_not_supported' });

      const ctx    = engine.makeCtx(inst);
      const result = fn(ctx, args || {});
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/override/:id', requireEngineerAccess, (req, res) => {
    try {
      const id     = Number(req.params.id);
      const { inst } = getInstanceWithDefinition(id);
      if (!inst) return res.status(404).json({ ok: false, error: 'instance_not_found' });
      const ref = access.getModuleInstanceSiteRef(id);
      if (!access.canAccessSiteRef(req, ref)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const paused = !!req.body?.paused;
      engine.setOverride(id, paused);
      res.json({ ok: true, paused });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
}

module.exports = { initAutomationRoutes };
