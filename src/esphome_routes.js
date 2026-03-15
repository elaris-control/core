// src/esphome_routes.js
// ESPHome installer with board profiles + validator-first flow

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { listCatalogSummaries, getCatalogProfile, seedProfileCatalog, upsertProfileFromFile, upsertProfileFromObject } = require('./esphome/profile_registry');
const { normalizePayload, safeName, sha256, parseGpio, toGpioLabel } = require('./esphome/schema');
const { validateConfig } = require('./esphome/validator');
const { generateYAML, addPeripheralToYaml } = require('./esphome/generator');
const { parseEsphomeYaml } = require('./esphome/yaml_importer');
const https = require('https');
const http = require('http');


const COMMON_ESP32_GPIO_PINS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39];
const COMMON_ESP32_ADC_PINS = new Set([32, 33, 34, 35, 36, 39]);
const COMMON_ESP8266_GPIO_PINS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16];

function uniqNums(items) {
  return [...new Set((items || []).map(n => Number(n)).filter(Number.isFinite))].sort((a, b) => a - b);
}

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

  function mark(pinText) {
    const pin = normalizePinInput(pinText);
    if (!pin) return;
    if (!usage.has(pin)) usage.set(pin, { pin, kinds: new Set() });
    const bucket = usage.get(pin);
    bucket.kinds.add(`${topSection || 'root'}:${currentPlatform || 'raw'}`);
  }

  for (const line of lines) {
    const topMatch = line.match(/^([a-z_][a-z0-9_]*):\s*$/i);
    if (topMatch && !line.startsWith(' ')) {
      topSection = topMatch[1];
      currentPlatform = null;
      continue;
    }
    const platformMatch = line.match(/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i);
    if (platformMatch) {
      currentPlatform = platformMatch[1].toLowerCase();
      continue;
    }
    const pinMatch = line.match(/^\s*(?:pin:|number:)\s*(?:['"])?(GPIO\s*\d+|\d+)(?:['"])?\s*$/i);
    if (pinMatch) mark(pinMatch[1]);
  }

  return usage;
}

function isDs18b20SharedBusUsage(kinds) {
  const allow = new Set(['one_wire:gpio', 'sensor:dallas_temp']);
  for (const kind of kinds || []) {
    if (!allow.has(kind)) return false;
  }
  return true;
}

function validatePeripheralEntity({ profile, yamlText, entity }) {
  const errors = [];
  const warnings = [];
  const type = String(entity?.type || '').trim().toLowerCase();
  const pinText = String(entity?.pin || '').trim().toUpperCase();
  const gpio = parseGpio(pinText);
  if (gpio === null) return { ok: false, errors: ['invalid_pin_format — use GPIO<number>'], warnings, pin: null, pinMode: null };

  const rules = getProfilePinRules(profile);
  const caps = getPinCapabilities(profile, gpio);
  const label = toGpioLabel(gpio);

  if (rules.flashPins.includes(gpio)) errors.push(`${label} is a flash pin and cannot be used.`);
  if (rules.reserved.includes(gpio)) errors.push(`${label} is reserved by the board/profile.`);
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
    if (!sharedDs) errors.push(`pin_conflict — ${pinText} is already used in this device YAML.`);
    else warnings.push(`Shared 1-Wire bus detected on ${pinText}; adding another DS18B20 on the same pin is allowed.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    pin: pinText,
    pinMode: type === 'pulse_counter' && rules.noPullup.includes(gpio) ? 'INPUT' : (type === 'pulse_counter' ? 'INPUT_PULLUP' : null),
  };
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
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
  } catch {
    return [];
  }
}

function getEspHomeBin(dataDir) {
  const venvBin = path.join(dataDir, 'esphome_venv', 'bin', 'esphome');
  if (fs.existsSync(venvBin)) return venvBin;
  try {
    execSync('esphome version 2>&1', { encoding: 'utf8' });
    return 'esphome';
  } catch {}
  return null;
}

function checkEsphome(dataDir) {
  const bin = getEspHomeBin(dataDir);
  if (!bin) return { ok: false };
  try {
    const v = execSync(`"${bin}" version 2>&1`, { encoding: 'utf8' }).trim();
    return { ok: true, version: v, bin };
  } catch {
    return { ok: false };
  }
}

function sendWs(wsApi, clientId, type, level, text) {
  const msg = { type, level, text, ts: Date.now() };
  // ESPHome logs go only to the requesting engineer client — never broadcast globally,
  // as they may contain device configs, network details, and OTA progress.
  if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, msg);
  if (type === 'esphome_log' && wsApi.broadcastLog) {
    wsApi.broadcastLog({ level, text: `[FLASH] ${text}`, ts: Date.now() });
  }
}


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
      last_seen_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_esphome_devices_site_id ON esphome_devices(site_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_board_profile_id ON esphome_devices(board_profile_id);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_name ON esphome_devices(name);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mqtt_root ON esphome_devices(mqtt_topic_root);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_mac ON esphome_devices(mac_address);
    CREATE INDEX IF NOT EXISTS idx_esphome_devices_status ON esphome_devices(status);

    CREATE TABLE IF NOT EXISTS esphome_generated_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      esphome_device_id INTEGER NOT NULL,
      config_mode TEXT NOT NULL,
      board_profile_id TEXT NOT NULL,
      yaml_text TEXT NOT NULL,
      yaml_hash TEXT,
      validation_json TEXT,
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
}

function resolveConfig(db, body) {
  const payload = normalizePayload(body);
  const profile = getCatalogProfile(db, payload.board_profile_id);
  const validation = validateConfig({ profile, payload });
  const yaml = validation.ok && profile ? generateYAML({ profile, payload }) : '';
  return { payload, profile, validation, yaml };
}

function defaultSiteId(db) {
  try {
    const row = db.prepare('SELECT id FROM sites ORDER BY id ASC LIMIT 1').get();
    return row?.id || 1;
  } catch {
    return 1;
  }
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

  const existing = db.prepare('SELECT id FROM esphome_devices WHERE site_id=? AND lower(name)=lower(?) ORDER BY id DESC LIMIT 1').get(siteId, canonicalName);
  let deviceId = existing?.id || null;

  if (deviceId) {
    db.prepare(`
      UPDATE esphome_devices
      SET friendly_name=?, board_profile_id=?, chip=?, framework=?, transport=?, network_mode=?, status=?, serial_port=?, mqtt_topic_root=?, yaml_path=?, yaml_hash=?, last_validation_json=?, updated_at=?
      WHERE id=?
    `).run(
      payload.device_name || canonicalName,
      profile.id,
      profile.platform,
      payload.framework || profile.frameworkDefault || null,
      port && /^\/dev\//.test(port) ? 'usb' : 'ota',
      payload.use_ethernet ? 'ethernet' : 'wifi',
      jobStatus || 'generated',
      /^\/dev\//.test(port || '') ? port : null,
      mqttRoot,
      yamlPath || null,
      yamlHash,
      validationJson,
      now,
      deviceId,
    );
  } else {
    const ins = db.prepare(`
      INSERT INTO esphome_devices (
        site_id, name, friendly_name, board_profile_id, chip, framework, transport,
        network_mode, status, serial_port, mqtt_topic_root, yaml_path, yaml_hash,
        last_validation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      siteId,
      canonicalName,
      payload.device_name || canonicalName,
      profile.id,
      profile.platform,
      payload.framework || profile.frameworkDefault || null,
      port && /^\/dev\//.test(port) ? 'usb' : 'ota',
      payload.use_ethernet ? 'ethernet' : 'wifi',
      jobStatus || 'generated',
      /^\/dev\//.test(port || '') ? port : null,
      mqttRoot,
      yamlPath || null,
      yamlHash,
      validationJson,
      now,
      now,
    );
    deviceId = ins.lastInsertRowid;
  }

  let configId = null;
  if (yaml) {
    const cfg = db.prepare(`
      INSERT INTO esphome_generated_configs (
        esphome_device_id, config_mode, board_profile_id, yaml_text, yaml_hash, validation_json, generated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(deviceId, 'full', profile.id, yaml, yamlHash, validationJson, 'system');
    configId = cfg.lastInsertRowid;
  }

  const job = db.prepare(`
    INSERT INTO esphome_install_jobs (
      esphome_device_id, config_id, job_type, target_port, target_ip, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    deviceId,
    configId,
    'flash',
    /^\/dev\//.test(port || '') ? port : null,
    port && !/^\/dev\//.test(port) ? port : null,
    jobStatus || 'queued',
    now,
  );

  return { deviceId, configId, jobId: job.lastInsertRowid };
}

function updateJob(db, jobId, fields) {
  if (!db || !jobId) return;
  const row = db.prepare('SELECT * FROM esphome_install_jobs WHERE id=?').get(jobId);
  if (!row) return;
  db.prepare(`
    UPDATE esphome_install_jobs
    SET status=?, started_at=?, finished_at=?, exit_code=?, output_log=?, error_text=?
    WHERE id=?
  `).run(
    fields.status ?? row.status,
    fields.started_at ?? row.started_at,
    fields.finished_at ?? row.finished_at,
    fields.exit_code ?? row.exit_code,
    fields.output_log ?? row.output_log,
    fields.error_text ?? row.error_text,
    jobId,
  );
}

let activeFlash = null;
let activeSetup = null;

// ── ESPHome Device Browser (GitHub API) ──────────────────────────────────
const _browserCache = { list: null, ts: 0 };
const BROWSER_TTL = 60 * 60 * 1000; // 1 hour

function fetchGitHub(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      headers: { 'User-Agent': 'ELARIS-Smart-Home/1.0', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 12000,
    };
    https.get(options, res => {
      if (res.statusCode === 403) return reject(new Error('GitHub rate limit exceeded. Try again in 1 hour.'));
      if (res.statusCode !== 200) return reject(new Error(`GitHub API: HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON')); } });
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
  // Extract first ```yaml ... ``` block
  const m = md.match(/```ya?ml\r?\n([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

async function fetchDeviceYaml(slug) {
  const base = `https://raw.githubusercontent.com/esphome/esphome-devices/main/src/docs/devices/${slug}`;
  // Try direct .yaml file first
  try { return await fetchRaw(`${base}/${slug}.yaml`); } catch (_) {}
  // Try .md and extract
  try {
    const md = await fetchRaw(`${base}/${slug}.md`);
    const yaml = extractYamlFromMarkdown(md);
    if (yaml) return yaml;
  } catch (_) {}
  // List the directory and find any yaml/md
  try {
    const files = await fetchGitHub(`/repos/esphome/esphome-devices/contents/src/docs/devices/${slug}`);
    if (!Array.isArray(files)) throw new Error('not a directory');
    const yamlFile = files.find(f => f.name.endsWith('.yaml'));
    if (yamlFile) return await fetchRaw(yamlFile.download_url);
    const mdFile = files.find(f => f.name.endsWith('.md'));
    if (mdFile) {
      const md = await fetchRaw(mdFile.download_url);
      const yaml = extractYamlFromMarkdown(md);
      if (yaml) return yaml;
    }
  } catch (_) {}
  throw new Error(`No YAML found for device: ${slug}`);
}

function initEsphomeRoutes(app, { wsApi, dataDir, db, requireLogin, requireEngineerAccess, access }) {
  const cfgDir = path.join(dataDir, 'esphome');
  const venvDir = path.join(dataDir, 'esphome_venv');
  fs.mkdirSync(cfgDir, { recursive: true });
  ensureEsphomeTables(db);

  const getDeviceByIdStmt = db ? db.prepare('SELECT * FROM esphome_devices WHERE id=?') : null;
  const getDevicesByNameStmt = db ? db.prepare('SELECT * FROM esphome_devices WHERE lower(name)=lower(?) ORDER BY id DESC') : null;

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

  function ensureDeviceAccess(req, device, res) {
    if (!device) {
      if (res) res.status(404).json({ ok: false, error: 'device_not_found' });
      return false;
    }
    if (!access || access.canAccessSite(req, device.site_id)) return true;
    if (res) res.status(403).json({ ok: false, error: 'forbidden' });
    return false;
  }

  function configSiteId(cfg) {
    const siteId = Number(cfg?.site_id);
    if (Number.isFinite(siteId) && siteId > 0) return siteId;
    const deviceName = safeName(cfg?.device_name || '');
    if (!deviceName || !getDevicesByNameStmt) return null;
    const rows = getDevicesByNameStmt.all(deviceName) || [];
    const row = rows.find(r => r && r.site_id != null);
    return row ? row.site_id : null;
  }

  function redactSavedConfig(cfg) {
    const out = { ...(cfg || {}) };
    if (Object.prototype.hasOwnProperty.call(out, 'wifi_pass')) {
      out.wifi_pass_set = !!out.wifi_pass;
      out.wifi_pass = '';
    }
    return out;
  }

  app.get('/api/esphome/check', requireLogin, (req, res) => {
    res.json({
      ...checkEsphome(dataDir),
      ports: listPorts(),
      boards: listCatalogSummaries(db),
      presets: Object.fromEntries(listCatalogSummaries(db).map(b => [b.id, { entities: b.defaults || [] }])),
    });
  });

  app.get('/api/esphome/boards', requireLogin, (req, res) => {
    res.json({ boards: listCatalogSummaries(db) });
  });

  app.get('/api/esphome/profile/:id', requireLogin, (req, res) => {
    const profile = getCatalogProfile(db, req.params.id);
    if (!profile) return res.status(404).json({ error: 'profile_not_found' });
    res.json({ profile: listCatalogSummaries(db).find(b => b.id === profile.id) });
  });

  app.get('/api/esphome/ports', requireLogin, (req, res) => {
    const ports = listPorts();
    console.log('[ESPHOME] ports:', ports);
    res.json({ ports });
  });

  app.get('/api/esphome/catalog', requireLogin, (req, res) => {
    res.json({ boards: listCatalogSummaries(db) });
  });

  app.post('/api/esphome/catalog/reseed', requireEngineerAccess, (req, res) => {
    try {
      const seeded = seedProfileCatalog(db);
      res.json({ ok: true, count: seeded.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Inject all IOs from a board profile into pending_io so they appear in installer
  app.post('/api/esphome/catalog/:boardId/inject-pending', requireEngineerAccess, (req, res) => {
    try {
      const profile = getCatalogProfile(db, req.params.boardId);
      if (!profile) return res.status(404).json({ ok: false, error: 'profile_not_found' });

      const { device_name, site_id } = req.body || {};
      if (!device_name || !String(device_name).trim())
        return res.status(400).json({ ok: false, error: 'device_name required' });

      const deviceId = String(device_name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const entities = profile.entityDefaults || [];
      if (!entities.length) return res.status(400).json({ ok: false, error: 'profile_has_no_entities' });

      const now = Date.now();
      const upsert = db.prepare(`
        INSERT INTO pending_io(device_id, group_name, key, first_seen, last_seen, last_value, site_id)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, group_name, key) DO UPDATE SET
          last_seen=excluded.last_seen
      `);

      const isBlocked = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=?`);
      const isApproved = db.prepare(`SELECT 1 FROM io WHERE device_id=? AND key=?`);

      let injected = 0;
      let skipped = 0;
      const insertMany = db.transaction(() => {
        for (const e of entities) {
          if (!e?.key) continue;
          const group = e.type === 'relay' ? 'state' : 'tele';
          if (isBlocked.get(deviceId, group, e.key)) { skipped++; continue; }
          if (isApproved.get(deviceId, e.key)) { skipped++; continue; }
          upsert.run(deviceId, group, e.key, now, now, null, site_id || null);
          injected++;
        }
      });
      insertMany();

      res.json({ ok: true, device_id: deviceId, injected, skipped, total: entities.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── YAML import: parse ────────────────────────────────────────────────────
  app.post('/api/esphome/catalog/parse-yaml', requireEngineerAccess, async (req, res) => {
    try {
      let yamlText = req.body?.yaml || '';
      const url = req.body?.url || '';

      if (!yamlText && url) {
        yamlText = await fetchUrl(url);
      }
      if (!yamlText) return res.status(400).json({ ok: false, error: 'yaml_or_url_required' });

      const parsed = parseEsphomeYaml(yamlText);
      res.json({ ok: true, parsed });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // ── YAML import: save to catalog ──────────────────────────────────────────
  app.post('/api/esphome/catalog/save-parsed', requireEngineerAccess, (req, res) => {
    try {
      const { profile } = req.body || {};
      if (!profile || !profile.id || !profile.label)
        return res.status(400).json({ ok: false, error: 'profile id and label required' });

      // Build the file-shaped object upsertProfileFromFile expects
      const fileObj = {
        id: profile.id,
        label: profile.label,
        platform: profile.platform || 'esp32',
        board: profile.board || 'esp32dev',
        framework_default: profile.frameworkDefault || 'arduino',
        source: 'yaml_import',
        source_url: req.body.source_url || null,
        notes: profile.notes || [],
        definition: profile,
      };

      const saved = upsertProfileFromObject(db, fileObj);
      res.json({ ok: true, id: saved.id, label: saved.label });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/esphome/validate', requireEngineerAccess, (req, res) => {
    const { payload, profile, validation, yaml } = resolveConfig(db, req.body);
    if (!profile) return res.status(400).json({ ok: false, error: 'unknown_board_profile', validation });
    res.json({ ok: validation.ok, validation, yaml, profile: { id: profile.id, label: profile.label } });
  });

  app.post('/api/esphome/setup', requireEngineerAccess, (req, res) => {
    if (activeSetup) return res.status(409).json({ error: 'setup_in_progress' });
    res.json({ ok: true });

    const clientId = String(req.body?.client_id || '').trim() || null;
    sendWs(wsApi, clientId, 'esphome_setup_log', 'info', `Creating virtual environment at ${venvDir} …`);
    const script = `python3 -m venv "${venvDir}" && "${venvDir}/bin/pip" install --upgrade pip esphome`;
    const proc = spawn('bash', ['-c', script]);
    activeSetup = proc;

    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendWs(wsApi, clientId, 'esphome_setup_log', 'info', l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendWs(wsApi, clientId, 'esphome_setup_log', 'warn', l)));
    proc.on('close', code => {
      activeSetup = null;
      const ok = code === 0;
      const doneMsg = { type: 'esphome_setup_done', ok };
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, doneMsg);
      sendWs(wsApi, clientId, 'esphome_setup_log', ok ? 'info' : 'error', ok ? '✓ ESPHome installed successfully.' : `✗ Setup failed (exit ${code})`);
    });
    proc.on('error', err => {
      activeSetup = null;
      sendWs(wsApi, clientId, 'esphome_setup_log', 'error', `Setup error: ${err.message}`);
    });
  });

  app.post('/api/esphome/flash', requireEngineerAccess, (req, res) => {
    if (activeFlash) return res.status(409).json({ error: 'flash_in_progress' });
    const bin = getEspHomeBin(dataDir);
    if (!bin) return res.status(503).json({ error: 'esphome_not_installed' });

    const { payload, profile, validation, yaml } = resolveConfig(db, req.body);
    if (!profile) return res.status(400).json({ error: 'unknown_board_profile', validation });
    if (!validation.ok) return res.status(400).json({ error: 'validation_failed', validation, yaml: '' });
    if (!payload.port) return res.status(400).json({ error: 'missing_target_port_or_ip' });

    const yamlPath = path.join(cfgDir, `${safeName(payload.device_name)}.yaml`);
    fs.writeFileSync(yamlPath, yaml, 'utf8');
    const persisted = persistInstallState(db, { payload, profile, validation, yaml, yamlPath, port: payload.port, jobStatus: 'queued' });

    res.json({ ok: true, yaml, validation });

    const clientId = payload.client_id || null;
    const logs = [];
    const appendLog = (level, text) => {
      logs.push(`[${level}] ${text}`);
      sendWs(wsApi, clientId, 'esphome_log', level, text);
    };

    const args = ['run', yamlPath, '--no-logs'];
    if (payload.port) args.push('--device', payload.port);

    const proc = spawn(bin, args, { cwd: cfgDir });
    activeFlash = proc;
    updateJob(db, persisted?.jobId, { status: 'running', started_at: new Date().toISOString() });

    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('info', l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('warn', l)));

    proc.on('close', code => {
      activeFlash = null;
      const ok = code === 0;
      if (db && persisted?.deviceId) {
        db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run(ok ? 'flashed' : 'error', new Date().toISOString(), persisted.deviceId);
      }
      updateJob(db, persisted?.jobId, {
        status: ok ? 'success' : 'failed',
        finished_at: new Date().toISOString(),
        exit_code: code,
        output_log: logs.join('\n'),
        error_text: ok ? null : logs.slice(-20).join('\n'),
      });
      const doneMsg = { type: 'esphome_done', ok, code };
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, doneMsg);
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${payload.device_name}" will appear in Installer once it connects` : `✗ Flash failed (exit ${code})`);
    });

    proc.on('error', err => {
      activeFlash = null;
      updateJob(db, persisted?.jobId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_text: err.message,
        output_log: logs.join('\n'),
      });
      appendLog('error', `Cannot run esphome: ${err.message}`);
    });
  });

  app.delete('/api/esphome/flash', requireEngineerAccess, (req, res) => {
    if (activeFlash) {
      activeFlash.kill();
      activeFlash = null;
    }
    res.json({ ok: true });
  });

  app.get('/api/esphome/yaml/:name', requireEngineerAccess, (req, res) => {
    const p = path.join(cfgDir, `${safeName(req.params.name)}.yaml`);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not_found' });
    res.type('text/plain').send(fs.readFileSync(p, 'utf8'));
  });


  app.get('/api/esphome/devices', requireEngineerAccess, (req, res) => {
    if (!db) return res.json({ devices: [] });
    try {
      const rows = db.prepare(`
        SELECT
          d.id,
          d.site_id,
          d.name,
          d.friendly_name,
          d.board_profile_id,
          d.transport,
          d.network_mode,
          d.status,
          d.serial_port,
          d.mac_address,
          d.ip_address,
          d.hostname,
          d.mqtt_topic_root,
          d.firmware_version,
          d.last_seen_at,
          d.created_at,
          d.updated_at,
          j.target_port,
          j.target_ip,
          j.status AS job_status,
          j.finished_at AS job_finished_at
        FROM esphome_devices d
        LEFT JOIN esphome_install_jobs j
          ON j.id = (
            SELECT j2.id
            FROM esphome_install_jobs j2
            WHERE j2.esphome_device_id = d.id
            ORDER BY j2.id DESC
            LIMIT 1
          )
        ORDER BY d.id DESC
      `).all().filter(row => !access || access.canAccessSite(req, row.site_id));
      res.json({ devices: rows });
    } catch (e) {
      res.json({ devices: [], error: e.message });
    }
  });

  app.get('/api/esphome/configs', requireEngineerAccess, (req, res) => {
    try {
      const files = fs.readdirSync(cfgDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(cfgDir, f), 'utf8')); }
          catch { return null; }
        })
        .filter(Boolean)
        .filter(cfg => !access || access.canAccessSite(req, configSiteId(cfg)))
        .map(redactSavedConfig);
      res.json({ configs: files });
    } catch {
      res.json({ configs: [] });
    }
  });

  app.post('/api/esphome/configs', requireEngineerAccess, (req, res) => {
    const cfg = req.body;
    if (!cfg || !cfg.device_name) return res.status(400).json({ error: 'missing_device_name' });
    const p = path.join(cfgDir, `${safeName(cfg.device_name)}.json`);
    fs.writeFileSync(p, JSON.stringify({ ...cfg, saved_at: new Date().toISOString() }, null, 2), 'utf8');
    res.json({ ok: true });
  });

  app.delete('/api/esphome/configs/:name', requireEngineerAccess, (req, res) => {
    const p = path.join(cfgDir, `${safeName(req.params.name)}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ ok: true });
  });

  // ── Device Browser ────────────────────────────────────────────────────────
  app.get('/api/esphome/device-browser/list', requireLogin, async (req, res) => {
    try {
      if (_browserCache.list && Date.now() - _browserCache.ts < BROWSER_TTL) {
        return res.json({ ok: true, devices: _browserCache.list, cached: true });
      }
      const items = await fetchGitHub('/repos/esphome/esphome-devices/contents/src/docs/devices');
      if (!Array.isArray(items)) throw new Error('Unexpected response from GitHub');
      const devices = items
        .filter(i => i.type === 'dir')
        .map(i => ({ slug: i.name }));
      _browserCache.list = devices;
      _browserCache.ts = Date.now();
      res.json({ ok: true, devices, cached: false });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // ── Pin options for Add Peripheral panel ─────────────────────────────────
  app.get('/api/esphome/device/:id/pin-options', requireEngineerAccess, (req, res) => {
    const deviceId = Number(req.params.id);
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });

    const device = getDeviceByIdStmt.get(deviceId);
    if (!ensureDeviceAccess(req, device, res)) return;

    const profile = getCatalogProfile(db, device.board_profile_id);

    // Detect used pins from existing YAML
    const usedPinMap = device.yaml_path && fs.existsSync(device.yaml_path)
      ? collectYamlPinUsage(fs.readFileSync(device.yaml_path, 'utf8'))
      : new Map();
    const usedPins = [...usedPinMap.keys()];

    // Build board-aware + generic GPIO pin options.
    // If the profile has labeled ports (HT1 / A1 / etc.) we surface them first,
    // then append generic GPIO options so every board still works without custom labels.
    const sensorPorts = [];
    const seenPins = new Set();
    if (profile && Array.isArray(profile.entityDefaults)) {
      for (const e of profile.entityDefaults) {
        const pin = String(e.pin || (typeof e.source === 'string' && /^GPIO\d+$/i.test(e.source) ? e.source : '') || '').trim().toUpperCase();
        const gpio = parseGpio(pin);
        if (!pin || gpio === null || seenPins.has(pin)) continue;
        const supports = getPinCapabilities(profile, gpio);
        if (!supports.length) continue;
        const usage = usedPinMap.get(pin);
        sensorPorts.push({
          value: pin,
          label: e.source || pin,
          hint: e.name || (e.source || pin),
          supports,
          inUse: !!usage,
          usageKinds: usage ? [...usage.kinds] : [],
          noPullup: getProfilePinRules(profile).noPullup.includes(gpio),
          inputOnly: getProfilePinRules(profile).inputOnly.includes(gpio),
          generic: false,
        });
        seenPins.add(pin);
      }
    }

    const rules = getProfilePinRules(profile);
    for (const gpio of getCandidatePins(profile)) {
      const pin = toGpioLabel(gpio);
      if (seenPins.has(pin)) continue;
      const supports = getPinCapabilities(profile, gpio);
      if (!supports.length) continue;
      const usage = usedPinMap.get(pin);
      sensorPorts.push({
        value: pin,
        label: pin,
        hint: [
          supports.includes('analog') ? 'ADC capable' : null,
          rules.inputOnly.includes(gpio) ? 'input-only' : null,
          rules.noPullup.includes(gpio) ? 'no internal pull-up' : null,
          rules.strapping.includes(gpio) ? 'strapping pin' : null,
        ].filter(Boolean).join(' · ') || 'Generic GPIO',
        supports,
        inUse: !!usage,
        usageKinds: usage ? [...usage.kinds] : [],
        noPullup: rules.noPullup.includes(gpio),
        inputOnly: rules.inputOnly.includes(gpio),
        generic: true,
      });
    }

    res.json({
      ok: true,
      boardLabel: profile?.label || device.board_profile_id,
      sensorPorts,
      usedPins,
      reservedPins: rules.reserved,
      flashPins: rules.flashPins,
      inputOnlyPins: rules.inputOnly,
      noPullupPins: rules.noPullup,
      strappingPins: rules.strapping,
    });
  });

  // ── Add Peripheral to existing device (OTA) ─────────────────────────────
  app.post('/api/esphome/add-peripheral', requireEngineerAccess, (req, res) => {
    if (activeFlash) return res.status(409).json({ ok: false, error: 'flash_in_progress' });
    const bin = getEspHomeBin(dataDir);
    if (!bin) return res.status(503).json({ ok: false, error: 'esphome_not_installed' });

    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const ip = String(body.ip || '').trim();
    const clientId = String(body.client_id || '').trim() || null;
    const rawEntity = body.entity || {};

    if (!deviceId) return res.status(400).json({ ok: false, error: 'device_id required' });
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });

    // Validate entity fields
    const eType        = String(rawEntity.type         || '').trim().toLowerCase();
    const eName        = String(rawEntity.name         || '').trim();
    const ePinRaw      = String(rawEntity.pin          || '').trim();
    const ePin         = normalizePinInput(ePinRaw);
    const eKey         = String(rawEntity.key          || '').trim().replace(/[^a-z0-9_]/g, '_').replace(/^_|_$/g, '');
    const eScale       = String(rawEntity.scale        || 'none').trim();
    const eScaleFactor = Number(rawEntity.scale_factor) || 1;

    const ALLOWED_TYPES = ['ds18b20', 'dht11', 'dht', 'analog', 'pulse_counter'];
    if (!ALLOWED_TYPES.includes(eType)) return res.status(400).json({ ok: false, error: 'unsupported_entity_type' });
    if (!eName) return res.status(400).json({ ok: false, error: 'entity name required' });
    if (!ePinRaw)  return res.status(400).json({ ok: false, error: 'entity pin required' });
    if (!eKey)  return res.status(400).json({ ok: false, error: 'entity key required' });

    if (!ePin)
      return res.status(400).json({ ok: false, error: 'invalid_pin_format — use GPIO<number> or a numeric GPIO pin (e.g. GPIO32 or 32)' });

    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });

    const device = getDeviceByIdStmt.get(deviceId);
    if (!ensureDeviceAccess(req, device, res)) return;
    if (!device.yaml_path) return res.status(400).json({ ok: false, error: 'device_has_no_yaml_path' });
    if (!fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });

    const profile = getCatalogProfile(db, device.board_profile_id);

    // Read YAML early so we can do duplicate checks before writing anything
    const existingYamlForCheck = fs.readFileSync(device.yaml_path, 'utf8');

    // Check duplicate key — id: <key> already present in YAML
    if (hasYamlId(existingYamlForCheck, eKey) || ((eType === 'dht' || eType === 'dht11') && hasYamlId(existingYamlForCheck, `${eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${eKey}" already exists in this device's YAML` });

    const validation = validatePeripheralEntity({
      profile,
      yamlText: existingYamlForCheck,
      entity: { type: eType, pin: ePin },
    });
    if (!validation.ok)
      return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });

    const existingYaml = existingYamlForCheck;
    const originalYamlHash = device.yaml_hash || null;
    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');

    let updatedYaml;
    try {
      updatedYaml = addPeripheralToYaml(existingYaml, deviceSafeName, {
        type: eType, name: eName, key: eKey, pin: validation.pin || ePin,
        pin_mode: validation.pinMode,
        scale: eScale, scale_factor: eScaleFactor,
      }, {
        deviceName: device.friendly_name || device.name || deviceSafeName,
        boardLabel: profile?.label || device.board_profile_id,
        boardProfileId: device.board_profile_id,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'yaml_merge_failed: ' + e.message });
    }

    // Write updated YAML — keep original in memory for rollback
    fs.writeFileSync(device.yaml_path, updatedYaml, 'utf8');

    const now = new Date().toISOString();
    const { sha256 } = require('./esphome/schema');
    const updatedYamlHash = sha256(updatedYaml);

    db.prepare('UPDATE esphome_devices SET yaml_hash=?, status=?, updated_at=? WHERE id=?')
      .run(updatedYamlHash, 'generated', now, deviceId);

    // Rollback helper — restores original YAML on flash failure
    const rollback = () => {
      try {
        fs.writeFileSync(device.yaml_path, existingYaml, 'utf8');
        db.prepare('UPDATE esphome_devices SET yaml_hash=?, status=?, updated_at=? WHERE id=?')
          .run(originalYamlHash, 'flashed', new Date().toISOString(), deviceId);
        appendLog('warn', '↩ YAML rolled back to previous version (flash failed).');
      } catch (rbErr) {
        appendLog('error', `Rollback failed: ${rbErr.message}`);
      }
    };

    // Save new generated config record
    let configId = null;
    try {
      const cfg = db.prepare(
        'INSERT INTO esphome_generated_configs (esphome_device_id, config_mode, board_profile_id, yaml_text, yaml_hash, validation_json, generated_by) VALUES (?,?,?,?,?,?,?)'
      ).run(deviceId, 'add_peripheral', device.board_profile_id, updatedYaml, sha256(updatedYaml), JSON.stringify({ ok: true }), 'add_peripheral');
      configId = cfg.lastInsertRowid;
    } catch {}

    // Create job record
    let jobId = null;
    try {
      const job = db.prepare(
        'INSERT INTO esphome_install_jobs (esphome_device_id, config_id, job_type, target_ip, status, created_at) VALUES (?,?,?,?,?,?)'
      ).run(deviceId, configId, 'add_peripheral', ip, 'queued', now);
      jobId = job.lastInsertRowid;
    } catch {}

    res.json({ ok: true, yaml: updatedYaml, warnings: validation.warnings || [] });

    const logs = [];
    const appendLog = (level, text) => {
      logs.push(`[${level}] ${text}`);
      sendWs(wsApi, clientId, 'esphome_add_log', level, text);
    };

    const args = ['run', device.yaml_path, '--no-logs', '--device', ip];
    const proc = spawn(bin, args, { cwd: cfgDir });
    activeFlash = proc;
    if (jobId) updateJob(db, jobId, { status: 'running', started_at: now });

    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('info', l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('warn', l)));

    proc.on('close', code => {
      activeFlash = null;
      const ok = code === 0;
      if (!ok) rollback();
      else db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?')
        .run('flashed', new Date().toISOString(), deviceId);
      if (jobId) updateJob(db, jobId, {
        status: ok ? 'success' : 'failed',
        finished_at: new Date().toISOString(),
        exit_code: code,
        output_log: logs.join('\n'),
        error_text: ok ? null : logs.slice(-20).join('\n'),
      });
      const doneMsg = { type: 'esphome_add_done', ok, code, awaiting_report: !!ok, entity_key: eKey };
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, doneMsg);
      appendLog(ok ? 'info' : 'error', ok
        ? `✓ Flash complete — "${eName}" added to "${device.friendly_name || device.name}"`
        : `✗ Flash failed (exit ${code})`);
      if (ok) appendLog('info', `Waiting for the device to reconnect and publish MQTT config/state so ELARIS can auto-register pending IO "${eKey}".`);
    });

    proc.on('error', err => {
      activeFlash = null;
      rollback();
      if (jobId) updateJob(db, jobId, { status: 'failed', finished_at: new Date().toISOString(), error_text: err.message, output_log: logs.join('\n') });
      appendLog('error', `Cannot run esphome: ${err.message}`);
    });
  });

  // ── Preview updated YAML for add-peripheral (dry-run, no flash) ──────────
  app.post('/api/esphome/add-peripheral/preview', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const rawEntity = body.entity || {};

    const eType        = String(rawEntity.type         || '').trim().toLowerCase();
    const eName        = String(rawEntity.name         || '').trim();
    const ePinRaw      = String(rawEntity.pin          || '').trim();
    const ePin         = normalizePinInput(ePinRaw);
    const eKey         = String(rawEntity.key          || '').trim().replace(/[^a-z0-9_]/g, '_').replace(/^_|_$/g, '');
    const eScale       = String(rawEntity.scale        || 'none').trim();
    const eScaleFactor = Number(rawEntity.scale_factor) || 1;

    const ALLOWED_TYPES = ['ds18b20', 'dht11', 'dht', 'analog', 'pulse_counter'];
    if (!deviceId || !eType || !eName || !ePinRaw || !eKey)
      return res.status(400).json({ ok: false, error: 'missing required fields' });
    if (!ALLOWED_TYPES.includes(eType))
      return res.status(400).json({ ok: false, error: 'unsupported_entity_type' });
    if (!ePin)
      return res.status(400).json({ ok: false, error: 'invalid_pin_format — use GPIO<number> or a numeric GPIO pin' });
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });

    const device = getDeviceByIdStmt.get(deviceId);
    if (!ensureDeviceAccess(req, device, res)) return;
    if (!device.yaml_path || !fs.existsSync(device.yaml_path))
      return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });

    const existingYaml = fs.readFileSync(device.yaml_path, 'utf8');
    if (hasYamlId(existingYaml, eKey) || ((eType === 'dht' || eType === 'dht11') && hasYamlId(existingYaml, `${eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${eKey}" already exists` });

    const profile = getCatalogProfile(db, device.board_profile_id);
    const validation = validatePeripheralEntity({
      profile,
      yamlText: existingYaml,
      entity: { type: eType, pin: ePin },
    });
    if (!validation.ok)
      return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });

    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');

    try {
      const updatedYaml = addPeripheralToYaml(existingYaml, deviceSafeName, {
        type: eType, name: eName, key: eKey, pin: validation.pin || ePin,
        pin_mode: validation.pinMode,
        scale: eScale, scale_factor: eScaleFactor,
      }, {
        deviceName: device.friendly_name || device.name || deviceSafeName,
        boardLabel: profile?.label || device.board_profile_id,
        boardProfileId: device.board_profile_id,
      });
      res.json({ ok: true, yaml: updatedYaml, warnings: validation.warnings || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/esphome/device-browser/yaml', requireEngineerAccess, async (req, res) => {
    const slug = String(req.query.device || '').trim().replace(/[^a-z0-9_-]/gi, '');
    if (!slug) return res.status(400).json({ ok: false, error: 'device slug required' });
    try {
      const yaml = await fetchDeviceYaml(slug);
      res.json({ ok: true, yaml, slug });
    } catch (e) {
      res.status(404).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { initEsphomeRoutes };
