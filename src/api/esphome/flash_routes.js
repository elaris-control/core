'use strict';
// src/api/esphome/flash_routes.js — setup, flash, flash-from-yaml

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { safeName } = require('../../esphome/schema');
const { applyYamlOverrides } = require('../../esphome/generator');
const { parseEsphomeYaml } = require('../../esphome/yaml_importer');
const { getEspHomeBin, sendWs, resolveConfig, defaultSiteId, persistInstallState, updateJob } = require('../../esphome/helpers');
const { getCatalogProfile, listCatalogSummaries } = require('../../esphome/profile_registry');


function yamlHasTopLevelBlock(text, key) {
  const src = String(text || '');
  const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('^' + safeKey + '\\s*:(?:\\s*$|\\s*\\n)', 'mi');
  return rx.test(src);
}


function removeTopLevelBlock(text, key) {
  const src = String(text || '');
  const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('(^' + safeKey + '\\s*:[\\s\\S]*?)(?=^[^\\s#][^:]*:\\s*$|\\Z)', 'mi');
  const out = src.replace(rx, '').replace(/\n{3,}/g, '\n\n').trim();
  return out ? out + '\n' : '';
}

function buildManagedConfigJson({ deviceName, boardProfileId, boardLabel, entities }) {
  const hostname = safeName(deviceName || 'device');
  const list = (Array.isArray(entities) ? entities : [])
    .filter((e) => e && e.key)
    .map((e) => ({
      key: String(e.key),
      group: String(e.group || (String(e.type || '').toLowerCase() === 'relay' ? 'state' : 'tele')),
      type: String(e.type || 'sensor'),
      name: String(e.name || e.key),
    }));
  return JSON.stringify({
    device: {
      name: String(deviceName || hostname),
      hostname,
      model: String(boardLabel || 'ELARIS Imported ESPHome Device'),
      board_profile_id: boardProfileId || null,
      sw: '1.0.0',
    },
    entities: list,
  });
}

