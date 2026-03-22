'use strict';
// src/api/devices_routes.js — /api/devices/*
const express = require('express');

function initDevicesRoutes({ dbApi, mqttApi, engine, access, requireEngineerAccess }) {
  const router = express.Router();
  const getIOByDeviceAndKey = dbApi.db.prepare(`SELECT * FROM io WHERE device_id=? AND key=? LIMIT 1`);

  function requireDeviceAccess(req, res, deviceId) {
    const ref = access.getDeviceSiteRef(deviceId);
    if (!ref) { res.status(404).json({ ok: false, error: 'device_not_found' }); return false; }
    if (!access.canAccessSiteRef(req, ref)) { res.status(403).json({ ok: false, error: 'forbidden' }); return false; }
    return true;
  }

  router.get('/', (req, res) => {
    const devices = dbApi.listDevicesFromState
      .all()
      .map(r => r.device_id)
      .filter(id => access.canAccessSiteRef(req, access.getDeviceSiteRef(id)));
    res.json({ devices });
  });

  router.get('/:id/state', (req, res) => {
    if (!requireDeviceAccess(req, res, req.params.id)) return;
    res.json({ deviceId: req.params.id, state: dbApi.getDeviceState.all(req.params.id) });
  });

  router.get('/:id/io', (req, res) => {
    if (!requireDeviceAccess(req, res, req.params.id)) return;
    res.json({ deviceId: req.params.id, io: dbApi.listIOByDevice.all(req.params.id) });
  });

  router.post('/:id/command', requireEngineerAccess, (req, res) => {
    if (!requireDeviceAccess(req, res, req.params.id)) return;
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: 'Missing key' });

    const io = getIOByDeviceAndKey.get(req.params.id, key);
    if (!io) return res.status(404).json({ ok: false, error: 'io_not_found' });

    if (engine?.sendIOCommand) {
      const result = engine.sendIOCommand(io, value ?? 'TOGGLE', {
        reason: 'Manual device command',
        source: 'api.devices.command',
      });
      return res.status(result.ok ? 200 : 400).json({ ...result, ts: Date.now() });
    }

    const result = mqttApi.sendCommand(req.params.id, key, value ?? 'TOGGLE');
    res.json({ ok: true, sent: result, ts: Date.now() });
  });

  return router;
}

module.exports = { initDevicesRoutes };
