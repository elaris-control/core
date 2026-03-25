import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import profileRegistryModule from '../../src/esphome/profile_registry.js';

const { ensureProfileCatalogTables, seedProfileCatalog } = profileRegistryModule;

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

function findRoute(app, method, routePath) {
  const row = app.routes.find((r) => r.method === method && r.path === routePath);
  if (!row) throw new Error(`route not found: ${method} ${routePath}`);
  return row.handlers[row.handlers.length - 1];
}

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elaris-flash-'));
  tempDirs.push(dir);
  return dir;
}

function writeFakeEspHomeBin(dataDir) {
  const binDir = path.join(dataDir, 'esphome_venv', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, 'esphome');
  fs.writeFileSync(binPath, '#!/usr/bin/env sh\necho fake-esphome\n', { mode: 0o755 });
  return binPath;
}

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
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT,
      last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS esphome_generated_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER,
      config_mode TEXT,
      board_profile_id TEXT,
      yaml_text TEXT,
      yaml_hash TEXT,
      validation_json TEXT,
      integration_key TEXT,
      ownership_mode TEXT,
      config_source TEXT,
      read_only INTEGER,
      generated_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS esphome_install_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER,
      config_id INTEGER,
      job_type TEXT,
      target_port TEXT,
      target_ip TEXT,
      status TEXT,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      output_log TEXT,
      error_text TEXT
    );
    CREATE TABLE IF NOT EXISTS blocked_io (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, group_name TEXT, key TEXT);
    CREATE TABLE IF NOT EXISTS pending_io (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, key TEXT, group_name TEXT, first_seen INTEGER, last_seen INTEGER, last_value TEXT, site_id INTEGER, UNIQUE(device_id, group_name, key));
    CREATE TABLE IF NOT EXISTS device_site (device_id TEXT PRIMARY KEY, site_id INTEGER, assigned_ts INTEGER);
  `);
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
  return db;
}

async function loadFlashRoutes({ spawnAutoCloseCode, spawnSyncImpl } = {}) {
  vi.resetModules();
  const spawnCalls = [];
  const fakeProc = new EventEmitter();
  fakeProc.stdout = new EventEmitter();
  fakeProc.stderr = new EventEmitter();

  vi.doMock('child_process', () => ({
    spawn: vi.fn((bin, args, opts) => {
      spawnCalls.push({ bin, args, opts });
      if (spawnAutoCloseCode !== undefined) setTimeout(() => fakeProc.emit('close', spawnAutoCloseCode), 5);
      return fakeProc;
    }),
    spawnSync: vi.fn((bin, args, opts) => {
      if (typeof spawnSyncImpl === 'function') return spawnSyncImpl(bin, args, opts);
      return { status: 0, stdout: 'ok\n', stderr: '' };
    }),
  }));

  const mod = await import('../../src/api/esphome/flash_routes.js');
  return { mountFlashRoutes: mod.mountFlashRoutes, spawnCalls, fakeProc };
}

describe('ESPHome flash routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('child_process');
    vi.resetModules();
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it('reports missing python venv prerequisite via /setup-prereqs', async () => {
    const dataDir = makeTempDir();
    const { mountFlashRoutes } = await loadFlashRoutes({
      spawnSyncImpl(bin, args) {
        const joined = [bin].concat(args || []).join(' ');
        if (/python3 .*ensurepip/.test(joined)) return { status: 1, stdout: '', stderr: 'ensurepip missing' };
        if (/python3 --version/.test(joined)) return { status: 0, stdout: 'Python 3.12.3\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    const app = createApp();
    mountFlashRoutes({
      app,
      db: makeDb(),
      wsApi: null,
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state: { activeSetup: null, activeFlash: null },
    });

    const handler = findRoute(app, 'GET', '/api/esphome/setup-prereqs');
    const res = createRes();
    handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ensurepip_available).toBe(false);
    expect(res.body.missing_package_hint).toBe('python3.12-venv');
    expect(res.body.install_command).toContain('python3.12-venv');
  });

  it('rejects /flash when another flash is already in progress', async () => {
    const dataDir = makeTempDir();
    const { mountFlashRoutes } = await loadFlashRoutes();
    const app = createApp();
    mountFlashRoutes({
      app,
      db: makeDb(),
      wsApi: null,
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state: { activeFlash: {} },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/flash');
    const res = createRes();
    handler({ body: {} }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'flash_in_progress' });
  });

  it('rejects /flash when esphome is not installed', async () => {
    const dataDir = makeTempDir();
    const { mountFlashRoutes } = await loadFlashRoutes();
    const app = createApp();
    mountFlashRoutes({
      app,
      db: makeDb(),
      wsApi: null,
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state: { activeFlash: null },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/flash');
    const res = createRes();
    handler({ body: {} }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'esphome_not_installed' });
  });

  it('rejects /flash when resolved validation fails', async () => {
    const dataDir = makeTempDir();
    writeFakeEspHomeBin(dataDir);
    const { mountFlashRoutes } = await loadFlashRoutes();
    const app = createApp();
    const db = makeDb();
    mountFlashRoutes({
      app,
      db,
      wsApi: null,
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state: { activeFlash: null },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/flash');
    const res = createRes();
    handler({ body: { device_name: 'test_node', board_profile_id: 'generic_esp32dev' } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('queues and starts /flash with persisted job + generated yaml on success path', async () => {
    const dataDir = makeTempDir();
    writeFakeEspHomeBin(dataDir);
    const { mountFlashRoutes } = await loadFlashRoutes({ spawnAutoCloseCode: 0 });
    const app = createApp();
    const db = makeDb();
    const state = { activeFlash: null };
    mountFlashRoutes({
      app,
      db,
      wsApi: { sendToClient: vi.fn() },
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state,
    });

    const handler = findRoute(app, 'POST', '/api/esphome/flash');
    const res = createRes();
    handler({ body: { device_name: 'test_node', board_profile_id: 'generic_esp32dev', port: '/dev/ttyUSB0', wifi_ssid: 'ssid', mqtt_host: '192.168.1.2', client_id: 'c1', entities: [{ key: 'temp_1', name: 'Temp 1', type: 'ds18b20', source: 'HT1' }] } }, res);

    expect(res.body).toEqual(expect.objectContaining({ ok: true, job_id: expect.any(Number), device_id: expect.any(Number) }));
    expect(fs.existsSync(path.join(dataDir, 'test_node.yaml'))).toBe(true);

    const job = db.prepare('SELECT * FROM esphome_install_jobs ORDER BY id DESC LIMIT 1').get();
    expect(job).toEqual(expect.objectContaining({
      job_type: 'flash',
      target_port: '/dev/ttyUSB0',
    }));
    expect(job.status === 'queued' || job.status === 'running' || job.status === 'success').toBe(true);
  });

  it('validates required fields for /flash-from-yaml once binary exists', async () => {
    const dataDir = makeTempDir();
    writeFakeEspHomeBin(dataDir);
    const { mountFlashRoutes } = await loadFlashRoutes();
    const app = createApp();
    mountFlashRoutes({
      app,
      db: makeDb(),
      wsApi: null,
      dataDir,
      cfgDir: dataDir,
      venvDir: path.join(dataDir, 'venv'),
      requireEngineerAccess: (_req, _res, next) => next && next(),
      state: { activeFlash: null },
    });

    const handler = findRoute(app, 'POST', '/api/esphome/flash-from-yaml');

    const r1 = createRes();
    handler({ body: {} }, r1);
    expect(r1.statusCode).toBe(400);
    expect(r1.body.error).toBe('yaml_text_required');

    const r2 = createRes();
    handler({ body: { yaml_text: 'esphome:\n  name: x\n' } }, r2);
    expect(r2.statusCode).toBe(400);
    expect(r2.body.error).toBe('device_name_required');
  });
});
