import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import Database from 'better-sqlite3';
import nativeLiveModule from '../../src/integrations/esphome/native_live.js';
import profileRegistryModule from '../../src/esphome/profile_registry.js';

const { buildNativeRuntimePayload, probeNativeDevice, discoverNativeAssist, syncNativeAssist } = nativeLiveModule;
const { seedProfileCatalog, ensureProfileCatalogTables } = profileRegistryModule;

const servers = [];

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    await new Promise((resolve) => s.close(() => resolve()));
  }
});

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
      encryption_key TEXT,
      last_seen_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      device_id TEXT,
      key TEXT,
      name TEXT,
      group_name TEXT,
      type TEXT,
      source TEXT,
      port_id TEXT,
      bus_id TEXT,
      unit TEXT,
      metadata_json TEXT,
      first_seen INTEGER,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS pending_io (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      device_id TEXT,
      key TEXT,
      name TEXT,
      group_name TEXT,
      type TEXT,
      source TEXT,
      port_id TEXT,
      bus_id TEXT,
      unit TEXT,
      metadata_json TEXT,
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
    CREATE TABLE IF NOT EXISTS esphome_generated_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER,
      config_mode TEXT,
      board_profile_id TEXT,
      yaml_text TEXT,
      yaml_hash TEXT,
      validation_json TEXT,
      generated_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS esphome_install_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER,
      config_id INTEGER,
      job_type TEXT,
      target_ip TEXT,
      status TEXT,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      output_log TEXT,
      error_text TEXT
    );
    CREATE TABLE IF NOT EXISTS esphome_device_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER,
      override_key TEXT,
      override_value TEXT,
      created_at TEXT,
      updated_at TEXT
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

describe('ESPHome native live helpers', () => {
  it('builds native runtime payload from existing device identity', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, ip_address, hostname, status, updated_at)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', '192.168.1.50', 'boiler-node.local', 'online', datetime('now'))`).run();

    const payload = buildNativeRuntimePayload(db, { device_name: 'boiler_node' });

    expect(payload).toEqual(expect.objectContaining({
      site_id: 1,
      device_name: 'boiler_node',
      friendly_name: 'Boiler Node',
      board_profile_id: 'generic_esp32dev',
      ip_address: '192.168.1.50',
      hostname: 'boiler-node.local',
      api_host: '192.168.1.50',
      api_port: 6053,
    }));
  });

  it('probes native device reachability over TCP and updates existing record', async () => {
    const db = makeDb();
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, ip_address, hostname, status, updated_at)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', '127.0.0.1', 'boiler-node.local', 'imported', datetime('now'))`).run();

    const server = net.createServer((socket) => socket.end());
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const out = await probeNativeDevice(db, { device_name: 'boiler_node', api_host: '127.0.0.1', api_port: port, timeout_ms: 1000 });

    expect(out).toEqual(expect.objectContaining({ ok: true, reachable: true }));
    const row = db.prepare(`SELECT status, last_validation_json FROM esphome_devices WHERE name='boiler_node'`).get();
    expect(row.status).toBe('online');
    expect(String(row.last_validation_json)).toContain('last_probe');
  });

  it('discovers assisted entities from board profile and merges stored native entities', () => {
    const db = makeDb();
    seedProfile(db);
    const validationJson = JSON.stringify({
      entities: [
        { key: 'relay_1', name: 'Relay 1', entity_class: 'DO', group: 'state', type: 'relay', source: 'RELAY1', port_id: 'RELAY1' },
      ],
      native_runtime: {
        last_native_entities: [
          { key: 'temp_top', name: 'Top Temp', entity_class: 'AI', group: 'tele', type: 'sensor', source: 'HT1', port_id: 'HT1' },
        ],
      },
    });
    db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, status, updated_at, last_validation_json)
      VALUES (1, 'boiler_node', 'Boiler Node', 'generic_esp32dev', 'online', datetime('now'), ?)`).run(validationJson);

    const out = discoverNativeAssist(db, { device_name: 'boiler_node' });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      board_profile_id: 'generic_esp32dev',
      entity_count: expect.any(Number),
    }));
    expect(out.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'relay_1', port_id: 'RELAY1' }),
      expect.objectContaining({ key: 'temp_top', port_id: 'HT1' }),
    ]));
  });

  it('syncs discovered native assist entities into import step output', () => {
    const db = makeDb();
    seedProfile(db);

    const out = syncNativeAssist(db, {
      site_id: 2,
      device_name: 'native_node',
      friendly_name: 'Native Node',
      board_profile_id: 'generic_esp32dev',
      ip_address: '192.168.1.70',
      api_host: '192.168.1.70',
      api_port: 6053,
    });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      created: true,
      updated: false,
      device_id: 'native_node',
      imported_entities: 2,
      pending_injected: 2,
      blocked_skipped: 0,
    }));

    const device = db.prepare(`SELECT site_id, name, ownership_mode, config_source, read_only FROM esphome_devices WHERE name='native_node'`).get();
    expect(device).toEqual(expect.objectContaining({
      site_id: 2,
      name: 'native_node',
      ownership_mode: 'external_native',
      config_source: 'native_api',
      read_only: 1,
    }));

    const pending = db.prepare(`SELECT key, group_name, last_value FROM pending_io WHERE device_id='native_node' ORDER BY key ASC`).all();
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.key)).toEqual(expect.arrayContaining(['ht1', 'relay1']));
  });
});