function injectManagedOverlay(yamlText, { deviceName, mqttHost, configJson }) {
  let out = String(yamlText || '');
  const deviceSafe = safeName(deviceName || 'device');
  if (!yamlHasTopLevelBlock(out, 'mqtt')) {
    out = out.trimEnd() + '\n\n' + [
      'mqtt:',
      `  broker: ${mqttHost}`,
      `  topic_prefix: ${deviceSafe}`,
      ''
    ].join('\n');
  }
  const configPayload = String(configJson || '{}').replace(/'/g, "''");
  const configTopic = `topic: "elaris/${deviceSafe}/config"`;
  if (!out.includes(configTopic)) {
    out = out.replace(/^esphome:\s*$/m, [
      'esphome:',
      '  on_boot:',
      '    priority: -100',
      '    then:',
      '      - delay: 2s',
      '      - mqtt.publish:',
      `          ${configTopic}`,
      `          payload: '${configPayload}'`,
      '          retain: true',
    ].join('\n'));
  } else {
    const escapedTopic = configTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(${escapedTopic}\\s*\\n\\s*payload:\\s*'[^\\n]*')(?!\\n\\s*retain:\\s*true)`, 'm'),
      `$1\\n          retain: true`
    );
  }
  return out;
}
function pickCatalogProfileForYaml(db, parsed, explicitProfileId) {
  const explicit = String(explicitProfileId || '').trim();
  if (explicit) {
    const def = getCatalogProfile(db, explicit);
    if (def) return def;
  }
  const rows = listCatalogSummaries(db || null);
  if (!rows.length) return null;
  const parsedId = String(parsed?.id || '').trim().toLowerCase();
  const parsedBoard = String(parsed?.board || '').trim().toLowerCase();
  const parsedLabel = String(parsed?.label || '').trim().toLowerCase();
  const wantEth = !!(parsed && parsed.supports && parsed.supports.ethernet);
  const scored = rows.map((row) => {
    let score = 0;
    const rowId = String(row.id || '').trim().toLowerCase();
    const rowBoard = String(row.board || '').trim().toLowerCase();
    const rowLabel = String(row.label || '').trim().toLowerCase();
    if (parsedId && rowId === parsedId) score += 120;
    if (parsedId && rowId.endsWith(parsedId)) score += 90;
    if (parsedId && rowLabel.includes(parsedId.replace(/[_-]+/g, ' '))) score += 40;
    if (parsedLabel && rowLabel === parsedLabel) score += 50;
    if (parsedBoard && rowBoard && parsedBoard === rowBoard) score += 10;
    if (wantEth && row.supports && row.supports.ethernet) score += 20;
    if (rowId.includes('kc868') && (parsedId.includes('kc868') || parsedId.includes('a16'))) score += 20;
    return { row, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 30 ? getCatalogProfile(db, scored[0].row.id) : null;
}

function resetManagedDiscoveryRows(db, deviceName) {
  const id = String(deviceName || '').trim();
  if (!db || !id) return { cleared_blocked: 0, cleared_pending: 0 };
  let clearedBlocked = 0;
  let clearedPending = 0;
  db.transaction(() => {
    clearedBlocked = db.prepare('DELETE FROM blocked_io WHERE device_id=?').run(id).changes || 0;
    clearedPending = db.prepare('DELETE FROM pending_io WHERE device_id=?').run(id).changes || 0;
  })();
  return { cleared_blocked: clearedBlocked, cleared_pending: clearedPending };
}

function mountFlashRoutes({ app, db, wsApi, dataDir, cfgDir, venvDir, requireEngineerAccess, state }) {

  function getSetupPrereqs() {
    const probe = spawnSync('python3', ['-c', 'import ensurepip; print("ok")'], { encoding: 'utf8' });
    const ok = probe.status === 0;
    const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    const pyVersion = String(py.stdout || py.stderr || '').trim() || 'python3';
    const pkgMatch = pyVersion.match(/Python\s+(\d+)\.(\d+)/i);
    const venvPkg = pkgMatch ? `python${pkgMatch[1]}.${pkgMatch[2]}-venv` : 'python3-venv';
    return {
      ok: true,
      ensurepip_available: ok,
      python_version: pyVersion,
      missing_package_hint: ok ? null : venvPkg,
      install_command: ok ? null : `sudo apt install -y ${venvPkg}`,
    };
  }

  const mountGet = typeof app.get === 'function' ? app.get.bind(app) : app.post.bind(app);
  mountGet('/api/esphome/setup-prereqs', requireEngineerAccess, (_req, res) => {
    try {
      res.json(getSetupPrereqs());
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/esphome/setup', requireEngineerAccess, (req, res) => {
    if (state.activeSetup) return res.status(409).json({ error: 'setup_in_progress' });

    const prereqs = getSetupPrereqs();
    const clientId = String(req.body?.client_id || '').trim() || null;
    if (!prereqs.ensurepip_available) {
      const hint = 'Missing Python venv support on this machine. Install the system package for python venvs, then retry.';
      if (clientId && wsApi?.sendToClient) {
        wsApi.sendToClient(clientId, {
          type: 'esphome_setup_done',
          ok: false,
          hint,
          install_command: prereqs.install_command,
          error_text: 'python3 ensurepip is unavailable',
        });
      }
      sendWs(wsApi, clientId, 'esphome_setup_log', 'error', hint + (prereqs.install_command ? ` Run: ${prereqs.install_command}` : ''));
      return res.status(409).json({ ok: false, error: 'missing_python_venv_support', hint, install_command: prereqs.install_command, python_version: prereqs.python_version, missing_package_hint: prereqs.missing_package_hint });
    }

    res.json({ ok: true });
    sendWs(wsApi, clientId, 'esphome_setup_log', 'info', `Creating virtual environment at ${venvDir} …`);
    const script = `rm -rf "${venvDir}" && python3 -m venv "${venvDir}" && "${venvDir}/bin/pip" install --upgrade pip esphome`;
    const proc = spawn('bash', ['-c', script]);
    const setupErr = [];
    state.activeSetup = proc;
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendWs(wsApi, clientId, 'esphome_setup_log', 'info', l)));
    proc.stderr.on('data', d => {
      d.toString().split('\n').filter(Boolean).forEach(l => {
        setupErr.push(l);
        sendWs(wsApi, clientId, 'esphome_setup_log', 'warn', l);
      });
    });
    proc.on('close', code => {
      state.activeSetup = null;
      const ok = code === 0;
      const errText = setupErr.join('\n');
      const missingVenv = /ensurepip is not available|python\d+(?:\.\d+)?-venv|python3(?:\.\d+)?-venv/i.test(errText);
      const hint = missingVenv ? 'Missing Python venv support on this machine. Install the system package for python venvs, then retry.' : null;
      const installCommand = missingVenv ? ((errText.match(/apt install\s+([^\n]+)/i)?.[0]) || 'sudo apt install -y python3-venv') : null;
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, { type: 'esphome_setup_done', ok, hint, install_command: installCommand, error_text: errText.slice(-4000) });
      sendWs(wsApi, clientId, 'esphome_setup_log', ok ? 'info' : 'error', ok ? '✓ ESPHome installed successfully.' : `✗ Setup failed (exit ${code})`);
      if (!ok && hint) sendWs(wsApi, clientId, 'esphome_setup_log', 'warn', hint + (installCommand ? ` Run: ${installCommand}` : ''));
    });
    proc.on('error', err => { state.activeSetup = null; sendWs(wsApi, clientId, 'esphome_setup_log', 'error', `Setup error: ${err.message}`); });
  });

  app.post('/api/esphome/flash', requireEngineerAccess, (req, res) => {
    if (state.activeFlash) return res.status(409).json({ error: 'flash_in_progress' });
    const bin = getEspHomeBin(dataDir);
    if (!bin) return res.status(503).json({ error: 'esphome_not_installed' });
    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'integration_key')) body.integration_key = 'esphome';
    if (!Object.prototype.hasOwnProperty.call(body, 'ownership_mode')) body.ownership_mode = 'managed_internal';
    if (!Object.prototype.hasOwnProperty.call(body, 'config_source')) body.config_source = 'board_profile';
    if (!Object.prototype.hasOwnProperty.call(body, 'read_only')) body.read_only = 0;
    const { payload, profile, validation, yaml } = resolveConfig(db, body);
    if (!profile) return res.status(400).json({ error: 'unknown_board_profile', validation });
    if (!validation.ok) return res.status(400).json({ error: 'validation_failed', validation, yaml: '' });
    if (!payload.port) return res.status(400).json({ error: 'missing_target_port_or_ip' });
    const yamlPath = path.join(cfgDir, `${safeName(payload.device_name)}.yaml`);
    fs.writeFileSync(yamlPath, yaml, 'utf8');
    const reset = resetManagedDiscoveryRows(db, payload.device_name);
    const persisted = persistInstallState(db, { payload, profile, validation, yaml, yamlPath, port: payload.port, jobStatus: 'queued' });
    res.json({ ok: true, yaml, validation, reset, job_id: persisted?.jobId || null, device_id: persisted?.deviceId || null });
    const clientId = payload.client_id || null;
    const logs = [];
    const appendLog = (level, text) => { logs.push(`[${level}] ${text}`); sendWs(wsApi, clientId, 'esphome_log', level, text); };
    const args = ['run', yamlPath, '--no-logs'];
    if (payload.port) args.push('--device', payload.port);
    const proc = spawn(bin, args, { cwd: cfgDir });
    state.activeFlash = proc;
    updateJob(db, persisted?.jobId, { status: 'running', started_at: new Date().toISOString() });
    if (db && persisted?.deviceId) db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run('running', new Date().toISOString(), persisted.deviceId);
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('info', l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('warn', l)));
    proc.on('close', code => {
      state.activeFlash = null;
      const ok = code === 0;
      if (db && persisted?.deviceId) db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run(ok ? 'flashed' : 'error', new Date().toISOString(), persisted.deviceId);
      updateJob(db, persisted?.jobId, { status: ok ? 'success' : 'failed', finished_at: new Date().toISOString(), exit_code: code, output_log: logs.join('\n'), error_text: ok ? null : logs.slice(-20).join('\n') });
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, { type: 'esphome_done', ok, code });
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${payload.device_name}" will appear in Installer once it connects` : `✗ Flash failed (exit ${code})`);
    });
    proc.on('error', err => {
      state.activeFlash = null;
      updateJob(db, persisted?.jobId, { status: 'failed', finished_at: new Date().toISOString(), error_text: err.message, output_log: logs.join('\n') });
      appendLog('error', `Cannot run esphome: ${err.message}`);
    });
  });

  app.delete('/api/esphome/flash', requireEngineerAccess, (req, res) => {
    if (state.activeFlash) { state.activeFlash.kill(); state.activeFlash = null; }
    res.json({ ok: true });
  });

  app.post('/api/esphome/flash-from-yaml', requireEngineerAccess, (req, res) => {
    if (state.activeFlash) return res.status(409).json({ error: 'flash_in_progress' });
    const bin = getEspHomeBin(dataDir);
    if (!bin) return res.status(503).json({ error: 'esphome_not_installed' });
    const body = req.body || {};
    let yamlText = String(body.yaml_text || '').trim();
    const device_name = String(body.device_name || '').trim();
    // device_id is the MQTT identifier (safe name used as topic prefix, esphome name, etc.)
    // Falls back to device_name if not provided (backwards compat).
    const device_id = String(body.device_id || '').trim() || device_name;
    const wifi_ssid = String(body.wifi_ssid || '').trim();
    const wifi_pass = String(body.wifi_pass ?? '');
    const mqtt_host = String(body.mqtt_host || '').trim();
    const port = String(body.port || body.ip || '').trim();
    const site_id = body.site_id != null ? Number(body.site_id) : defaultSiteId(db);
    const client_id = String(body.client_id || '').trim() || null;
    if (!yamlText) return res.status(400).json({ ok: false, error: 'yaml_text_required' });
    if (!device_name) return res.status(400).json({ ok: false, error: 'device_name_required' });
    if (!port) return res.status(400).json({ ok: false, error: 'port_or_ip_required' });
    // Duplicate name check — reject if another device already uses this device_id.
    const existingId = Number(body.existing_device_id || 0) || null;
    const duplicate = db.prepare(`SELECT id FROM esphome_devices WHERE name=? AND deleted_at IS NULL AND id != COALESCE(?,0) LIMIT 1`).get(safeName(device_id), existingId);
    if (duplicate) return res.status(409).json({ ok: false, error: 'device_name_already_exists', device_id: safeName(device_id) });
    // Extract old device name from YAML before overrides — needed to auto-clean stale blocked/pending rows.
    const oldNameMatch = yamlText.match(/^[ \t]{1,4}name\s*:\s*(\S+)/m);
    const oldDeviceId = oldNameMatch ? String(oldNameMatch[1]).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : null;
    // Use device_id for YAML name/MQTT substitution; device_name becomes friendly_name only.
    let finalYaml = applyYamlOverrides(yamlText, { device_name: device_id, friendly_name: device_name, wifi_ssid, wifi_pass, mqtt_host });
    // Strip remaining !secret tags — HA-specific secrets (api key, ota password, etc.)
    // not needed by ELARIS. Replace *key* secrets with a valid random base64 value,
    // everything else with an empty string so ESPHome doesn't abort on missing secrets.yaml.
    const crypto = require('crypto');
    finalYaml = finalYaml.replace(/!secret\s+(\S+)/g, (_, name) =>
      /key|encr/i.test(name) ? '"' + crypto.randomBytes(32).toString('base64') + '"' : '""'
    );
    let parsed;
    try { parsed = parseEsphomeYaml(finalYaml); }
    catch (e) { return res.status(400).json({ ok: false, error: 'invalid_yaml_after_overrides: ' + String(e?.message || e) }); }
    let hasWifi = yamlHasTopLevelBlock(finalYaml, 'wifi');
    const hasEthernet = yamlHasTopLevelBlock(finalYaml, 'ethernet');
    if (hasWifi && hasEthernet) {
      // For ELARIS-managed imports, prefer Ethernet when the source YAML already has ethernet.
      // This matches the UI hint that WiFi fields are ignored for ethernet boards.
      finalYaml = removeTopLevelBlock(finalYaml, 'wifi');
      hasWifi = false;
    }
    const explicitExistingId = Number(body.existing_device_id || 0) || null;
    const explicitProfileId = String(body.board_profile_id || '').trim();
    let selectedRow = null;
    if (explicitExistingId) {
      try { selectedRow = db.prepare('SELECT * FROM esphome_devices WHERE id=? LIMIT 1').get(explicitExistingId); } catch (_) { selectedRow = null; }
    }
    const selectedProfileId = String(selectedRow?.board_profile_id || '').trim();
    const resolvedProfile = pickCatalogProfileForYaml(db, parsed, explicitProfileId || selectedProfileId) || {
      id: explicitProfileId || selectedProfileId || parsed.id || 'yaml_draft',
      label: parsed.label || device_name,
      platform: parsed.platform || 'esp32',
      frameworkDefault: parsed.frameworkDefault || 'arduino'
    };
    const managedEntities = Array.isArray(parsed.entityDefaults) ? parsed.entityDefaults.map((e) => ({
      key: e.key,
      group: e.group || (String(e.type || '').toLowerCase() === 'relay' ? 'state' : 'tele'),
      type: e.type,
      name: e.name || e.key,
    })) : [];
    if (mqtt_host) {
      const configJson = buildManagedConfigJson({
        deviceName: device_id,
        boardProfileId: resolvedProfile.id,
        boardLabel: resolvedProfile.label || device_name,
        entities: managedEntities,
      });
      finalYaml = injectManagedOverlay(finalYaml, { deviceName: device_id, mqttHost: mqtt_host, configJson });
    }
    const payload = {
      site_id,
      device_name: device_id,
      board_profile_id: resolvedProfile.id,
      wifi_ssid,
      wifi_pass,
      mqtt_host,
      port,
      client_id,
      use_ethernet: hasEthernet && !hasWifi,
      existing_device_id: explicitExistingId,
      entities: managedEntities,
      integration_key: 'esphome',
      ownership_mode: 'managed_internal',
      config_source: 'use_my_yaml_overlay',
      read_only: 0
    };
    const validation = { ok: true };
    const yamlPath = path.join(cfgDir, `${safeName(device_id)}.yaml`);
    fs.writeFileSync(yamlPath, finalYaml, 'utf8');
    const reset = resetManagedDiscoveryRows(db, device_id);
    // If YAML had a different old name, auto-clear its stale blocked/pending rows too.
    if (oldDeviceId && oldDeviceId !== safeName(device_id)) {
      resetManagedDiscoveryRows(db, oldDeviceId);
    }
    const persisted = persistInstallState(db, { payload, profile: resolvedProfile, validation, yaml: finalYaml, yamlPath, port, jobStatus: 'queued' });
    res.json({ ok: true, yaml: finalYaml, validation, reset, job_id: persisted?.jobId || null, device_id: persisted?.deviceId || null });
    const logs = [];
    const appendLog = (level, text) => { logs.push(`[${level}] ${text}`); sendWs(wsApi, client_id, 'esphome_log', level, text); };
    const args = ['run', yamlPath, '--no-logs'];
    if (port) args.push('--device', port);
    console.log(`[ESPHOME] spawn: bin=${bin} args=${JSON.stringify(args)} client_id=${client_id}`);
    const proc = spawn(bin, args, { cwd: cfgDir });
    state.activeFlash = proc;
    updateJob(db, persisted?.jobId, { status: 'running', started_at: new Date().toISOString() });
    if (db && persisted?.deviceId) db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run('running', new Date().toISOString(), persisted.deviceId);
    proc.stdout.on('data', d => { d.toString().split('\n').filter(Boolean).forEach(l => { console.log(`[ESPHOME out] ${l}`); appendLog('info', l); }); });
    proc.stderr.on('data', d => { d.toString().split('\n').filter(Boolean).forEach(l => { console.log(`[ESPHOME err] ${l}`); appendLog('warn', l); }); });
    proc.on('close', code => {
      state.activeFlash = null;
      const ok = code === 0;
      console.log(`[ESPHOME] process closed, exit=${code}`);
      if (db && persisted?.deviceId) db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run(ok ? 'flashed' : 'error', new Date().toISOString(), persisted.deviceId);
      updateJob(db, persisted?.jobId, { status: ok ? 'success' : 'failed', finished_at: new Date().toISOString(), exit_code: code, output_log: logs.join('\n'), error_text: ok ? null : logs.slice(-20).join('\n') });
      if (client_id && wsApi.sendToClient) wsApi.sendToClient(client_id, { type: 'esphome_done', ok, code });
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${device_name}" will appear in Installer once the ELARIS MQTT announce arrives` : `✗ Flash failed (exit ${code})`);
    });
    proc.on('error', err => {
      state.activeFlash = null;
      console.error(`[ESPHOME] spawn error: ${err.message}`);
      updateJob(db, persisted?.jobId, { status: 'failed', finished_at: new Date().toISOString(), error_text: err.message, output_log: logs.join('\n') });
      appendLog('error', `Cannot run esphome: ${err.message}`);
    });
  });
}

module.exports = { mountFlashRoutes };
