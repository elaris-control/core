'use strict';
// src/api/esphome/browser_routes.js — ESPHome device browser (GitHub)

const { fetchGitHub, fetchDeviceYaml } = require('../../esphome/helpers');

const _browserCache = { list: null, ts: 0 };
const BROWSER_TTL = 60 * 60 * 1000;

function mountBrowserRoutes({ app, requireLogin, requireEngineerAccess }) {

  app.get('/api/esphome/device-browser/list', requireLogin, async (req, res) => {
    try {
      if (_browserCache.list && Date.now() - _browserCache.ts < BROWSER_TTL) {
        return res.json({ ok: true, devices: _browserCache.list, cached: true });
      }
      const items = await fetchGitHub('/repos/esphome/esphome-devices/contents/src/docs/devices');
      if (!Array.isArray(items)) throw new Error('Unexpected response from GitHub');
      const devices = items.filter(i => i.type === 'dir').map(i => ({ slug: i.name }));
      _browserCache.list = devices;
      _browserCache.ts = Date.now();
      res.json({ ok: true, devices, cached: false });
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/esphome/device-browser/yaml', requireEngineerAccess, async (req, res) => {
    const slug = String(req.query.device || '').trim().replace(/[^a-z0-9_-]/gi, '');
    if (!slug) return res.status(400).json({ ok: false, error: 'device slug required' });
    try {
      const yaml = await fetchDeviceYaml(slug);
      res.json({ ok: true, yaml, slug });
    } catch (e) {
      res.status(404).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

module.exports = { mountBrowserRoutes };
