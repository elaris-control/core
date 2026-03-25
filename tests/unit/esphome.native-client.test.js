import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import profileRegistryModule from '../../src/esphome/profile_registry.js';

const { seedProfileCatalog, ensureProfileCatalogTables } = profileRegistryModule;

function makeDb() {
  const db = new Database(':memory:');
  ensureProfileCatalogTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS esphome_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      name TEXT,
      friendly_name TEXT,
      board_profile_id TEXT,
      chip TEXT,
      framework TEXT,
      transport TEXT,
      network_mode TEXT,
      status TEXT,
      serial_port TEXT,
      mac_address TEXT,
      ip_address TEXT,
      hostname TEXT,
      mqtt_topic_root TEXT,
      firmware_version TEXT,
      yaml_path TEXT,
      yaml_hash TEXT,
      last_validation_json TEXT,
      integration_key TEXT,
      ownership_mode TEXT,
      config_source TEXT,
      read_only INTEGER,
      last_seen_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS pending_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      device_id TEXT,
      key TEXT,
      group_name TEXT,
      first_seen INTEGER,
      last_seen INTEGER,
      last_value TEXT,
      UNIQUE(device_id, group_name, key)
    );
    CREATE TABLE IF NOT EXISTS blocked_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      group_name TEXT,
      key TEXT
    );
    CREATE TABLE IF NOT EXISTS device_site (
      device_id TEXT PRIMARY KEY,
      site_id INTEGER,
      assigned_ts INTEGER
    );
  `);
  return db;
}

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
        { id: 'HT1', label: 'HT1', group: 'ht', pin: 'GPIO32', protocols: ['onewire', 'gpio'], supports: ['ds18b20'], shared_bus: true, multi_instance: true },
        { id: 'RELAY1', label: 'Relay 1', group: 'do', pin: 'GPIO26', protocols: ['gpio'], supports: ['relay'] },
      ],
      entityDefaults: [],
    },
    capabilities: [],
  }]);
}

let FakeEspHomeClient;

async function loadClientModule({ failImport = false } = {}) {
  vi.resetModules();
  FakeEspHomeClient = class {
    constructor(opts) {
      this.opts = opts;
      this.handlers = new Map();
      this.calls = [];
      FakeEspHomeClient.instances.push(this);
    }
    on(event, cb) { this.handlers.set(event, cb); }
    emit(event, payload) { const cb = this.handlers.get(event); if (cb) cb(payload); }
    connect() {
      this.calls.push(['connect']);
      this.emit('connect', false);
      this.emit('deviceInfo', { name: 'Boiler Node', macAddress: 'AA:BB', model: 'ESP32' });
      this.emit('entities', [
        { entity: 'switch-relay1', objectId: 'relay1', name: 'Relay 1', type: 'switch' },
        { entity: 'climate-room', objectId: 'room', name: 'Room Climate', type: 'climate' },
      ]);
    }
    disconnect() { this.calls.push(['disconnect']); }
    sendSwitchCommand(id, state) { this.calls.push(['switch', id, state]); }
    sendClimateCommand(id, payload) { this.calls.push(['climate', id, payload]); }
  };
  FakeEspHomeClient.instances = [];

  if (failImport) {
    vi.doMock('esphome-client', () => { throw new Error('missing_dep'); });
  } else {
    vi.doMock('esphome-client', () => ({ EspHomeClient: FakeEspHomeClient }));
  }
  return import('../../src/integrations/esphome/native_client.js');
}

describe('ESPHome native client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.doUnmock('esphome-client');
    vi.resetModules();
  });

  it('connects through the native client and emits live entity state', async () => {
    const db = makeDb();
    seedProfile(db);
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, ip_address, status, updated_at)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', '192.168.1.50', 'imported', datetime('now'))`).run();

    const updates = [];
    const mod = await loadClientModule();
    const client = mod.createEspHomeNativeClient({ db, onUpdate: (s) => updates.push(s) }, { device_name: 'boiler_node', api_host: '192.168.1.50' });

    const snapshot = await client.connect();

    expect(snapshot).toEqual(expect.objectContaining({
      connected: true,
      live_stream: true,
      state: 'connected',
      entities: expect.arrayContaining([
        expect.objectContaining({ entity_id: 'switch-relay1', key: 'relay1' }),
        expect.objectContaining({ entity_id: 'climate-room', key: 'room' }),
      ]),
    }));
    expect(updates.at(-1)).toEqual(expect.objectContaining({ connected: true, live_stream: true }));
  });

  it('executes switch and climate commands against resolved native entities', async () => {
    const db = makeDb();
    seedProfile(db);
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, ip_address, status, updated_at)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', '192.168.1.50', 'imported', datetime('now'))`).run();

    const mod = await loadClientModule();
    const client = mod.createEspHomeNativeClient({ db }, { device_name: 'boiler_node', api_host: '192.168.1.50' });
    const snapshot = await client.connect();
    const switchEntity = snapshot.entities.find((e) => e.entity_type === 'switch');
    const climateEntity = snapshot.entities.find((e) => e.entity_type === 'climate');

    const switchResult = await client.executeCommand({ entity_id: switchEntity.entity_id, action: 'on' });
    const climateResult = await client.executeCommand({ entity_id: climateEntity.entity_id, mode: 'heat', target_temperature: 21 });

    const inst = FakeEspHomeClient.instances[0];
    expect(inst.calls).toEqual(expect.arrayContaining([
      ['switch', 'switch-relay1', true],
      ['climate', 'climate-room', expect.objectContaining({ mode: 'heat', targetTemperature: 21 })],
    ]));
    expect(switchResult.command_result).toEqual(expect.objectContaining({ entity_key: 'relay1', request: { action: 'on', state: true } }));
    expect(climateResult.command_result).toEqual(expect.objectContaining({ entity_id: 'climate-room' }));
  });

  it('falls back to probe-assisted mode when esphome-client dependency is unavailable', async () => {
    const db = makeDb();
    seedProfile(db);
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, ip_address, status, updated_at)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', '192.168.1.50', 'imported', datetime('now'))`).run();

    const mod = await loadClientModule({ failImport: true });
    const client = mod.createEspHomeNativeClient({ db }, { device_name: 'boiler_node', api_host: '192.168.1.50' });

    const snap = await client.connect({ connect_timeout_ms: 1000 });

    expect(snap).toEqual(expect.objectContaining({
      fallback: true,
      session_mode: 'probe_assisted',
      discovery: expect.objectContaining({ ok: true }),
    }));
  });

  it('requires a live session before executeCommand', async () => {
    const db = makeDb();
    const mod = await loadClientModule();
    const client = mod.createEspHomeNativeClient({ db }, { device_name: 'boiler_node', api_host: '192.168.1.50' });

    await expect(client.executeCommand({ entity_key: 'relay1', action: 'on' })).rejects.toMatchObject({ code: 'native_command_requires_live_session' });
  });
});
