import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import catalogRoutesModule from '../../src/api/esphome/catalog_routes.js';
import profileRegistryModule from '../../src/esphome/profile_registry.js';

const { seedProfileCatalog } = profileRegistryModule;

const { mountCatalogRoutes } = catalogRoutesModule;

function createApp() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
    delete(path, ...handlers) { routes.push({ method: 'DELETE', path, handlers }); },
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function findRoute(app, method, path) {
  const row = app.routes.find((r) => r.method === method && r.path === path);
  if (!row) throw new Error(`route not found: ${method} ${path}`);
  return row.handlers[row.handlers.length - 1];
}

describe('ESPHome catalog routes', () => {
  it('returns check payload with boards, ports and presets', () => {
    const app = createApp();
    const fakeDb = {
      exec() {},
      prepare(sql) {
        if (String(sql).includes('FROM esphome_board_profiles')) return { all: () => [] };
        if (String(sql).includes('FROM esphome_profile_capabilities')) return { all: () => [] };
        return { all: () => [], get: () => null, run: () => ({}) };
      },
    };
    mountCatalogRoutes({
      app,
      db: fakeDb,
      dataDir: '/tmp/elaris',
      requireLogin: (_req, _res, next) => next && next(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
    });

    const handler = findRoute(app, 'GET', '/api/esphome/check');
    const res = createRes();
    handler({}, res);

    expect(res.body).toEqual(expect.objectContaining({
      ok: expect.any(Boolean),
      ports: expect.any(Array),
      boards: expect.any(Array),
      presets: expect.any(Object),
    }));
  });

  it('parses YAML through the parse-yaml endpoint', async () => {
    const app = createApp();
    mountCatalogRoutes({
      app,
      db: null,
      dataDir: '/tmp/elaris',
      requireLogin: (_req, _res, next) => next && next(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
    });

    const handler = findRoute(app, 'POST', '/api/esphome/catalog/parse-yaml');
    const res = createRes();
    const req = {
      body: {
        yaml: `esphome:\n  name: test_node\n  friendly_name: Test Node\n\nsensor:\n  - platform: dallas_temp\n    name: \"Top Temp\"\n`,
      },
    };

    await handler(req, res);

    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      parsed: expect.objectContaining({ id: 'test_node', label: 'Test Node' }),
    }));
  });

  it('builds draft YAML for a supported plain GPIO peripheral', () => {
    const app = createApp();
    mountCatalogRoutes({
      app,
      db: null,
      dataDir: '/tmp/elaris',
      requireLogin: (_req, _res, next) => next && next(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
    });

    const handler = findRoute(app, 'POST', '/api/esphome/add-peripheral-to-draft');
    const res = createRes();
    const req = {
      body: {
        yaml_text: `esphome:\n  name: test_node\n  friendly_name: Test Node\n`,
        entity: {
          type: 'dht',
          name: 'Climate Sensor',
          key: 'climate_1',
          pin: 'GPIO32',
        },
      },
    };

    handler(req, res);

    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      yaml: expect.stringContaining('platform: dht'),
      validation: expect.objectContaining({ ok: true }),
    }));
    expect(res.body.yaml).toContain('Climate Sensor Temperature');
  });

  it('returns unknown_board_profile when validate is called without a catalog-backed profile id', () => {
    const app = createApp();
    mountCatalogRoutes({
      app,
      db: null,
      dataDir: '/tmp/elaris',
      requireLogin: (_req, _res, next) => next && next(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
    });

    const handler = findRoute(app, 'POST', '/api/esphome/validate');
    const res = createRes();
    const req = {
      body: {
        device_name: 'test-node',
        board_profile_id: 'generic_esp32dev',
        mqtt_host: '192.168.1.2',
        wifi_ssid: 'ssid',
        entities: [
          { key: 'temp_1', name: 'Temp 1', type: 'ds18b20', source: 'HT1' },
        ],
      },
    };

    handler(req, res);

    expect(res.body).toEqual(expect.objectContaining({
      ok: false,
      error: 'unknown_board_profile',
      validation: expect.objectContaining({ ok: false }),
    }));
  });

  it('validates successfully when board_profile_id exists in the catalog DB', () => {
    const db = new Database(':memory:');
    seedProfileCatalog(db, [{
      id: 'generic_esp32dev',
      label: 'Generic ESP32',
      platform: 'esp32',
      board: 'esp32dev',
      framework_default: 'arduino',
      supports: { wifi: true, ethernet: false },
      notes: [],
      source: 'test',
      source_url: null,
      definition: {
        id: 'generic_esp32dev',
        label: 'Generic ESP32',
        platform: 'esp32',
        board: 'esp32dev',
        frameworkDefault: 'arduino',
        supports: { wifi: true, ethernet: false },
        boardPorts: [
          { id: 'HT1', label: 'HT1', group: 'ht', pin: 'GPIO32', protocols: ['onewire', 'gpio'], supports: ['ds18b20'], shared_bus: true, multi_instance: true },
        ],
        entityDefaults: [],
      },
      capabilities: [],
    }]);

    const app = createApp();
    mountCatalogRoutes({
      app,
      db,
      dataDir: '/tmp/elaris',
      requireLogin: (_req, _res, next) => next && next(),
      requireEngineerAccess: (_req, _res, next) => next && next(),
    });

    const handler = findRoute(app, 'POST', '/api/esphome/validate');
    const res = createRes();
    const req = {
      body: {
        device_name: 'test-node',
        board_profile_id: 'generic_esp32dev',
        mqtt_host: '192.168.1.2',
        wifi_ssid: 'ssid',
        entities: [
          { key: 'temp_1', name: 'Temp 1', type: 'ds18b20', source: 'HT1' },
        ],
      },
    };

    handler(req, res);

    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      validation: expect.objectContaining({ ok: true }),
      yaml: expect.any(String),
      profile: expect.objectContaining({ id: 'generic_esp32dev', label: 'Generic ESP32' }),
    }));
    expect(res.body.yaml).toContain('platform: dallas_temp');
  });
});
