'use strict';
// src/api/esphome/peripheral_routes.js — pin-options, add/edit/remove peripheral (OTA), preview

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getCatalogProfile } = require('../../esphome/profile_registry');
const { deriveBoardPorts, resolvePeripheralSelection } = require('../../esphome/board_port_registry');
const { safeName, sha256, parseGpio, toGpioLabel } = require('../../esphome/schema');
const { addPeripheralToYaml } = require('../../esphome/generator');
const { parseManagedPeripherals, removeManagedPeripheralFromYaml, updateManagedPeripheralInYaml } = require('../../esphome/peripheral_editor');
const {
  getEspHomeBin, sendWs, updateJob,
  validatePeripheralEntity, collectYamlPinUsage, getProfilePinRules, getPinCapabilities,
  normalizePinInput, ensureDeviceAccess, hasYamlId, getCandidatePins, getDefaultI2cBus,
} = require('../../esphome/helpers');

const ALLOWED_TYPES = ['ds18b20', 'dht11', 'dht', 'analog', 'pulse_counter', 'bh1750', 'sht3x', 'di'];

const TYPE_ALIASES = {
  anemometer: { type: 'pulse_counter', scale: 'anemometer' },
  yfs201: { type: 'pulse_counter', scale: 'yfs201' },
  rain_digital: { type: 'di' },
  pir: { type: 'di' },
  door_contact: { type: 'di' },
  vibration: { type: 'di' },
  water_leak: { type: 'di' },
  float_switch: { type: 'di' },
  soil_moisture: { type: 'analog' },
  ntc: { type: 'analog' },
  mq2: { type: 'analog' },
  mq7: { type: 'analog' },
  mq135: { type: 'analog' },
  ct_clamp: { type: 'analog' },
};

function sanitizeEntityInput(rawEntity = {}) {
  const rawType = String(rawEntity.type || '').trim().toLowerCase();
  const alias = TYPE_ALIASES[rawType] || null;
  const eType = String((alias && alias.type) || rawType).trim().toLowerCase();
  const eName = String(rawEntity.name || '').trim();
  const ePortId = String(rawEntity.port_id || '').trim();
  const eBusId = String(rawEntity.bus_id || '').trim();
  const ePinRaw = String(rawEntity.pin || '').trim();
  const ePin = normalizePinInput(ePinRaw);
  const eSdaRaw = String(rawEntity.sda || '').trim();
  const eSclRaw = String(rawEntity.scl || '').trim();
  const eAddress = String(rawEntity.address || '').trim().toLowerCase();
  const eKey = String(rawEntity.key || '').trim().replace(/[^a-z0-9_]/g, '_').replace(/^_|_$/g, '');
  const eScale = String(rawEntity.scale || (alias && alias.scale) || 'none').trim();
  const eScaleFactor = Number(rawEntity.scale_factor) || 1;
  const isI2c = eType === 'bh1750' || eType === 'sht3x';
  return { eType, eName, ePortId, eBusId, ePinRaw, ePin, eSdaRaw, eSclRaw, eAddress, eKey, eScale, eScaleFactor, isI2c };
}

function validateRawEntityBasics(clean) {
  if (!clean.eType || !clean.eName || !clean.eKey) return 'missing required fields';
  if (!ALLOWED_TYPES.includes(clean.eType)) return 'unsupported_entity_type';
  if (clean.isI2c) {
    if (!clean.eAddress) return 'i2c_fields_required';
  } else {
    if (!clean.ePortId && !clean.ePinRaw) return 'entity pin required';
    if (!clean.ePortId && !clean.ePin) return 'invalid_pin_format — use GPIO<number> or a numeric GPIO pin';
  }
  return null;
}

function keysForEntityType(type, key) {
  const t = String(type || '').toLowerCase();
  if (t === 'dht' || t === 'dht11' || t === 'sht3x') return [key, `${key}_hum`];
  return [key];
}

