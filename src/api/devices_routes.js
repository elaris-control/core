'use strict';
// src/api/devices_routes.js — /api/devices/*
const express = require('express');

function initDevicesRoutes({ dbApi, mqttApi, access, requireEngineerAccess }) {
  const router = express.Router();

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
    const result = mqttApi.sendCommand(req.params.id, key, value ?? 'TOGGLE');
    res.json({ ok: true, sent: result, ts: Date.now() });
  });

  return router;
}

module.exports = { initDevicesRoutes };
