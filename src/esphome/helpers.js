'use strict';
// src/esphome/helpers.js — shared utility functions for ESPHome routes

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { listCatalogSummaries, getCatalogProfile } = require('./profile_registry');
const { normalizePayload, safeName, sha256, parseGpio, toGpioLabel, normalizeIntegrationKey, normalizeOwnershipMode, normalizeConfigSource, normalizeReadOnly } = require('./schema');
const { validateConfig } = require('./validator');
const { generateYAML } = require('./generator');
const { resolvePeripheralSelection, findBoardPort } = require('./board_port_registry');

// ── GPIO constants ────────────────────────────────────────────────────────────
const COMMON_ESP32_GPIO_PINS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39];
const COMMON_ESP32_ADC_PINS = new Set([32, 33, 34, 35, 36, 39]);
const COMMON_ESP8266_GPIO_PINS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16];

// ── Pure utils ────────────────────────────────────────────────────────────────
function uniqNums(items) {
  return [...new Set((items || []).map(n => Number(n)).filter(Number.isFinite))].sort((a, b) => a - b);
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePinInput(value) {
  const gpio = parseGpio(value);
  return gpio === null ? null : toGpioLabel(gpio);
}

function hasYamlId(yamlText, key) {
  const re = new RegExp(`\\bid:\\s*${escapeRegex(String(key || '').trim())}\\b`);
  return re.test(String(yamlText || ''));
}

function redactSavedConfig(cfg) {
  const out = { ...(cfg || {}) };
  if (Object.prototype.hasOwnProperty.call(out, 'wifi_pass')) {
    out.wifi_pass_set = !!out.wifi_pass;
    out.wifi_pass = '';
  }
  return out;
}

function ensureDeviceAccess(req, device, res, access) {
  if (!device) {
    if (res) res.status(404).json({ ok: false, error: 'device_not_found' });
    return false;
  }
  if (!access || access.canAccessSite(req, device.site_id)) return true;
  if (res) res.status(403).json({ ok: false, error: 'forbidden' });
  return false;
}

function configSiteId(cfg, db, getDevicesByNameStmt) {
  const siteId = Number(cfg?.site_id);
  if (Number.isFinite(siteId) && siteId > 0) return siteId;
  const deviceName = safeName(cfg?.device_name || '');
  if (!deviceName || !getDevicesByNameStmt) return null;
  const rows = getDevicesByNameStmt.all(deviceName) || [];
  const row = rows.find(r => r && r.site_id != null);
  return row ? row.site_id : null;
}

// ── Pin rules ─────────────────────────────────────────────────────────────────
function getProfilePinRules(profile) {
  const rules = profile?.pinRules || {};
  return {
    reserved: uniqNums([...(rules.reserved || []), ...(rules.ethernetReservedPins || [])]),
    inputOnly: uniqNums(rules.inputOnly || []),
    noPullup: uniqNums(rules.noPullup || []),
    flashPins: uniqNums(rules.flashPins || []),
    strapping: uniqNums([...(rules.strapping || []), ...(rules.strappingPins || [])]),
  };
}

function getCandidatePins(profile) {
  const platform = String(profile?.platform || '').toLowerCase();
  if (platform === 'esp32') return [...COMMON_ESP32_GPIO_PINS];
  if (platform === 'esp8266') return [...COMMON_ESP8266_GPIO_PINS];
  const hinted = new Set();
  for (const e of Array.isArray(profile?.entityDefaults) ? profile.entityDefaults : []) {
    const gpio = parseGpio(String(e.pin || e.source || '').trim().toUpperCase());
    if (gpio !== null) hinted.add(gpio);
  }
  const rules = getProfilePinRules(profile);
  for (const n of [...rules.reserved, ...rules.inputOnly, ...rules.noPullup, ...rules.flashPins, ...rules.strapping]) hinted.add(Number(n));
  if (hinted.size) return [...hinted].filter(Number.isFinite).sort((a, b) => a - b);
  return Array.from({ length: 17 }, (_, i) => i);
}

function getPinCapabilities(profile, gpio) {
  const rules = getProfilePinRules(profile);
  if (rules.flashPins.includes(gpio) || rules.reserved.includes(gpio)) return [];
  const inputOnly = rules.inputOnly.includes(gpio);
  const caps = new Set();
  if (!inputOnly) {
    caps.add('ds18b20');
    caps.add('dht');
    caps.add('dht11');
  }
  caps.add('pulse_counter');
  if (String(profile?.platform || '').toLowerCase() === 'esp32' && COMMON_ESP32_ADC_PINS.has(gpio)) caps.add('analog');
  return [...caps];
}

function collectYamlPinUsage(yamlText) {
  const usage = new Map();
  const lines = String(yamlText || '').split(/\r?\n/);
  let topSection = null;
  let currentPlatform = null;
  let pinBlockIndent = null;
  let pinBlockMode = 'gpio';

  function mark(pinText) {
    const pin = normalizePinInput(pinText);
    if (!pin) return;
    if (!usage.has(pin)) usage.set(pin, { pin, kinds: new Set() });
    usage.get(pin).kinds.add(`${topSection || 'root'}:${currentPlatform || 'raw'}`);
  }

  function resetPinBlock() {
    pinBlockIndent = null;
    pinBlockMode = 'gpio';
  }

  for (const line of lines) {
    const indent = (line.match(/^\s*/) || [''])[0].length;
    if (pinBlockIndent !== null && /\S/.test(line) && indent <= pinBlockIndent) resetPinBlock();

    const topMatch = line.match(/^([a-z_][a-z0-9_]*):\s*$/i);
    if (topMatch && !line.startsWith(' ')) {
      topSection = topMatch[1];
      currentPlatform = null;
      resetPinBlock();
      continue;
    }

    const platformMatch = line.match(/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i);
    if (platformMatch) {
      currentPlatform = platformMatch[1].toLowerCase();
      resetPinBlock();
      continue;
    }

    const scalarPinMatch = line.match(/^\s*pin:\s*(?:['"])?(GPIO\s*\d+|\d+)(?:['"])?\s*$/i);
    if (scalarPinMatch) {
      mark(scalarPinMatch[1]);
      continue;
    }

    if (/^\s*pin:\s*$/i.test(line)) {
      pinBlockIndent = indent;
      pinBlockMode = 'gpio';
      continue;
    }

    if (pinBlockIndent !== null && indent > pinBlockIndent) {
      if (/^\s*(pcf8574|mcp23017|mcp23s17|mcp23x17|sx1509|pca9554|pca9535)\s*:/i.test(line)) {
        pinBlockMode = 'expander';
        continue;
      }
      const numberMatch = line.match(/^\s*number:\s*(?:['"])?(GPIO\s*\d+|\d+)(?:['"])?\s*$/i);
      if (numberMatch && pinBlockMode !== 'expander') {
        mark(numberMatch[1]);
        continue;
      }
    }
  }
  return usage;
}

function collectYamlI2cBuses(yamlText) {
  const buses = [];
  const lines = String(yamlText || '').split(/\r?\n/);
  let inI2c = false;
  let current = null;
  let listMode = false;

  function flush() {
    if (!current) return;
    buses.push({
      id: current.id || null,
      sda: current.sda ? normalizePinInput(current.sda) : null,
      scl: current.scl ? normalizePinInput(current.scl) : null,
    });
    current = null;
  }

  for (const line of lines) {
    if (!inI2c) {
      if (/^i2c:\s*$/i.test(line)) {
        inI2c = true;
        current = { id: null, sda: null, scl: null };
      }
      continue;
    }
    if (/^[^\s#][^:]*:\s*$/.test(line) && !line.startsWith(' ')) { flush(); break; }
    const busStart = line.match(/^\s*-\s*(.*)$/);
    if (busStart) {
      if (listMode || current?.id || current?.sda || current?.scl) flush();
      listMode = true;
      current = { id: null, sda: null, scl: null };
      const rest = String(busStart[1] || '').trim();
      if (!rest) continue;
      const idMatch = rest.match(/^id:\s*(.+)$/i);
      const sdaMatch = rest.match(/^sda:\s*(.+)$/i);
      const sclMatch = rest.match(/^scl:\s*(.+)$/i);
      if (idMatch) current.id = idMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (sdaMatch) current.sda = sdaMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (sclMatch) current.scl = sclMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (!current) current = { id: null, sda: null, scl: null };
    const idMatch = line.match(/^\s*id:\s*(.+)$/i);
    if (idMatch) current.id = idMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const sdaMatch = line.match(/^\s*sda:\s*(.+)$/i);
    if (sdaMatch) current.sda = sdaMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const sclMatch = line.match(/^\s*scl:\s*(.+)$/i);
    if (sclMatch) current.scl = sclMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  flush();
  return buses.filter(b => b.id || b.sda || b.scl);
}

function i2cUsageBusKey(bus = {}) {
  const id = String(bus.id || '').trim().toLowerCase();
  if (id) return id;
  const sda = normalizePinInput(bus.sda || '');
  const scl = normalizePinInput(bus.scl || '');
  if (sda && scl) return `${sda}/${scl}`.toLowerCase();
  return 'default';
}

function collectYamlI2cUsage(yamlText) {
  const usage = new Map();
  const lines = String(yamlText || '').split(/\r?\n/);
  const buses = collectYamlI2cBuses(yamlText);
  const defaultBusKey = i2cUsageBusKey(buses[0] || { id: 'default' });
  let inSensor = false;
  let currentPlatform = null;
  let currentAddress = null;
  let currentBusId = null;

  function flush() {
    if (!inSensor || !currentPlatform || !currentAddress) {
      currentPlatform = null;
      currentAddress = null;
      currentBusId = null;
      return;
    }
    const key = String(currentAddress).toLowerCase();
    if (!usage.has(key)) usage.set(key, []);
    usage.get(key).push({
      platform: currentPlatform,
      bus_id: String(currentBusId || defaultBusKey).toLowerCase(),
    });
    currentPlatform = null;
    currentAddress = null;
    currentBusId = null;
  }

  for (const line of lines) {
    if (!inSensor) {
      if (/^sensor:\s*$/i.test(line)) inSensor = true;
      continue;
    }
    if (/^[^\s#][^:]*:\s*$/.test(line) && !line.startsWith(' ')) { flush(); break; }
    const platformMatch = line.match(/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i);
    if (platformMatch) { flush(); currentPlatform = platformMatch[1].toLowerCase(); continue; }
    const addrMatch = line.match(/^\s*address:\s*(0x[0-9a-f]+|\d+)\s*$/i);
    if (addrMatch) currentAddress = addrMatch[1];
    const busMatch = line.match(/^\s*i2c_id:\s*(.+)\s*$/i);
    if (busMatch) currentBusId = String(busMatch[1] || '').trim().replace(/^['"]|['"]$/g, '');
  }
  flush();
  return usage;
}

function getDefaultI2cBus(profile) {
  const raw = profile?.i2c;
  if (Array.isArray(raw) && raw.length) {
    const first = raw.find(x => x && x.sda != null && x.scl != null) || raw[0];
    return first ? { sda: toGpioLabel(first.sda), scl: toGpioLabel(first.scl) } : null;
  }
  if (raw && raw.sda != null && raw.scl != null) return { sda: toGpioLabel(raw.sda), scl: toGpioLabel(raw.scl) };
  return null;
}

function describeProfilePin(profile, pinText) {
  const pin = normalizePinInput(pinText);
  if (!pin || !profile) return pin || String(pinText || '').trim().toUpperCase();
  const port = findBoardPort(profile, pin);
  if (!port) return pin;
  const label = String(port.label || port.id || '').trim();
  return label && label.toUpperCase() !== pin ? `${label} (${pin})` : pin;
}

function isDs18b20SharedBusUsage(kinds) {
  // Allow sharing if the pin already has ANY 1-Wire or dallas_temp usage.
  // Older YAMLs or different generators may produce 'one_wire:raw' instead of
  // 'one_wire:gpio' — we match any one_wire: prefix to stay compatible.
  for (const kind of kinds || []) {
    if (kind.startsWith('one_wire:') || kind === 'sensor:dallas_temp') return true;
  }
  return false;
}

function validatePeripheralEntity({ profile, yamlText, entity }) {
  const errors = [];
  const warnings = [];
  const type = String(entity?.type || '').trim().toLowerCase();
  const rules = getProfilePinRules(profile);

  const allowReservedPin = !!entity?.allow_reserved_profile_port;
  const allowReservedBus = !!entity?.allow_reserved_profile_bus;

  if (type === 'bh1750' || type === 'sht3x') {
    const sdaText = String(entity?.sda || '').trim().toUpperCase();
    const sclText = String(entity?.scl || '').trim().toUpperCase();
    const addressText = String(entity?.address || '').trim().toLowerCase();
    const sda = parseGpio(sdaText);
    const scl = parseGpio(sclText);
    if (sda === null || scl === null) return { ok: false, errors: ['invalid_i2c_bus — use GPIO<number> for SDA and SCL'], warnings, sda: null, scl: null, address: null };
    if (!/^0x[0-9a-f]+$/.test(addressText)) return { ok: false, errors: ['invalid_i2c_address — use hex like 0x23 or 0x44'], warnings, sda: null, scl: null, address: null };
    for (const gpio of [sda, scl]) {
      const label = toGpioLabel(gpio);
      if (rules.flashPins.includes(gpio)) errors.push(`${label} is a flash pin and cannot be used for I2C.`);
      if (rules.reserved.includes(gpio) && !allowReservedBus) errors.push(`${describeProfilePin(profile, label)} is reserved by the board/profile.`);
      if (rules.strapping.includes(gpio)) warnings.push(`${label} is a strapping pin; use with care.`);
    }
    const defaultBus = getDefaultI2cBus(profile);
    const sdaLabel = toGpioLabel(sda);
    const sclLabel = toGpioLabel(scl);
    if (defaultBus && (defaultBus.sda !== sdaLabel || defaultBus.scl !== sclLabel)) warnings.push(`Board default I2C bus is ${defaultBus.sda}/${defaultBus.scl}. You selected ${sdaLabel}/${sclLabel}.`);
    const addrUsage = collectYamlI2cUsage(yamlText).get(addressText) || [];
    const currentBusKey = String(entity?.bus_id || `${sdaLabel}/${sclLabel}`).trim().toLowerCase();
    const sameBusConflict = addrUsage.some((entry) => String(entry?.bus_id || '').trim().toLowerCase() === currentBusKey);
    if (sameBusConflict) errors.push(`i2c_address_conflict — ${addressText} is already used on ${entity?.bus_id || `${sdaLabel}/${sclLabel}`} in this device YAML.`);
    else if (addrUsage.length) warnings.push(`${addressText} is already used on another I²C bus in this device YAML.`);
    return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], sda: sdaLabel, scl: sclLabel, address: addressText, pin: null, pinMode: null };
  }

  const pinText = String(entity?.pin || '').trim().toUpperCase();
  const gpio = parseGpio(pinText);
  if (gpio === null) return { ok: false, errors: ['invalid_pin_format — use GPIO<number>'], warnings, pin: null, pinMode: null };
  const caps = getPinCapabilities(profile, gpio);
  const label = toGpioLabel(gpio);
  if (rules.flashPins.includes(gpio)) errors.push(`${label} is a flash pin and cannot be used.`);
  if (rules.reserved.includes(gpio) && !allowReservedPin) errors.push(`${describeProfilePin(profile, label)} is reserved by the board/profile.`);
  if (!caps.includes(type)) {
    if (type === 'analog') errors.push(`${label} does not support ADC on this board/profile.`);
    else if ((type === 'dht' || type === 'dht11' || type === 'ds18b20') && rules.inputOnly.includes(gpio)) errors.push(`${label} is input-only and cannot be used for ${type.toUpperCase()} sensors.`);
    else errors.push(`${label} is not compatible with ${type}.`);
  }
  if (rules.strapping.includes(gpio)) warnings.push(`${label} is a strapping pin; use with care.`);
  if (type === 'pulse_counter' && rules.noPullup.includes(gpio)) warnings.push(`${label} has no internal pull-up; YAML will use INPUT mode, so wire an external pull-up if your sensor needs one.`);
  const usage = collectYamlPinUsage(yamlText).get(pinText);
  if (usage) {
    const sharedDs = type === 'ds18b20' && isDs18b20SharedBusUsage(usage.kinds);
    if (!sharedDs) errors.push(`pin_conflict — ${describeProfilePin(profile, pinText)} is already used in this device YAML.`);
    else warnings.push(`Shared 1-Wire bus detected on ${describeProfilePin(profile, pinText)}; adding another DS18B20 on the same pin is allowed.`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    pin: pinText,
    pinMode: type === 'pulse_counter' && rules.noPullup.includes(gpio) ? 'INPUT' : (type === 'pulse_counter' ? 'INPUT_PULLUP' : null),
  };
}
// ── System utils ──────────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchUrl(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', () => reject(new Error('Request timed out')));
  });
}

function listPorts() {
  try {
    return fs.readdirSync('/dev', { withFileTypes: true })
      .map(d => d.name)
      .filter(name => /^tty(USB|ACM)\d+$/.test(name))
      .map(name => path.join('/dev', name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch { return []; }
}

function getEspHomeBin(dataDir) {
  const venvBin = path.join(dataDir, 'esphome_venv', 'bin', 'esphome');
  if (fs.existsSync(venvBin)) return venvBin;
  try { execSync('esphome version 2>&1', { encoding: 'utf8' }); return 'esphome'; } catch {}
  return null;
}

function checkEsphome(dataDir) {
  const bin = getEspHomeBin(dataDir);
  if (!bin) return { ok: false };
  try { const v = execSync(`"${bin}" version 2>&1`, { encoding: 'utf8' }).trim(); return { ok: true, version: v, bin }; }
  catch { return { ok: false }; }
}

function sendWs(wsApi, clientId, type, level, text) {
  const msg = { type, level, text, ts: Date.now() };
  if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, msg);
  if (type === 'esphome_log' && wsApi.broadcastLog) wsApi.broadcastLog({ level, text: `[FLASH] ${text}`, ts: Date.now() });
}

// ── DB utils ──────────────────────────────────────────────────────────────────
function ensureEsphomeTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS esphome_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      friendly_name TEXT,
      board_profile_id TEXT NOT NULL,
      chip TEXT,
      framework TEXT,
      transport TEXT,
      network_mode TEXT,
      status TEXT DEFAULT 'new',
      serial_port TEXT,
      mac_address TEXT,
      ip_address TEXT,
      hostname TEXT,
      mqtt_topic_root TEXT,
      firmware_version TEXT,
      yaml_path TEXT,
      yaml_hash TEXT,
      last_validation_json TEXT,
      integration_key TEXT NOT NULL DEFAULT 'esphome',
      ownership_mode TEXT NOT NULL DEFAULT 'managed_internal',
      config_source TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_site_id ON esphome_devices(site_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_board_profile_id ON esphome_devices(board_profile_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_name ON esphome_devices(name);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mqtt_root ON esphome_devices(mqtt_topic_root);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mac ON esphome_devices(mac_address);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_status ON esphome_devices(status);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_deleted_at ON esphome_devices(deleted_at);
    CREATE TABLE IF NOT EXISTS esphome_generated_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      config_mode TEXT NOT NULL,
      board_profile_id TEXT NOT NULL,
      yaml_text TEXT NOT NULL,
      yaml_hash TEXT,
      validation_json TEXT,
      integration_key TEXT NOT NULL DEFAULT 'esphome',
      ownership_mode TEXT NOT NULL DEFAULT 'managed_internal',
      config_source TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      generated_by TEXT DEFAULT 'system',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_esphome_generated_configs_device_id ON esphome_generated_configs(esphome_device_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_generated_configs_mode ON esphome_generated_configs(config_mode);
    CREATE TABLE IF NOT EXISTS esphome_install_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      config_id INTEGER,
      job_type TEXT NOT NULL,
      target_port TEXT,
      target_ip TEXT,
      status TEXT DEFAULT 'queued',
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      output_log TEXT,
      error_text TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE,
      FOREIGN KEY (config_id) REFERENCES esphome_generated_configs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_esphome_install_jobs_device_id ON esphome_install_jobs(esphome_device_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_install_jobs_status ON esphome_install_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_esphome_install_jobs_type ON esphome_install_jobs(job_type);
    CREATE TABLE IF NOT EXISTS esphome_device_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      override_key TEXT NOT NULL,
      override_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(esphome_device_id, override_key),
      FOREIGN KEY (esphome_device_id) REFERENCES esphome_devices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_esphome_device_overrides_device_id ON esphome_device_overrides(esphome_device_id);
  `);
  try {
    const cols = db.prepare(`PRAGMA table_info(esphome_devices)`).all().map(r => r.name);
    if (!cols.includes('deleted_at')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_at TEXT;`);
    if (!cols.includes('deleted_reason')) db.exec(`ALTER TABLE esphome_devices ADD COLUMN deleted_reason TEXT;`);
  } catch (_) {}
}

function resolveConfig(db, body) {
  const payload = normalizePayload(body);
  const profile = getCatalogProfile(db, payload.board_profile_id);
  if (profile && Array.isArray(payload.entities)) {
    payload.entities = payload.entities.map((entity) => {
      const resolved = resolvePeripheralSelection(profile, entity || {});
      if (!resolved || !resolved.ok) return entity;
      const next = { ...(entity || {}), ...(resolved.resolved || {}) };
      if (resolved.selectedPort) {
        next.source = resolved.selectedPort.id || next.source || next.port_id || next.pin || '';
        next.port_id = resolved.selectedPort.id || next.port_id || null;
        if (resolved.selectedPort.pin) next.pin = resolved.selectedPort.pin;
      }
      if (resolved.selectedBus) {
        next.source = resolved.selectedBus.id || next.source || next.bus_id || '';
        next.bus_id = resolved.selectedBus.id || next.bus_id || null;
        if (resolved.selectedBus.sda && !next.sda) next.sda = resolved.selectedBus.sda;
        if (resolved.selectedBus.scl && !next.scl) next.scl = resolved.selectedBus.scl;
      }
      if (profile.resolveSource) {
        const viaSource = profile.resolveSource(next.port_id || next.source || next.pin || next.bus_id || '');
        if (viaSource && viaSource.pin && !next.pin) next.pin = viaSource.pin;
        if (viaSource && viaSource.bus_id && !next.bus_id) next.bus_id = viaSource.bus_id;
        if (viaSource && viaSource.sda && !next.sda) next.sda = viaSource.sda;
        if (viaSource && viaSource.scl && !next.scl) next.scl = viaSource.scl;
      }
      return next;
    });
  }
  const validation = validateConfig({ profile, payload });
  const yaml = validation.ok && profile ? generateYAML({ profile, payload }) : '';
  return { payload, profile, validation, yaml };
}

function defaultSiteId(db) {
  try { const row = db.prepare('SELECT id FROM sites ORDER BY id ASC LIMIT 1').get(); return row?.id || 1; }
  catch { return 1; }
}

function _normIdentity(value) {
  return String(value || '').trim().toLowerCase();
}


function _deviceStaleThresholdMs(row) {
  const status = String((row && row.status) || '').trim().toLowerCase();
  return status === 'online' ? (24 * 60 * 60 * 1000) : (10 * 60 * 1000);
}

function _deviceScore(row) {
  if (!row) return -1;
  let s = 0;
  const status = String(row.status || '').trim().toLowerCase();
  if (row.deleted_at) s -= 200;
  const lastSeenTs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  const updatedTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const stale = lastSeenTs ? ((Date.now() - lastSeenTs) > _deviceStaleThresholdMs(row)) : false;
  if (status === 'online') s += stale ? 8 : 72;
  else if (status === 'flashed') s += 52;
  else if (status === 'generated' || status === 'queued' || status === 'running') s += 40;
  else if (status === 'error') s -= 6;
  if (row.ip_address) s += 12;
  if (row.serial_port) s += 10;
  if (row.mac_address) s += 14;
  if (row.hostname) s += 8;
  if (row.mqtt_topic_root) s += 8;
  if (row.last_seen_at) s += stale ? 1 : 12;
  if (Number.isFinite(updatedTs) && updatedTs > 0) {
    const ageMin = (Date.now() - updatedTs) / 60000;
    if (ageMin <= 2) s += 10;
    else if (ageMin <= 15) s += 6;
    else if (ageMin <= 120) s += 3;
  }
  return s;
}

function _repointEsphomeChildren(db, canonicalId, dupIds) {
  if (!db || !canonicalId || !dupIds || !dupIds.length) return;
  const placeholders = dupIds.map(() => '?').join(',');
  db.prepare(`UPDATE esphome_generated_configs SET esphome_device_id=? WHERE esphome_device_id IN (${placeholders})`).run(canonicalId, ...dupIds);
  db.prepare(`UPDATE esphome_install_jobs SET esphome_device_id=? WHERE esphome_device_id IN (${placeholders})`).run(canonicalId, ...dupIds);
  const overrideRows = db.prepare(`SELECT override_key, override_value, created_at, updated_at FROM esphome_device_overrides WHERE esphome_device_id IN (${placeholders})`).all(...dupIds);
  for (const row of overrideRows) {
    db.prepare(`INSERT INTO esphome_device_overrides (esphome_device_id, override_key, override_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(esphome_device_id, override_key) DO UPDATE SET override_value=excluded.override_value, updated_at=excluded.updated_at`).run(
      canonicalId,
      row.override_key,
      row.override_value,
      row.created_at || new Date().toISOString(),
      row.updated_at || new Date().toISOString(),
    );
  }
}

function cleanupStaleEsphomeDuplicates(db) {
  if (!db) return 0;
  ensureEsphomeTables(db);
  const rows = db.prepare("SELECT * FROM esphome_devices WHERE deleted_at IS NULL ORDER BY site_id ASC, updated_at DESC, id DESC").all();
  if (!rows.length) return 0;
  const groups = new Map();
  for (const row of rows) {
    const keys = [];
    const ip = _normIdentity(row.ip_address);
    const serial = _normIdentity(row.serial_port);
    const mac = _normIdentity(row.mac_address);
    const host = _normIdentity(row.hostname);
    const board = _normIdentity(row.board_profile_id);
    if (serial) keys.push(`serial:${serial}`);
    if (mac) keys.push(`mac:${mac}`);
    if (ip && board) keys.push(`ipboard:${board}:${ip}`);
    if (host && board) keys.push(`hostboard:${board}:${host}`);
    if (!keys.length) continue;
    let group = null;
    for (const k of keys) {
      if (groups.has(k)) { group = groups.get(k); break; }
    }
    if (!group) {
      group = { rows: [], keys: new Set() };
    }
    group.rows.push(row);
    keys.forEach(k => { group.keys.add(k); groups.set(k, group); });
  }
  const seen = new Set();
  let removed = 0;
  for (const group of new Set(groups.values())) {
    const uniq = group.rows.filter(r => !seen.has(r.id));
    uniq.forEach(r => seen.add(r.id));
    if (uniq.length < 2) continue;
    uniq.sort((a, b) => _deviceScore(b) - _deviceScore(a) || Number(b.id || 0) - Number(a.id || 0));
    const canonical = uniq[0];
    const dupIds = uniq.slice(1).map(r => r.id);
    const tx = db.transaction(() => {
      _repointEsphomeChildren(db, canonical.id, dupIds);
      db.prepare(`DELETE FROM esphome_devices WHERE id IN (${dupIds.map(() => '?').join(',')})`).run(...dupIds);
    });
    tx();
    removed += dupIds.length;
  }
  return removed;
}


function _mergeDuplicateEsphomeDevices(db, canonicalId, opts = {}) {
  if (!db || !canonicalId) return [];
  const canonical = db.prepare('SELECT * FROM esphome_devices WHERE id=? LIMIT 1').get(canonicalId);
  if (!canonical) return [];
  const boardProfileId = String(opts.board_profile_id || canonical.board_profile_id || '').trim().toLowerCase();
  const strong = new Set();
  const weak = new Set();
  const addStrong = (v) => { const n = _normIdentity(v); if (n) strong.add(n); };
  const addWeak = (v) => { const n = _normIdentity(v); if (n) weak.add(n); };

  [canonical.ip_address, canonical.serial_port, canonical.mac_address, canonical.hostname, canonical.mqtt_topic_root,
   opts.ip_address, opts.serial_port, opts.mac_address, opts.hostname, opts.mqtt_topic_root].forEach(addStrong);
  [canonical.name, canonical.friendly_name, opts.name, opts.friendly_name].forEach(addWeak);

  const rows = db.prepare("SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND site_id=? AND id<>? ORDER BY updated_at DESC, id DESC").all(canonical.site_id, canonicalId);
  const dupIds = [];
  for (const row of rows) {
    const rowBoard = String(row.board_profile_id || '').trim().toLowerCase();
    const rowStrong = [row.ip_address, row.serial_port, row.mac_address, row.hostname, row.mqtt_topic_root].map(_normIdentity).filter(Boolean);
    const rowWeak = [row.name, row.friendly_name].map(_normIdentity).filter(Boolean);
    const strongMatch = rowStrong.some(v => strong.has(v));
    const weakMatch = rowBoard && boardProfileId && rowBoard === boardProfileId && rowWeak.some(v => weak.has(v)) && (!strong.size || !rowStrong.length);
    if (strongMatch || weakMatch) dupIds.push(row.id);
  }
  if (!dupIds.length) return [];

  const placeholders = dupIds.map(() => '?').join(',');
  const tx = db.transaction(() => {
    _repointEsphomeChildren(db, canonicalId, dupIds);
    db.prepare(`DELETE FROM esphome_devices WHERE id IN (${placeholders})`).run(...dupIds);
  });
  tx();
  return dupIds;
}

function persistInstallState(db, { payload, profile, validation, yaml, yamlPath, port, jobStatus }) {
  if (!db) return null;
  ensureEsphomeTables(db);
  const siteId = payload.site_id || defaultSiteId(db);
  const canonicalName = safeName(payload.device_name || 'device');
  const yamlHash = yaml ? sha256(yaml) : null;
  const now = new Date().toISOString();
  const validationJson = JSON.stringify(validation);
  const mqttRoot = `elaris/${canonicalName}`;
  const integrationKey = normalizeIntegrationKey(payload.integration_key);
  const ownershipMode = normalizeOwnershipMode(payload.ownership_mode);
  const configSource = normalizeConfigSource(payload.config_source);
  const readOnly = normalizeReadOnly(payload.read_only, ownershipMode);
  const byExplicitId = payload.existing_device_id
    ? db.prepare('SELECT * FROM esphome_devices WHERE id=? LIMIT 1').get(payload.existing_device_id)
    : null;
  const byName = db.prepare('SELECT * FROM esphome_devices WHERE site_id=? AND lower(name)=lower(?) ORDER BY id DESC LIMIT 1').get(siteId, canonicalName);
  const byIp = (port && !/^\/dev\//.test(port))
    ? db.prepare('SELECT * FROM esphome_devices WHERE site_id=? AND ip_address=? ORDER BY id DESC LIMIT 1').get(siteId, port)
    : null;
  const bySerial = (port && /^\/dev\//.test(port))
    ? db.prepare('SELECT * FROM esphome_devices WHERE site_id=? AND serial_port=? ORDER BY id DESC LIMIT 1').get(siteId, port)
    : null;
  const existing = byExplicitId || byName || byIp || bySerial || null;
  let deviceId = existing?.id || null;
  if (deviceId) {
    const nameChanged = String(existing?.name || '').trim().toLowerCase() !== canonicalName.toLowerCase();
    const topicChanged = String(existing?.mqtt_topic_root || '').trim().toLowerCase() !== mqttRoot.toLowerCase();
    const resetLastSeen = !!(nameChanged || topicChanged);
    db.prepare(`UPDATE esphome_devices SET name=?, friendly_name=?, board_profile_id=?, chip=?, framework=?, transport=?, network_mode=?, status=?, serial_port=?, ip_address=COALESCE(?, ip_address), hostname=?, mqtt_topic_root=?, yaml_path=?, yaml_hash=?, last_validation_json=?, integration_key=?, ownership_mode=?, config_source=?, read_only=?, last_seen_at=?, updated_at=?, deleted_at=NULL, deleted_reason=NULL WHERE id=?`).run(
      canonicalName,
      payload.device_name || canonicalName, profile.id, profile.platform,
      payload.framework || profile.frameworkDefault || null,
      port && /^\/dev\//.test(port) ? 'usb' : 'ota',
      payload.use_ethernet ? 'ethernet' : 'wifi',
      jobStatus || 'generated',
      /^\/dev\//.test(port || '') ? port : null,
      port && !/^\/dev\//.test(port || '') ? port : null,
      canonicalName,
      mqttRoot, yamlPath || null, yamlHash, validationJson, integrationKey, ownershipMode, configSource, readOnly, resetLastSeen ? null : (existing?.last_seen_at || null), now, deviceId,
    );
  } else {
    const ins = db.prepare(`INSERT INTO esphome_devices (site_id, name, friendly_name, board_profile_id, chip, framework, transport, network_mode, status, serial_port, ip_address, hostname, mqtt_topic_root, yaml_path, yaml_hash, last_validation_json, integration_key, ownership_mode, config_source, read_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      siteId, canonicalName, payload.device_name || canonicalName, profile.id, profile.platform,
      payload.framework || profile.frameworkDefault || null,
      port && /^\/dev\//.test(port) ? 'usb' : 'ota',
      payload.use_ethernet ? 'ethernet' : 'wifi',
      jobStatus || 'generated',
      /^\/dev\//.test(port || '') ? port : null,
      port && !/^\/dev\//.test(port || '') ? port : null,
      canonicalName,
      mqttRoot, yamlPath || null, yamlHash, validationJson, integrationKey, ownershipMode, configSource, readOnly, now, now,
    );
    deviceId = ins.lastInsertRowid;
  }
  _mergeDuplicateEsphomeDevices(db, deviceId, {
    board_profile_id: profile.id,
    ip_address: port && !/^\/dev\//.test(port || '') ? port : null,
    serial_port: /^\/dev\//.test(port || '') ? port : null,
    hostname: canonicalName,
    mqtt_topic_root: mqttRoot,
    name: canonicalName,
    friendly_name: payload.device_name || canonicalName,
  });
  if (existing) {
    const oldName = String(existing.name || '').trim().toLowerCase();
    const oldTopic = String(existing.mqtt_topic_root || '').trim().toLowerCase();
    const oldHost = String(existing.hostname || '').trim().toLowerCase();
    const changedIdentity = oldName !== canonicalName.toLowerCase() || oldTopic !== mqttRoot.toLowerCase() || oldHost !== canonicalName.toLowerCase();
    if (changedIdentity) {
      _mergeDuplicateEsphomeDevices(db, deviceId, {
        board_profile_id: profile.id,
        ip_address: existing.ip_address || (port && !/^\/dev\//.test(port || '') ? port : null),
        serial_port: existing.serial_port || (/^\/dev\//.test(port || '') ? port : null),
        mac_address: existing.mac_address || null,
        hostname: existing.hostname || null,
        mqtt_topic_root: existing.mqtt_topic_root || null,
        name: existing.name || null,
        friendly_name: existing.friendly_name || null,
      });
    }
  }
  cleanupStaleEsphomeDuplicates(db);
  let configId = null;
  if (yaml) {
    const cfg = db.prepare(`INSERT INTO esphome_generated_configs (esphome_device_id, config_mode, board_profile_id, yaml_text, yaml_hash, validation_json, integration_key, ownership_mode, config_source, read_only, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(deviceId, 'full', profile.id, yaml, yamlHash, validationJson, integrationKey, ownershipMode, configSource, readOnly, 'system');
    configId = cfg.lastInsertRowid;
  }
  const job = db.prepare(`INSERT INTO esphome_install_jobs (esphome_device_id, config_id, job_type, target_port, target_ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    deviceId, configId, 'flash',
    /^\/dev\//.test(port || '') ? port : null,
    port && !/^\/dev\//.test(port) ? port : null,
    jobStatus || 'queued', now,
  );
  return { deviceId, configId, jobId: job.lastInsertRowid };
}

function updateJob(db, jobId, fields) {
  if (!db || !jobId) return;
  const row = db.prepare('SELECT * FROM esphome_install_jobs WHERE id=?').get(jobId);
  if (!row) return;
  db.prepare(`UPDATE esphome_install_jobs SET status=?, started_at=?, finished_at=?, exit_code=?, output_log=?, error_text=? WHERE id=?`).run(
    fields.status ?? row.status, fields.started_at ?? row.started_at,
    fields.finished_at ?? row.finished_at, fields.exit_code ?? row.exit_code,
    fields.output_log ?? row.output_log, fields.error_text ?? row.error_text, jobId,
  );
}

// ── GitHub / Device Browser utils ─────────────────────────────────────────────
function fetchGitHub(apiPath) {
  return new Promise((resolve, reject) => {
    const options = { hostname: 'api.github.com', path: apiPath, headers: { 'User-Agent': 'ELARIS-Smart-Home/1.0', 'Accept': 'application/vnd.github.v3+json' }, timeout: 12000 };
    https.get(options, res => {
      if (res.statusCode === 403) return reject(new Error('GitHub rate limit exceeded. Try again in 1 hour.'));
      if (res.statusCode !== 200) return reject(new Error(`GitHub API: HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    }).on('error', reject).on('timeout', () => reject(new Error('GitHub API timeout')));
  });
}

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ELARIS-Smart-Home/1.0' }, timeout: 12000 }, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

function extractYamlFromMarkdown(md) {
  const m = md.match(/```ya?ml\r?\n([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

async function fetchDeviceYaml(slug) {
  const base = `https://raw.githubusercontent.com/esphome/esphome-devices/main/src/docs/devices/${slug}`;
  try { return await fetchRaw(`${base}/${slug}.yaml`); } catch (_) {}
  try { const md = await fetchRaw(`${base}/${slug}.md`); const yaml = extractYamlFromMarkdown(md); if (yaml) return yaml; } catch (_) {}
  try {
    const files = await fetchGitHub(`/repos/esphome/esphome-devices/contents/src/docs/devices/${slug}`);
    if (!Array.isArray(files)) throw new Error('not a directory');
    const yamlFile = files.find(f => f.name.endsWith('.yaml'));
    if (yamlFile) return await fetchRaw(yamlFile.download_url);
    const mdFile = files.find(f => f.name.endsWith('.md'));
    if (mdFile) { const md = await fetchRaw(mdFile.download_url); const yaml = extractYamlFromMarkdown(md); if (yaml) return yaml; }
  } catch (_) {}
  throw new Error(`No YAML found for device: ${slug}`);
}

module.exports = {
  COMMON_ESP32_GPIO_PINS, COMMON_ESP32_ADC_PINS, COMMON_ESP8266_GPIO_PINS,
  uniqNums, escapeRegex, normalizePinInput, hasYamlId, redactSavedConfig,
  ensureDeviceAccess, configSiteId,
  getProfilePinRules, getCandidatePins, getPinCapabilities, getDefaultI2cBus,
  collectYamlPinUsage, isDs18b20SharedBusUsage, validatePeripheralEntity,
  fetchUrl, listPorts, getEspHomeBin, checkEsphome, sendWs,
  ensureEsphomeTables, resolveConfig, defaultSiteId, persistInstallState, updateJob, cleanupStaleEsphomeDuplicates,
  fetchGitHub, fetchRaw, extractYamlFromMarkdown, fetchDeviceYaml,
};