function syncIoRowsForPeripheral(db, deviceName, oldPeripheral, nextEntity, boardProfileId) {
  if (!db || !deviceName || !oldPeripheral || !nextEntity) return;
  const oldKeys = keysForEntityType(oldPeripheral.type, oldPeripheral.key);
  const newKeys = keysForEntityType(nextEntity.type, nextEntity.key);
  const newNames = (function(){
    const t = String(nextEntity.type || '').toLowerCase();
    if (t === 'dht' || t === 'dht11' || t === 'sht3x') return [`${nextEntity.name} Temperature`, `${nextEntity.name} Humidity`];
    return [nextEntity.name || nextEntity.key];
  })();
  const group = 'tele';
  const now = Date.now();
  for (let i = 0; i < Math.max(oldKeys.length, newKeys.length); i++) {
    const oldKey = oldKeys[i] || oldKeys[oldKeys.length - 1];
    const newKey = newKeys[i] || newKeys[newKeys.length - 1];
    const newName = newNames[i] || newNames[newNames.length - 1] || newKey;
    if (!oldKey || !newKey) continue;
    db.prepare(`UPDATE io SET key=?, name=COALESCE(?,name), source=?, port_id=?, bus_id=?, board_profile_id=? WHERE device_id=? AND group_name=? AND key=?`).run(
      newKey,
      newName,
      nextEntity.source || nextEntity.port_id || nextEntity.bus_id || nextEntity.pin || null,
      nextEntity.port_id || null,
      nextEntity.bus_id || null,
      boardProfileId || null,
      deviceName,
      group,
      oldKey,
    );
    db.prepare(`UPDATE pending_io SET key=?, last_seen=? WHERE device_id=? AND group_name=? AND key=?`).run(newKey, now, deviceName, group, oldKey);
  }
}

function deleteIoRowsForPeripheral(db, deviceName, peripheral) {
  if (!db || !deviceName || !peripheral) return;
  const keys = keysForEntityType(peripheral.type, peripheral.key);
  const delPending = db.prepare(`DELETE FROM pending_io WHERE device_id=? AND key=?`);
  const delIO = db.prepare(`DELETE FROM io WHERE device_id=? AND key=?`);
  for (const key of keys) {
    delPending.run(deviceName, key);
    delIO.run(deviceName, key);
  }
}

function sendPeripheralLog(wsApi, clientId, level, text, action) {
  sendWs(wsApi, clientId, 'esphome_add_log', level, text);
  if (clientId && wsApi?.sendToClient) wsApi.sendToClient(clientId, { type: 'esphome_peripheral_log', level, text, action });
}

function deviceAllowsManagedEdit(device) {
  if (!device) return false;
  if (Number(device.read_only || 0) === 1) return false;
  return String(device.ownership_mode || 'managed_internal').trim().toLowerCase() !== 'external_readonly';
}

function sendPeripheralDone(wsApi, clientId, payload) {
  if (clientId && wsApi?.sendToClient) {
    wsApi.sendToClient(clientId, { type: 'esphome_add_done', ...payload });
    wsApi.sendToClient(clientId, { type: 'esphome_peripheral_done', ...payload });
  }
}

