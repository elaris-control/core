'use strict';
// src/api/esphome/flash_routes.js — setup, flash, flash-from-yaml

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { safeName } = require('../../esphome/schema');
const { applyYamlOverrides } = require('../../esphome/generator');
const { parseEsphomeYaml } = require('../../esphome/yaml_importer');
const { getEspHomeBin, sendWs, resolveConfig, defaultSiteId, persistInstallState, updateJob } = require('../../esphome/helpers');

function mountFlashRoutes({ app, db, wsApi, dataDir, cfgDir, venvDir, requireEngineerAccess, state }) {

  app.post('/api/esphome/setup', requireEngineerAccess, (req, res) => {
    if (state.activeSetup) return res.status(409).json({ error: 'setup_in_progress' });
    res.json({ ok: true });
    const clientId = String(req.body?.client_id || '').trim() || null;
    sendWs(wsApi, clientId, 'esphome_setup_log', 'info', `Creating virtual environment at ${venvDir} …`);
    const script = `python3 -m venv "${venvDir}" && "${venvDir}/bin/pip" install --upgrade pip esphome`;
    const proc = spawn('bash', ['-c', script]);
    state.activeSetup = proc;
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendWs(wsApi, clientId, 'esphome_setup_log', 'info', l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => sendWs(wsApi, clientId, 'esphome_setup_log', 'warn', l)));
    proc.on('close', code => {
      state.activeSetup = null;
      const ok = code === 0;
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, { type: 'esphome_setup_done', ok });
      sendWs(wsApi, clientId, 'esphome_setup_log', ok ? 'info' : 'error', ok ? '✓ ESPHome installed successfully.' : `✗ Setup failed (exit ${code})`);
    });
    proc.on('error', err => { state.activeSetup = null; sendWs(wsApi, clientId, 'esphome_setup_log', 'error', `Setup error: ${err.message}`); });
  });

  app.post('/api/esphome/flash', requireEngineerAccess, (req, res) => {
    if (state.activeFlash) return res.status(409).json({ error: 'flash_in_progress' });
    const bin = getEspHomeBin(dataDir);
    if (!bin) return res.status(503).json({ error: 'esphome_not_installed' });
    const { payload, profile, validation, yaml } = resolveConfig(db, req.body);
    if (!profile) return res.status(400).json({ error: 'unknown_board_profile', validation });
    if (!validation.ok) return res.status(400).json({ error: 'validation_failed', validation, yaml: '' });
    if (!payload.port) return res.status(400).json({ error: 'missing_target_port_or_ip' });
    const yamlPath = path.join(cfgDir, `${safeName(payload.device_name)}.yaml`);
    fs.writeFileSync(yamlPath, yaml, 'utf8');
    const persisted = persistInstallState(db, { payload, profile, validation, yaml, yamlPath, port: payload.port, jobStatus: 'queued' });
    res.json({ ok: true, yaml, validation, job_id: persisted?.jobId || null, device_id: persisted?.deviceId || null });
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
    const wifi_ssid = String(body.wifi_ssid || '').trim();
    const wifi_pass = String(body.wifi_pass ?? '');
    const mqtt_host = String(body.mqtt_host || '').trim();
    const port = String(body.port || body.ip || '').trim();
    const site_id = body.site_id != null ? Number(body.site_id) : defaultSiteId(db);
    const client_id = String(body.client_id || '').trim() || null;
    if (!yamlText) return res.status(400).json({ ok: false, error: 'yaml_text_required' });
    if (!device_name) return res.status(400).json({ ok: false, error: 'device_name_required' });
    if (!port) return res.status(400).json({ ok: false, error: 'port_or_ip_required' });
    const finalYaml = applyYamlOverrides(yamlText, { device_name, wifi_ssid, wifi_pass, mqtt_host });
    let parsed;
    try { parsed = parseEsphomeYaml(finalYaml); }
    catch (e) { return res.status(400).json({ ok: false, error: 'invalid_yaml_after_overrides: ' + String(e?.message || e) }); }
    const minimalProfile = { id: parsed.id || 'yaml_draft', label: parsed.label || device_name, platform: parsed.platform || 'esp32', frameworkDefault: parsed.frameworkDefault || 'arduino' };
    const payload = { site_id, device_name, board_profile_id: minimalProfile.id, wifi_ssid, wifi_pass, mqtt_host, port, client_id, entities: Array.isArray(parsed.entityDefaults) ? parsed.entityDefaults : [] };
    const validation = { ok: true };
    const yamlPath = path.join(cfgDir, `${safeName(device_name)}.yaml`);
    fs.writeFileSync(yamlPath, finalYaml, 'utf8');
    const persisted = persistInstallState(db, { payload, profile: minimalProfile, validation, yaml: finalYaml, yamlPath, port, jobStatus: 'queued' });
    res.json({ ok: true, yaml: finalYaml, validation, job_id: persisted?.jobId || null, device_id: persisted?.deviceId || null });
    const logs = [];
    const appendLog = (level, text) => { logs.push(`[${level}] ${text}`); sendWs(wsApi, client_id, 'esphome_log', level, text); };
    const args = ['run', yamlPath, '--no-logs'];
    if (port) args.push('--device', port);
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
      if (client_id && wsApi.sendToClient) wsApi.sendToClient(client_id, { type: 'esphome_done', ok, code });
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${device_name}" will appear in Installer once it connects` : `✗ Flash failed (exit ${code})`);
    });
    proc.on('error', err => {
      state.activeFlash = null;
      updateJob(db, persisted?.jobId, { status: 'failed', finished_at: new Date().toISOString(), error_text: err.message, output_log: logs.join('\n') });
      appendLog('error', `Cannot run esphome: ${err.message}`);
    });
  });
}

module.exports = { mountFlashRoutes };
