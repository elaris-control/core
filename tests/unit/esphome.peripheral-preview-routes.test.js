import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import peripheralRoutesModule from '../../src/api/esphome/peripheral_routes.js';
import profileRegistryModule from '../../src/esphome/profile_registry.js';
import { addPeripheralToYaml } from '../../src/esphome/generator.js';

const { mountPeripheralRoutes } = peripheralRoutesModule;
const { seedProfileCatalog } = profileRegistryModule;

function createApp() {
  const routes = [];
  return {
    routes,
    get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); },
    post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); },
    delete(routePath, ...handlers) { routes.push({ method: 'DELETE', path: routePath, handlers }); },
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

function findRoute(app, method, routePath) {
  const row = app.routes.find((r) => r.method === method && r.path === routePath);
  if (!row) throw new Error(`route not found: ${method} ${routePath}`);
  return row.handlers[row.handlers.length - 1];
}

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elaris-esphome-preview-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function seedProfile(db) {
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
        { id: 'HT1', label: 'HT1', group: 'ht', pin: 'GPIO32', protocols: ['onewire', 'gpio'], supports: ['ds18b20', 'dht'], shared_bus: true, multi_instance: true },
      ],
      boardBuses: [
        { id: 'bus_a', label: 'I²C Bus A', protocol: 'i2c', sda: 21, scl: 22, supports: ['bh1750', 'sht3x'], addresses: ['0x23', '0x44'] },
      ],
      pinRules: { reserved: [], inputOnly: [34,35,36,39], noPullup: [34,35,36,39], flashPins: [6,7,8,9,10,11], strapping: [0,2,5,12,15] },
      entityDefaults: [],
    },
    capabilities: [],
  }]);
}

describe('ESPHome peripheral preview routes', () => {
  it('adds a draft peripheral preview to device YAML', () => {
    const cfgDir = makeTempDir();
    const yamlPath = path.join(cfgDir, 'test_node.yaml');
    fs.writeFileSync(yamlPath, 'esphome:\n  name: test_node\n  friendly_name: Test Node\n', 'utf8');

    const db = new Database(':memory:');
    seedProfile(db);
    const device = { id: 1, name: 'test_node', friendly_name: 'Test Node', board_profile_id: 'generic_esp32dev', yaml_path: yamlPath };
    const app = createApp();
    mountPeripheralRoutes({
      app,
      db,
      wsApi: null,
      dataDir: cfgDir,
      cfgDir,
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: { canAccessSite: () => true },
      state: { activeFlash: null },
      stmts: { getDeviceById: { get: () => device } },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/add-peripheral/preview');
    const res = createRes();
    handler({ body: { device_id: 1, entity: { type: 'dht', name: 'Climate Sensor', key: 'climate_1', port_id: 'HT1' } } }, res);

    expect(res.body).toEqual(expect.objectContaining({ ok: true, yaml: expect.any(String) }));
    expect(res.body.yaml).toContain('platform: dht');
    expect(res.body.yaml).toContain('Climate Sensor Temperature');
  });

  it('marks replaceable board ports for DI → sensor conversions in pin options', () => {
    const cfgDir = makeTempDir();
    const yamlPath = path.join(cfgDir, 'test_node.yaml');
    const baseYaml = 'esphome:\n  name: test_node\n  friendly_name: Test Node\n';
    const managedYaml = addPeripheralToYaml(baseYaml, 'test_node', {
      type: 'di', name: 'HT1 DI', key: 'ht1_di', pin: 'GPIO32'
    }, { deviceName: 'Test Node', boardLabel: 'Generic ESP32', boardProfileId: 'generic_esp32dev' });
    fs.writeFileSync(yamlPath, managedYaml, 'utf8');

    const db = new Database(':memory:');
    seedProfile(db);
    const device = { id: 1, name: 'test_node', friendly_name: 'Test Node', board_profile_id: 'generic_esp32dev', yaml_path: yamlPath };
    const app = createApp();
    mountPeripheralRoutes({
      app,
      db,
      wsApi: null,
      dataDir: cfgDir,
      cfgDir,
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: { canAccessSite: () => true },
      state: { activeFlash: null },
      stmts: { getDeviceById: { get: () => device } },
    });

    const handler = findRoute(app, 'GET', '/api/esphome/device/:id/pin-options');
    const res = createRes();
    handler({ params: { device_id: '1' } }, res);

    expect(res.statusCode).toBe(200);
    const ht1 = (res.body.sensorPorts || []).find((p) => p.portId === 'HT1');
    expect(ht1).toBeTruthy();
    expect(ht1.inUse).toBe(true);
    expect(ht1.replaceable).toBe(true);
    expect(ht1.replaceableTypes).toContain('ds18b20');
    expect(ht1.replaceTarget).toEqual(expect.objectContaining({ name: 'HT1 DI' }));
  });

  it('edits an existing managed peripheral preview', () => {
    const cfgDir = makeTempDir();
    const yamlPath = path.join(cfgDir, 'test_node.yaml');
    fs.writeFileSync(yamlPath, `esphome:\n  name: test_node\n  friendly_name: Test Node\n\nsensor:\n  - platform: dht\n    pin: GPIO32\n    model: DHT22\n    temperature:\n      name: \"Climate Sensor Temperature\"\n      id: climate_1\n    humidity:\n      name: \"Climate Sensor Humidity\"\n      id: climate_1_hum\n`, 'utf8');

    const db = new Database(':memory:');
    seedProfile(db);
    const device = { id: 1, name: 'test_node', friendly_name: 'Test Node', board_profile_id: 'generic_esp32dev', yaml_path: yamlPath };
    const app = createApp();
    mountPeripheralRoutes({
      app,
      db,
      wsApi: null,
      dataDir: cfgDir,
      cfgDir,
      requireEngineerAccess: (_req, _res, next) => next && next(),
      access: { canAccessSite: () => true },
      state: { activeFlash: null },
      stmts: { getDeviceById: { get: () => device } },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/peripheral/edit/preview');
    const res = createRes();
    handler({ body: { device_id: 1, original_key: 'climate_1', entity: { type: 'dht', name: 'Indoor Climate', key: 'climate_main', port_id: 'HT1' } } }, res);

    expect(res.body).toEqual(expect.objectContaining({ ok: true, yaml: expect.any(String), previous: expect.objectContaining({ key: 'climate_1' }) }));
    expect(res.body.yaml).toContain('Indoor Climate Temperature');
    expect(res.body.yaml).toContain('id: climate_main');
  });
});