function runPeripheralFlash({ action, req, res, db, wsApi, dataDir, cfgDir, state, stmts, access, deviceId, ip, clientId, updatedYaml, originalYaml, originalYamlHash, boardProfileId, resultKey, successText, waitText, configMode, onSuccess }) {
  if (state.activeFlash) return res.status(409).json({ ok: false, error: 'flash_in_progress' });
  const bin = getEspHomeBin(dataDir);
  if (!bin) return res.status(503).json({ ok: false, error: 'esphome_not_installed' });
  const device = stmts.getDeviceById.get(deviceId);
  if (!ensureDeviceAccess(req, device, res, access)) return null;
  if (!deviceAllowsManagedEdit(device)) return res.status(409).json({ ok: false, error: 'device_is_read_only' });
  if (!device.yaml_path) return res.status(400).json({ ok: false, error: 'device_has_no_yaml_path' });
  if (!fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });

  fs.writeFileSync(device.yaml_path, updatedYaml, 'utf8');
  const now = new Date().toISOString();
  const updatedYamlHash = sha256(updatedYaml);
  db.prepare('UPDATE esphome_devices SET yaml_hash=?, status=?, updated_at=? WHERE id=?').run(updatedYamlHash, 'generated', now, deviceId);
  const logs = [];
  const appendLog = (level, text) => {
    logs.push(`[${level}] ${text}`);
    sendPeripheralLog(wsApi, clientId, level, text, action);
  };
  const rollback = () => {
    try {
      fs.writeFileSync(device.yaml_path, originalYaml, 'utf8');
      db.prepare('UPDATE esphome_devices SET yaml_hash=?, status=?, updated_at=? WHERE id=?').run(originalYamlHash, 'flashed', new Date().toISOString(), deviceId);
      appendLog('warn', '↩ YAML rolled back to previous version (flash failed).');
    } catch (rbErr) { appendLog('error', `Rollback failed: ${rbErr.message}`); }
  };
  let configId = null;
  try {
    const cfg = db.prepare('INSERT INTO esphome_generated_configs (esphome_device_id, config_mode, board_profile_id, yaml_text, yaml_hash, validation_json, generated_by) VALUES (?,?,?,?,?,?,?)').run(deviceId, configMode || action, boardProfileId, updatedYaml, sha256(updatedYaml), JSON.stringify({ ok: true }), action);
    configId = cfg.lastInsertRowid;
  } catch {}
  let jobId = null;
  try {
    const job = db.prepare('INSERT INTO esphome_install_jobs (esphome_device_id, config_id, job_type, target_ip, status, created_at) VALUES (?,?,?,?,?,?)').run(deviceId, configId, action, ip, 'queued', now);
    jobId = job.lastInsertRowid;
  } catch {}
  res.json({ ok: true, yaml: updatedYaml });

  const args = ['run', device.yaml_path, '--no-logs', '--device', ip];
  const proc = spawn(bin, args, { cwd: cfgDir });
  state.activeFlash = proc;
  if (jobId) updateJob(db, jobId, { status: 'running', started_at: now });
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('info', l)));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => appendLog('warn', l)));
  proc.on('close', code => {
    state.activeFlash = null;
    const ok = code === 0;
    if (!ok) rollback();
    else db.prepare('UPDATE esphome_devices SET status=?, updated_at=? WHERE id=?').run('flashed', new Date().toISOString(), deviceId);
    if (jobId) updateJob(db, jobId, { status: ok ? 'success' : 'failed', finished_at: new Date().toISOString(), exit_code: code, output_log: logs.join('\n'), error_text: ok ? null : logs.slice(-20).join('\n') });
    sendPeripheralDone(wsApi, clientId, { ok, code, awaiting_report: !!ok, entity_key: resultKey, action });
    appendLog(ok ? 'info' : 'error', ok ? successText : `✗ Flash failed (exit ${code})`);
    if (ok && waitText) appendLog('info', waitText);
  });
  proc.on('error', err => {
    state.activeFlash = null;
    rollback();
    if (jobId) updateJob(db, jobId, { status: 'failed', finished_at: new Date().toISOString(), error_text: err.message, output_log: logs.join('\n') });
    appendLog('error', `Cannot run esphome: ${err.message}`);
  });
  return true;
}

