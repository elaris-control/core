// src/esphome_routes.js
// ESPHome installer with board profiles + validator-first flow

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { listCatalogSummaries, getCatalogProfile, seedProfileCatalog, upsertProfileFromFile, upsertProfileFromObject } = require('./esphome/profile_registry');
const { normalizePayload, safeName, sha256 } = require('./esphome/schema');
const { validateConfig } = require('./esphome/validator');
const { generateYAML } = require('./esphome/generator');
const { parseEsphomeYaml } = require('./esphome/yaml_importer');
const https = require('https');
const http = require('http');

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

function initEsphomeRoutes(app, { wsApi, dataDir, db, requireLogin, requireEngineerAccess }) {
  const cfgDir = path.join(dataDir, 'esphome');
  const venvDir = path.join(dataDir, 'esphome_venv');
  fs.mkdirSync(cfgDir, { recursive: true });
  ensureEsphomeTables(db);

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


  app.get('/api/esphome/devices', requireLogin, (req, res) => {
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
      `).all();
      res.json({ devices: rows });
    } catch (e) {
      res.json({ devices: [], error: e.message });
    }
  });

  app.get('/api/esphome/configs', requireLogin, (req, res) => {
    try {
      const files = fs.readdirSync(cfgDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(cfgDir, f), 'utf8')); }
          catch { return null; }
        })
        .filter(Boolean);
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
