'use strict';
// src/api/notifications_routes.js — /api/notifications/*
const express = require('express');

function redactChannelConfig(channel) {
  let cfg = {};
  try { cfg = JSON.parse(channel.config_json || '{}'); } catch {}
  if (channel.type === 'email') {
    delete cfg.pass; // strip SMTP password
  } else if (channel.type === 'webhook') {
    // Mask full webhook URL — keep only scheme + first 16 chars of host
    if (cfg.url) {
      try {
        const u = new URL(cfg.url);
        cfg.url = `${u.protocol}//${u.hostname.slice(0, 16)}…`;
      } catch { cfg.url = '***'; }
    }
    // Strip embedded auth tokens
    delete cfg.secret;
    delete cfg.token;
    delete cfg.auth;
    delete cfg.authorization;
  }
  return { ...channel, config_json: JSON.stringify(cfg), config: cfg };
}

function initNotificationsRoutes({ notifyApi, requireEngineerAccess }) {
  const router = express.Router();

  router.get('/channels', requireEngineerAccess, (req, res) => {
    res.json({ ok: true, channels: notifyApi.listChannels().map(redactChannelConfig) });
  });

  router.post('/channels', requireEngineerAccess, (req, res) => {
    try {
      const { name, type, config } = req.body;
      if (!name || !type || !config) return res.status(400).json({ ok: false, error: 'missing_fields' });
      const id = notifyApi.createChannel(name, type, config);
      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.put('/channels/:id', requireEngineerAccess, (req, res) => {
    try {
      const { name, type, config, enabled } = req.body;
      notifyApi.updateChannel(Number(req.params.id), name, type, config, enabled);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.delete('/channels/:id', requireEngineerAccess, (req, res) => {
    try { notifyApi.deleteChannel(Number(req.params.id)); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.post('/test/:id', requireEngineerAccess, async (req, res) => {
    try {
      const result = await notifyApi.notifyOne(Number(req.params.id), {
        title: 'ELARIS Test', body: 'Channel test successful.', level: 'info', tag: `test_${Date.now()}`,
      });
      res.json({ ok: !!result.ok, result });
    } catch (e) {
      res.status(e.message === 'not_found' ? 404 : 400).json({ ok: false, error: e.message });
    }
  });

  router.post('/send', requireEngineerAccess, async (req, res) => {
    try {
      const { title, body, level } = req.body;
      const results = await notifyApi.notify({ title, body, level: level || 'info', tag: 'manual', cooldown_s: 0 });
      const ok = results.length > 0 && results.every(r => r.ok);
      res.json({ ok, results, success_count: results.filter(r => r.ok).length, fail_count: results.filter(r => !r.ok).length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/log', requireEngineerAccess, (req, res) => {
    res.json({ ok: true, log: notifyApi.listLog() });
  });

  return router;
}

module.exports = { initNotificationsRoutes };