function mountPeripheralRoutes({ app, db, wsApi, dataDir, cfgDir, requireEngineerAccess, access, state, stmts }) {

  app.get('/api/esphome/device/:id/pin-options', requireEngineerAccess, (req, res) => {
    const deviceId = Number(req.params.id);
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    const profile = getCatalogProfile(db, device.board_profile_id);
    const yamlText = device.yaml_path && fs.existsSync(device.yaml_path) ? fs.readFileSync(device.yaml_path, 'utf8') : '';
    const usedPinMap = yamlText ? collectYamlPinUsage(yamlText) : new Map();
    const usedPins = [...usedPinMap.keys()];
    const runtime = deriveBoardPorts(profile || {});
    const sensorPorts = [];
    const seenPins = new Set();
    const rules = getProfilePinRules(profile);
    const peripherals = yamlText ? parseManagedPeripherals(yamlText) : [];
    const portUsageById = new Map();
    const busUsageById = new Map();
    const singleRuntimeBusId = runtime.buses.length === 1 ? String(runtime.buses[0].id || '').trim() : '';

    function pushPortUsage(portId, item) {
      const id = String(portId || '').trim();
      if (!id) return;
      if (!portUsageById.has(id)) portUsageById.set(id, []);
      portUsageById.get(id).push(item);
    }
    function pushBusUsage(busId, item) {
      const id = String(busId || '').trim();
      if (!id) return;
      if (!busUsageById.has(id)) busUsageById.set(id, []);
      busUsageById.get(id).push(item);
    }

    for (const item of peripherals) {
      let matchedPort = item.port_id ? findBoardPort(profile || {}, item.port_id) : null;
      if (!matchedPort && item.pin) {
        const pinLabel = String(item.pin || '').trim().toUpperCase();
        matchedPort = runtime.ports.find((port) => String(port.pin || '').trim().toUpperCase() === pinLabel) || null;
      }
      if (matchedPort) {
        pushPortUsage(matchedPort.id, {
          key: item.key || '',
          name: item.name || item.key || '',
          type: item.type || '',
          pin: item.pin || '',
        });
      }
      let matchedBus = item.bus_id ? findBoardBus(profile || {}, item.bus_id) : null;
      if (!matchedBus && item.bus_ref) matchedBus = findBoardBus(profile || {}, item.bus_ref) || null;
      if (!matchedBus && item.address && singleRuntimeBusId) matchedBus = runtime.buses[0];
      if (matchedBus) {
        pushBusUsage(matchedBus.id, {
          key: item.key || '',
          name: item.name || item.key || '',
          type: item.type || '',
          address: item.address || '',
        });
      }
    }

    for (const port of runtime.ports) {
      const pin = String(port.pin || '').trim().toUpperCase();
      const gpio = parseGpio(pin);
      const supports = Array.isArray(port.supports) ? port.supports : [];
      if (!pin || gpio === null || seenPins.has(pin)) continue;
      const usage = usedPinMap.get(pin);
      const usageItems = portUsageById.get(String(port.id || '').trim()) || [];
      const replaceablePeripheral = usageItems.length === 1 ? usageItems[0] : null;
      const replaceableTypes = replaceablePeripheral && String(replaceablePeripheral.type || '').toLowerCase() === 'di'
        ? ['ds18b20', 'dht11', 'dht']
        : [];
      sensorPorts.push({
        value: pin,
        portId: port.id,
        label: port.label || port.id || pin,
        group: port.group || null,
        protocols: port.protocols || [],
        hint: [port.hint || null, port.range ? `Range: ${port.range}` : null].filter(Boolean).join(' · ') || (port.label || pin),
        supports,
        inUse: !!usage,
        usageKinds: usage ? [...usage.kinds] : [],
        usageCount: usageItems.length,
        usedBy: usageItems.map((u) => [u.name || null, u.type ? `(${u.type})` : null].filter(Boolean).join(' ')),
        replaceable: !!replaceablePeripheral,
        replaceableTypes,
        replaceMode: replaceablePeripheral ? 'edit' : null,
        replaceTarget: replaceablePeripheral ? { key: replaceablePeripheral.key || '', name: replaceablePeripheral.name || '', type: replaceablePeripheral.type || '' } : null,
        noPullup: rules.noPullup.includes(gpio),
        inputOnly: rules.inputOnly.includes(gpio),
        generic: false,
        sharedBus: !!port.shared_bus,
        multiInstance: port.multi_instance !== false,
      });
      seenPins.add(pin);
    }

    if (!sensorPorts.length) {
      for (const gpio of getCandidatePins(profile)) {
        const pin = toGpioLabel(gpio);
        if (seenPins.has(pin)) continue;
        const supports = getPinCapabilities(profile, gpio);
        if (!supports.length) continue;
        const usage = usedPinMap.get(pin);
        sensorPorts.push({
          value: pin, label: pin,
          portId: null,
          group: 'gpio',
          protocols: ['gpio'],
          hint: [supports.includes('analog') ? 'ADC capable' : null, rules.inputOnly.includes(gpio) ? 'input-only' : null, rules.noPullup.includes(gpio) ? 'no internal pull-up' : null, rules.strapping.includes(gpio) ? 'strapping pin' : null].filter(Boolean).join(' · ') || 'Generic GPIO',
          supports, inUse: !!usage, usageKinds: usage ? [...usage.kinds] : [], usageCount: 0, usedBy: [], replaceable: false, replaceableTypes: [], replaceMode: null, replaceTarget: null, noPullup: rules.noPullup.includes(gpio), inputOnly: rules.inputOnly.includes(gpio), generic: true,
          sharedBus: false,
          multiInstance: false,
        });
      }
    }

    const busOptions = runtime.buses.map(bus => {
      const usageItems = busUsageById.get(String(bus.id || '').trim()) || [];
      const usedAddresses = [...new Set(usageItems.map((u) => String(u.address || '').trim().toLowerCase()).filter(Boolean))];
      return {
        id: bus.id,
        label: bus.label || bus.id,
        protocol: bus.protocol,
        supports: bus.supports || [],
        sda: bus.sda || null,
        scl: bus.scl || null,
        tx: bus.tx || null,
        rx: bus.rx || null,
        addresses: bus.addresses || [],
        usedAddresses,
        usageCount: usageItems.length,
        usedBy: usageItems.map((u) => [u.name || null, u.address ? '@ ' + u.address : null].filter(Boolean).join(' ')),
        hint: bus.hint || '',
        sharedBus: bus.shared_bus !== false,
      };
    });

    const defaultI2c = getDefaultI2cBus(profile);
    res.json({
      ok: true,
      boardLabel: profile?.label || device.board_profile_id,
      sensorPorts,
      boardPorts: sensorPorts,
      busOptions,
      portGroups: runtime.portGroups || [],
      boardAware: !!(runtime.ports.length || runtime.buses.length),
      usedPins,
      reservedPins: rules.reserved,
      flashPins: rules.flashPins,
      inputOnlyPins: rules.inputOnly,
      noPullupPins: rules.noPullup,
      strappingPins: rules.strapping,
      defaultI2c,
    });
  });

  app.get('/api/esphome/device/:id/peripherals', requireEngineerAccess, (req, res) => {
    const deviceId = Number(req.params.id);
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if (!device.yaml_path || !fs.existsSync(device.yaml_path)) return res.json({ ok: true, peripherals: [] });
    const yamlText = fs.readFileSync(device.yaml_path, 'utf8');
    const peripherals = parseManagedPeripherals(yamlText);
    res.json({ ok: true, peripherals });
  });

  app.post('/api/esphome/add-peripheral', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const ip = String(body.ip || '').trim();
    const clientId = String(body.client_id || '').trim() || null;
    const rawEntity = body.entity || {};
    if (!deviceId) return res.status(400).json({ ok: false, error: 'device_id required' });
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    const clean = sanitizeEntityInput(rawEntity);
    const basicError = validateRawEntityBasics(clean);
    if (basicError) return res.status(400).json({ ok: false, error: basicError });
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if ((!device.yaml_path || !fs.existsSync(device.yaml_path)) && body.yaml_content) {
      const newYamlPath = path.join(cfgDir, safeName(device.name || device.friendly_name || 'device') + '.yaml');
      try {
        fs.writeFileSync(newYamlPath, String(body.yaml_content), 'utf8');
        db.prepare('UPDATE esphome_devices SET yaml_path=? WHERE id=?').run(newYamlPath, deviceId);
        device.yaml_path = newYamlPath;
      } catch (e) { return res.status(500).json({ ok: false, error: 'failed_to_save_yaml: ' + e.message }); }
    }
    if (!device.yaml_path) return res.status(400).json({ ok: false, error: 'device_has_no_yaml_path' });
    if (!fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });
    const profile = getCatalogProfile(db, device.board_profile_id);
    const existingYamlForCheck = fs.readFileSync(device.yaml_path, 'utf8');
    if (hasYamlId(existingYamlForCheck, clean.eKey) || ((clean.eType === 'dht' || clean.eType === 'dht11' || clean.eType === 'sht3x') && hasYamlId(existingYamlForCheck, `${clean.eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${clean.eKey}" already exists in this device's YAML` });
    const resolvedSelection = resolvePeripheralSelection(profile, rawEntity);
    if (!resolvedSelection.ok) return res.status(400).json({ ok: false, error: resolvedSelection.error || 'invalid_board_port' });
    const resolvedEntity = resolvedSelection.resolved || rawEntity;
    const finalPin = resolvedEntity.pin || clean.ePin;
    const finalSda = resolvedEntity.sda || clean.eSdaRaw;
    const finalScl = resolvedEntity.scl || clean.eSclRaw;
    const finalAddress = resolvedEntity.address || clean.eAddress;
    if (clean.isI2c && (!finalSda || !finalScl || !finalAddress)) return res.status(400).json({ ok: false, error: 'i2c_fields_required' });
    if (!clean.isI2c && !finalPin) return res.status(400).json({ ok: false, error: 'entity pin required' });
    const validation = validatePeripheralEntity({ profile, yamlText: existingYamlForCheck, entity: clean.isI2c ? { type: clean.eType, sda: finalSda, scl: finalScl, address: finalAddress, allow_reserved_profile_bus: !!resolvedEntity.allow_reserved_profile_bus } : { type: clean.eType, pin: finalPin, allow_reserved_profile_port: !!resolvedEntity.allow_reserved_profile_port } });
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });
    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');
    let updatedYaml;
    try {
      updatedYaml = addPeripheralToYaml(existingYamlForCheck, deviceSafeName, {
        type: clean.eType, name: clean.eName, key: clean.eKey, pin: validation.pin || finalPin, sda: validation.sda || finalSda, scl: validation.scl || finalScl, address: validation.address || finalAddress, pin_mode: validation.pinMode, scale: clean.eScale, scale_factor: clean.eScaleFactor,
      }, { deviceName: device.friendly_name || device.name || deviceSafeName, boardLabel: profile?.label || device.board_profile_id, boardProfileId: device.board_profile_id });
    } catch (e) { return res.status(500).json({ ok: false, error: 'yaml_merge_failed: ' + String(e?.message || e) }); }
    return runPeripheralFlash({
      action: 'add_peripheral', req, res, db, wsApi, dataDir, cfgDir, state, stmts, access,
      deviceId, ip, clientId, updatedYaml, originalYaml: existingYamlForCheck, originalYamlHash: device.yaml_hash || null,
      boardProfileId: device.board_profile_id, resultKey: clean.eKey,
      successText: `✓ Flash complete — "${clean.eName}" added to "${device.friendly_name || device.name}"`,
      waitText: `Waiting for the device to reconnect and publish MQTT config/state so ELARIS can auto-register pending IO "${clean.eKey}".`,
      configMode: 'add_peripheral',
    });
  });

  app.post('/api/esphome/add-peripheral/preview', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const rawEntity = body.entity || {};
    const clean = sanitizeEntityInput(rawEntity);
    const basicError = validateRawEntityBasics(clean);
    if (!deviceId) return res.status(400).json({ ok: false, error: 'missing required fields' });
    if (basicError) return res.status(400).json({ ok: false, error: basicError });
    if (!db) return res.status(500).json({ ok: false, error: 'database_unavailable' });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if ((!device.yaml_path || !fs.existsSync(device.yaml_path)) && body.yaml_content) {
      const newYamlPath = path.join(cfgDir, safeName(device.name || device.friendly_name || 'device') + '.yaml');
      try {
        fs.writeFileSync(newYamlPath, String(body.yaml_content), 'utf8');
        db.prepare('UPDATE esphome_devices SET yaml_path=? WHERE id=?').run(newYamlPath, deviceId);
        device.yaml_path = newYamlPath;
      } catch (e) { return res.status(500).json({ ok: false, error: 'failed_to_save_yaml: ' + e.message }); }
    }
    if (!device.yaml_path || !fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });
    const existingYaml = fs.readFileSync(device.yaml_path, 'utf8');
    if (hasYamlId(existingYaml, clean.eKey) || ((clean.eType === 'dht' || clean.eType === 'dht11' || clean.eType === 'sht3x') && hasYamlId(existingYaml, `${clean.eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${clean.eKey}" already exists` });
    const profile = getCatalogProfile(db, device.board_profile_id);
    const resolvedSelection = resolvePeripheralSelection(profile, rawEntity);
    if (!resolvedSelection.ok) return res.status(400).json({ ok: false, error: resolvedSelection.error || 'invalid_board_port' });
    const resolvedEntity = resolvedSelection.resolved || rawEntity;
    const finalPin = resolvedEntity.pin || clean.ePin;
    const finalSda = resolvedEntity.sda || clean.eSdaRaw;
    const finalScl = resolvedEntity.scl || clean.eSclRaw;
    const finalAddress = resolvedEntity.address || clean.eAddress;
    if (clean.isI2c && (!finalSda || !finalScl || !finalAddress)) return res.status(400).json({ ok: false, error: 'i2c_fields_required' });
    if (!clean.isI2c && !finalPin) return res.status(400).json({ ok: false, error: 'entity pin required' });
    const validation = validatePeripheralEntity({ profile, yamlText: existingYaml, entity: clean.isI2c ? { type: clean.eType, sda: finalSda, scl: finalScl, address: finalAddress, allow_reserved_profile_bus: !!resolvedEntity.allow_reserved_profile_bus } : { type: clean.eType, pin: finalPin, allow_reserved_profile_port: !!resolvedEntity.allow_reserved_profile_port } });
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });
    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');
    try {
      const updatedYaml = addPeripheralToYaml(existingYaml, deviceSafeName, {
        type: clean.eType, name: clean.eName, key: clean.eKey, pin: validation.pin || finalPin, sda: validation.sda || finalSda, scl: validation.scl || finalScl, address: validation.address || finalAddress, pin_mode: validation.pinMode, scale: clean.eScale, scale_factor: clean.eScaleFactor,
      }, { deviceName: device.friendly_name || device.name || deviceSafeName, boardLabel: profile?.label || device.board_profile_id, boardProfileId: device.board_profile_id });
      res.json({ ok: true, yaml: updatedYaml, warnings: validation.warnings || [] });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.post('/api/esphome/peripheral/edit/preview', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const originalKey = String(body.original_key || '').trim();
    const rawEntity = body.entity || {};
    const clean = sanitizeEntityInput(rawEntity);
    if (!deviceId || !originalKey) return res.status(400).json({ ok: false, error: 'missing required fields' });
    const basicError = validateRawEntityBasics(clean);
    if (basicError) return res.status(400).json({ ok: false, error: basicError });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if (!device?.yaml_path || !fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });
    const existingYaml = fs.readFileSync(device.yaml_path, 'utf8');
    const existingPeripherals = parseManagedPeripherals(existingYaml);
    const current = existingPeripherals.find((p) => String(p.key) === originalKey);
    if (!current) return res.status(404).json({ ok: false, error: 'peripheral_not_found' });
    const baseYaml = removeManagedPeripheralFromYaml(existingYaml, originalKey, { deviceName: device.friendly_name || device.name || safeName(device.name), boardLabel: device.board_profile_id, boardProfileId: device.board_profile_id }).yaml;
    if (hasYamlId(baseYaml, clean.eKey) || ((clean.eType === 'dht' || clean.eType === 'dht11' || clean.eType === 'sht3x') && hasYamlId(baseYaml, `${clean.eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${clean.eKey}" already exists` });
    const profile = getCatalogProfile(db, device.board_profile_id);
    const resolvedSelection = resolvePeripheralSelection(profile, rawEntity);
    if (!resolvedSelection.ok) return res.status(400).json({ ok: false, error: resolvedSelection.error || 'invalid_board_port' });
    const resolvedEntity = resolvedSelection.resolved || rawEntity;
    const finalPin = resolvedEntity.pin || clean.ePin;
    const finalSda = resolvedEntity.sda || clean.eSdaRaw;
    const finalScl = resolvedEntity.scl || clean.eSclRaw;
    const finalAddress = resolvedEntity.address || clean.eAddress;
    const validation = validatePeripheralEntity({ profile, yamlText: baseYaml, entity: clean.isI2c ? { type: clean.eType, sda: finalSda, scl: finalScl, address: finalAddress, allow_reserved_profile_bus: !!resolvedEntity.allow_reserved_profile_bus } : { type: clean.eType, pin: finalPin, allow_reserved_profile_port: !!resolvedEntity.allow_reserved_profile_port } });
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });
    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');
    try {
      const updated = updateManagedPeripheralInYaml(existingYaml, originalKey, { type: clean.eType, name: clean.eName, key: clean.eKey, pin: validation.pin || finalPin, sda: validation.sda || finalSda, scl: validation.scl || finalScl, address: validation.address || finalAddress, pin_mode: validation.pinMode, scale: clean.eScale, scale_factor: clean.eScaleFactor }, { deviceSafeName, deviceName: device.friendly_name || device.name || deviceSafeName, boardLabel: profile?.label || device.board_profile_id, boardProfileId: device.board_profile_id });
      res.json({ ok: true, yaml: updated.yaml, warnings: validation.warnings || [], previous: current });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.post('/api/esphome/peripheral/edit', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const ip = String(body.ip || '').trim();
    const clientId = String(body.client_id || '').trim() || null;
    const originalKey = String(body.original_key || '').trim();
    const rawEntity = body.entity || {};
    if (!deviceId) return res.status(400).json({ ok: false, error: 'device_id required' });
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    if (!originalKey) return res.status(400).json({ ok: false, error: 'original_key required' });
    const clean = sanitizeEntityInput(rawEntity);
    const basicError = validateRawEntityBasics(clean);
    if (basicError) return res.status(400).json({ ok: false, error: basicError });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if (!device?.yaml_path || !fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });
    const existingYaml = fs.readFileSync(device.yaml_path, 'utf8');
    const current = parseManagedPeripherals(existingYaml).find((p) => String(p.key) === originalKey);
    if (!current) return res.status(404).json({ ok: false, error: 'peripheral_not_found' });
    const baseYaml = removeManagedPeripheralFromYaml(existingYaml, originalKey, { deviceName: device.friendly_name || device.name || safeName(device.name), boardLabel: device.board_profile_id, boardProfileId: device.board_profile_id }).yaml;
    if (hasYamlId(baseYaml, clean.eKey) || ((clean.eType === 'dht' || clean.eType === 'dht11' || clean.eType === 'sht3x') && hasYamlId(baseYaml, `${clean.eKey}_hum`)))
      return res.status(400).json({ ok: false, error: `duplicate_key — "${clean.eKey}" already exists` });
    const profile = getCatalogProfile(db, device.board_profile_id);
    const resolvedSelection = resolvePeripheralSelection(profile, rawEntity);
    if (!resolvedSelection.ok) return res.status(400).json({ ok: false, error: resolvedSelection.error || 'invalid_board_port' });
    const resolvedEntity = resolvedSelection.resolved || rawEntity;
    const finalPin = resolvedEntity.pin || clean.ePin;
    const finalSda = resolvedEntity.sda || clean.eSdaRaw;
    const finalScl = resolvedEntity.scl || clean.eSclRaw;
    const finalAddress = resolvedEntity.address || clean.eAddress;
    const validation = validatePeripheralEntity({ profile, yamlText: baseYaml, entity: clean.isI2c ? { type: clean.eType, sda: finalSda, scl: finalScl, address: finalAddress, allow_reserved_profile_bus: !!resolvedEntity.allow_reserved_profile_bus } : { type: clean.eType, pin: finalPin, allow_reserved_profile_port: !!resolvedEntity.allow_reserved_profile_port } });
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.errors.join(' · '), warnings: validation.warnings || [] });
    const deviceSafeName = device.name || safeName(device.friendly_name || 'device');
    let updated;
    try {
      updated = updateManagedPeripheralInYaml(existingYaml, originalKey, { type: clean.eType, name: clean.eName, key: clean.eKey, pin: validation.pin || finalPin, sda: validation.sda || finalSda, scl: validation.scl || finalScl, address: validation.address || finalAddress, pin_mode: validation.pinMode, scale: clean.eScale, scale_factor: clean.eScaleFactor, source: clean.isI2c ? (resolvedEntity.bus_id || null) : (resolvedEntity.port_id || validation.pin || finalPin), port_id: resolvedEntity.port_id || null, bus_id: resolvedEntity.bus_id || null }, { deviceSafeName, deviceName: device.friendly_name || device.name || deviceSafeName, boardLabel: profile?.label || device.board_profile_id, boardProfileId: device.board_profile_id });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    const nextEntityMeta = { source: clean.isI2c ? (resolvedEntity.bus_id || null) : (resolvedEntity.port_id || validation.pin || finalPin), port_id: resolvedEntity.port_id || null, bus_id: resolvedEntity.bus_id || null, type: clean.eType, key: clean.eKey };
    return runPeripheralFlash({
      action: 'edit_peripheral', req, res, db, wsApi, dataDir, cfgDir, state, stmts, access,
      deviceId, ip, clientId, updatedYaml: updated.yaml, originalYaml: existingYaml, originalYamlHash: device.yaml_hash || null,
      boardProfileId: device.board_profile_id, resultKey: clean.eKey,
      successText: `✓ Flash complete — peripheral "${clean.eName}" updated on "${device.friendly_name || device.name}"`,
      waitText: `Waiting for the device to reconnect and publish MQTT config/state so ELARIS can refresh IO "${clean.eKey}".`,
      configMode: 'edit_peripheral',
      onSuccess: () => syncIoRowsForPeripheral(db, device.name, current, nextEntityMeta, device.board_profile_id),
    });
  });

  app.post('/api/esphome/peripheral/remove', requireEngineerAccess, (req, res) => {
    const body = req.body || {};
    const deviceId = Number(body.device_id);
    const ip = String(body.ip || '').trim();
    const clientId = String(body.client_id || '').trim() || null;
    const key = String(body.key || '').trim();
    if (!deviceId) return res.status(400).json({ ok: false, error: 'device_id required' });
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    if (!key) return res.status(400).json({ ok: false, error: 'key required' });
    const device = stmts.getDeviceById.get(deviceId);
    if (!ensureDeviceAccess(req, device, res, access)) return;
    if (!device?.yaml_path || !fs.existsSync(device.yaml_path)) return res.status(400).json({ ok: false, error: 'yaml_file_not_found' });
    const existingYaml = fs.readFileSync(device.yaml_path, 'utf8');
    let removed;
    try {
      removed = removeManagedPeripheralFromYaml(existingYaml, key, { deviceName: device.friendly_name || device.name || safeName(device.name), boardLabel: device.board_profile_id, boardProfileId: device.board_profile_id });
    } catch (e) {
      return res.status(404).json({ ok: false, error: String(e?.message || e) });
    }
    return runPeripheralFlash({
      action: 'remove_peripheral', req, res, db, wsApi, dataDir, cfgDir, state, stmts, access,
      deviceId, ip, clientId, updatedYaml: removed.yaml, originalYaml: existingYaml, originalYamlHash: device.yaml_hash || null,
      boardProfileId: device.board_profile_id, resultKey: removed.removed.key,
      successText: `✓ Flash complete — peripheral "${removed.removed.name}" removed from "${device.friendly_name || device.name}"`,
      waitText: `Waiting for the device to reconnect and publish MQTT config/state so ELARIS can settle after removing "${removed.removed.key}".`,
      configMode: 'remove_peripheral',
      onSuccess: () => deleteIoRowsForPeripheral(db, device.name, removed.removed),
    });
  });
}

module.exports = { mountPeripheralRoutes };
