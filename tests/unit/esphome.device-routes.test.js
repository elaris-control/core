import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import deviceRoutesModule from '../../src/api/esphome/device_routes.js';

const { mountDeviceRoutes } = deviceRoutesModule;

function createApp() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
    patch(path, ...handlers) { routes.push({ method: 'PATCH', path, handlers }); },
    delete(path, ...handlers) { routes.push({ method: 'DELETE', path, handlers }); },
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    contentType: null,
    sentText: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    type(value) { this.contentType = value; return this; },
    send(text) { this.sentText = text; return this; },
  };
}

function findRoute(app, method, routePath) {
  const row = app.routes.find((r) => r.method === method && r.path === routePath);
  if (!row) throw new Error(`route not found: ${method} ${routePath}`);
  return row.handlers[row.handlers.length - 1];
}

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elaris-esphome-device-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('ESPHome device routes', () => {
  it('returns empty devices list when DB is unavailable', () => {
    const app = createApp();
    mountDeviceRoutes({
      app,
      db: null,
      cfgDir: makeTempDir(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: null,
      stmts: { getDevicesByName: null },
    });

    const handler = findRoute(app, 'GET', '/api/esphome/devices');
    const res = createRes();
    handler({}, res);

    expect(res.body).toEqual({ devices: [] });
  });

  it('reads saved YAML by device name', () => {
    const cfgDir = makeTempDir();
    fs.writeFileSync(path.join(cfgDir, 'test_node.yaml'), 'esphome:\n  name: test_node\n', 'utf8');
    const app = createApp();
    mountDeviceRoutes({
      app,
      db: null,
      cfgDir,
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: null,
      stmts: { getDevicesByName: null },
    });

    const handler = findRoute(app, 'GET', '/api/esphome/yaml/:name');
    const res = createRes();
    handler({ params: { name: 'test_node' } }, res);

    expect(res.contentType).toBe('text/plain');
    expect(res.sentText).toContain('name: test_node');
  });

  it('saves and lists redacted config snapshots', () => {
    const cfgDir = makeTempDir();
    const app = createApp();
    mountDeviceRoutes({
      app,
      db: null,
      cfgDir,
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: null,
      stmts: { getDevicesByName: null },
    });

    const saveHandler = findRoute(app, 'POST', '/api/esphome/configs');
    const listHandler = findRoute(app, 'GET', '/api/esphome/configs');

    const saveRes = createRes();
    saveHandler({ body: { device_name: 'test_node', wifi_pass: 'secret', mqtt_host: '192.168.1.2' } }, saveRes);
    expect(saveRes.body).toEqual({ ok: true });

    const listRes = createRes();
    listHandler({}, listRes);
    expect(listRes.body.configs).toHaveLength(1);
    expect(listRes.body.configs[0]).toEqual(expect.objectContaining({ device_name: 'test_node', mqtt_host: '192.168.1.2' }));
  });
});
