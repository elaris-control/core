'use strict';
// src/api/esphome/flash_routes.js — setup, flash, flash-from-yaml

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
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

function buildManagedConfigJson({ deviceName, boardProfileId, boardLabel, entitiesMap }) {
  const hostname = safeName(deviceName || 'device');
  const list = (Array.isArray(entitiesMap) ? entitiesMap : [])
    .filter((e) => e && e.key)
    .map((e) => ({
      key: String(e.key),
      group: String(e.group || (['relay', 'analog_out', 'ao', 'dimmer'].includes(String(e.type || '').toLowerCase()) ? 'state' : 'tele')),
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

function injectManagedOverlay(yamlText, { deviceName, mqttHost, configJson, canonicalEntities }) {
  let out = String(yamlText || '');
  const deviceSafe = safeName(deviceName || 'device');

  // Canonical key map: build from passed canonicalEntities (yaml_id → key)
  const keyMap = {};
  if (Array.isArray(canonicalEntities)) {
    for (const e of canonicalEntities) {
      if (e.key) {
        const yamlId = e.yaml_id || e.name || e.key;
        keyMap[yamlId] = e.key;
      }
    }
  }

  // ── 1. Parse YAML to extract ALL entitiesMap ───────────────────────────────
  let doc;
  try { doc = yaml.load(out); } catch { return out; }
  if (!doc || typeof doc !== 'object') return out;

  // Generic entity extraction — scans ALL top-level arrays for entitiesMap with id/name
  const entitiesMap = {
    switches: [],       // turn_on/turn_off
    binarySensors: [],  // on_state
    sensors: [],        // on_value
    textSensors: [],    // on_value
    outputs: [],        // set_level
    lights: [],         // turn_on/turn_off/toggle
    fans: [],           // turn_on/turn_off/speed
    climates: [],       // set temperature/mode
    buttons: [],        // press
    numbers: [],        // set value
    covers: [],         // open/close/stop
    selects: [],        // set option
  };

  // Helper: extract entitiesMap from a top-level section
  function extractEntities(section, type, idField = 'id', nameField = 'name') {
    const items = toArray(doc[section] || []);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      // Skip internal/template-only entitiesMap
      if (item.internal === true) continue;
      // Skip status/platform-specific entitiesMap that don't need wiring
      if (item.platform === 'status' || item.platform === 'wifi_signal' ||
          item.platform === 'uptime' || item.platform === 'template' && item.lambda) continue;
      const id = item[idField] ? String(item[idField]) : (item[nameField] ? safeName(item[nameField]) : null);
      if (!id) continue;
      entitiesMap[type].push({ id, name: item[nameField] || id, raw: item, platform: item.platform });
    }
  }

  extractEntities('switch', 'switches');
  extractEntities('binary_sensor', 'binarySensors');
  extractEntities('sensor', 'sensors');
  extractEntities('text_sensor', 'textSensors');
  extractEntities('output', 'outputs');
  extractEntities('light', 'lights');
  extractEntities('fan', 'fans');
  extractEntities('climate', 'climates');
  extractEntities('button', 'buttons');
  extractEntities('number', 'numbers');
  extractEntities('cover', 'covers');
  extractEntities('select', 'selects');

  // Helper: get MQTT topic key (canonical key if available, otherwise YAML id)
  function getMqttKey(entity) {
    return keyMap[entity.id] || keyMap[entity.name] || entity.id;
  }

  // ── 2. Inject state publishing into each entity block ───────────────────
  const stateWiring = {
    switches: {
      hook: 'on_turn_on',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_turn_on:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "ON"`,
          `          retain: true`,
          `    on_turn_off:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "OFF"`,
          `          retain: true`,
        ].join('\n');
      },
    },
    binarySensors: {
      hook: 'on_state',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_state:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/tele/${mqttKey}"`,
          `          payload: !lambda |-`,
          `            return x ? "ON" : "OFF";`,
        ].join('\n');
      },
    },
    sensors: {
      hook: 'on_value',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_value:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/tele/${mqttKey}"`,
          `          payload: !lambda |-`,
          `            return str_sprintf("%.1f", x);`,
        ].join('\n');
      },
    },
    textSensors: {
      hook: 'on_value',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_value:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/tele/${mqttKey}"`,
          `          payload: !lambda "return x;"`,
        ].join('\n');
      },
    },
    lights: {
      hook: 'on_turn_on',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_turn_on:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "ON"`,
          `          retain: true`,
          `    on_turn_off:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "OFF"`,
          `          retain: true`,
        ].join('\n');
      },
    },
    fans: {
      hook: 'on_turn_on',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_turn_on:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "ON"`,
          `          retain: true`,
          `    on_turn_off:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "OFF"`,
          `          retain: true`,
        ].join('\n');
      },
    },
    climates: {
      hook: 'on_state',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_state:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/tele/${mqttKey}"`,
          `          payload: !lambda "return x;"`,
        ].join('\n');
      },
    },
    buttons: {
      hook: null,
      wiring: null,
    },
    numbers: {
      hook: 'on_value',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_value:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: !lambda "return str_sprintf(\"%.1f\", x);"`,
        ].join('\n');
      },
    },
    covers: {
      hook: 'on_open',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_open:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "OPEN"`,
          `          retain: true`,
          `    on_closed:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: "CLOSED"`,
          `          retain: true`,
        ].join('\n');
      },
    },
    selects: {
      hook: 'on_value',
      wiring: (entity) => {
        const mqttKey = getMqttKey(entity);
        return [
          `    on_value:`,
          `      - mqtt.publish:`,
          `          topic: "elaris/${deviceSafe}/state/${mqttKey}"`,
          `          payload: !lambda "return x;"`,
        ].join('\n');
      },
    },
  };

  for (const [type, config] of Object.entries(stateWiring)) {
    if (!config.hook || !entitiesMap[type]?.length) continue;
    for (const entity of entitiesMap[type]) {
      if (entity.raw[config.hook]) continue;
      const wiring = config.wiring(entity);
      const sectionName = type === 'switches' ? 'switch' :
                          type === 'binarySensors' ? 'binary_sensor' :
                          type === 'textSensors' ? 'text_sensor' : type;
      out = injectEntityWiring(out, entity, sectionName, wiring);
    }
  }

  // ── 3. Build on_message command handlers ────────────────────────────────
  const onMessageHandlers = [];

  for (const sw of entitiesMap.switches) {
    const mqttKey = getMqttKey(sw);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - lambda: |-`,
      `            if (x == "ON") id(${sw.id}).turn_on();`,
      `            else id(${sw.id}).turn_off();`,
    ].join('\n'));
  }

  for (const o of entitiesMap.outputs) {
    const mqttKey = getMqttKey(o);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - output.set_level:`,
      `            id: ${o.id}`,
      `            level: !lambda "return atof(x.c_str()) / 100.0;"`,
    ].join('\n'));
  }

  for (const l of entitiesMap.lights) {
    const mqttKey = getMqttKey(l);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - lambda: |-`,
      `            if (x == "ON") id(${l.id}).turn_on();`,
      `            else if (x == "OFF") id(${l.id}).turn_off();`,
      `            else if (x == "TOGGLE") id(${l.id}).toggle();`,
    ].join('\n'));
  }

  for (const f of entitiesMap.fans) {
    const mqttKey = getMqttKey(f);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - lambda: |-`,
      `            if (x == "ON") id(${f.id}).turn_on();`,
      `            else id(${f.id}).turn_off();`,
    ].join('\n'));
  }

  for (const b of entitiesMap.buttons) {
    const mqttKey = getMqttKey(b);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - button.press: ${b.id}`,
    ].join('\n'));
  }

  for (const n of entitiesMap.numbers) {
    const mqttKey = getMqttKey(n);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - number.set:`,
      `            id: ${n.id}`,
      `            value: !lambda "return atof(x.c_str());"`,
    ].join('\n'));
  }

  for (const c of entitiesMap.covers) {
    const mqttKey = getMqttKey(c);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - lambda: |-`,
      `            if (x == "OPEN") id(${c.id}).open();`,
      `            else if (x == "CLOSE") id(${c.id}).close();`,
      `            else if (x == "STOP") id(${c.id}).stop();`,
    ].join('\n'));
  }

  for (const s of entitiesMap.selects) {
    const mqttKey = getMqttKey(s);
    onMessageHandlers.push([
      `    - topic: "elaris/${deviceSafe}/cmnd/${mqttKey}"`,
      `      then:`,
      `        - select.set:`,
      `            id: ${s.id}`,
      `            option: !lambda "return x;"`,
    ].join('\n'));
  }

  // ── 4. Build/merge mqtt: block ──────────────────────────────────────────
  const hasMqtt = yamlHasTopLevelBlock(out, 'mqtt');
  if (!hasMqtt) {
    let mqttSection = [
      `mqtt:`,
      `  broker: ${mqttHost}`,
      `  topic_prefix: ${deviceSafe}`,
    ].join('\n');
    if (onMessageHandlers.length > 0) {
      mqttSection += '\n  on_message:\n' + onMessageHandlers.join('\n\n');
    }
    out = out.trimEnd() + '\n\n' + mqttSection + '\n';
  } else {
    // Ensure topic_prefix
    if (!/\btopic_prefix\s*:/.test(out)) {
      out = out.replace(/^mqtt:\s*$/m, `mqtt:\n  topic_prefix: ${deviceSafe}`);
    }
    // Append on_message if not already present
    if (onMessageHandlers.length > 0 && !out.includes(`elaris/${deviceSafe}/cmnd/`)) {
      const onMsgSection = `\n  on_message:\n${onMessageHandlers.join('\n\n')}`;
      out = out.replace(/^mqtt:\s*$/m, `mqtt:${onMsgSection}`);
    }
  }

  // ── 5. Config payload on boot ───────────────────────────────────────────
  if (configJson) {
    const configPayload = String(configJson).replace(/'/g, "''");
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
    }
  }

  return out;
}

function injectEntityWiring(yamlText, entity, sectionName, wiring) {
  // Try to find by id: first
  const idLineRx = new RegExp(`^(\\s+)id:\\s*${escapeRegex(entity.id)}\\s*$`, 'm');
  const idMatch = yamlText.match(idLineRx);
  if (idMatch) {
    const indent = idMatch[1].length;
    const idPos = idMatch.index + idMatch[0].length;
    const rest = yamlText.slice(idPos);
    const endRx = new RegExp(`\\n(?=\\s{0,${indent}}-\\s+platform:|\\S)`, 'm');
    const endMatch = rest.match(endRx);
    const insertPos = idPos + (endMatch ? endMatch.index : rest.length);
    return yamlText.slice(0, insertPos) + '\n' + wiring + yamlText.slice(insertPos);
  }

  // Fallback: find by name: (when entity has no id: in YAML)
  const nameRx = new RegExp(`^(\\s+)name:\\s*["']${escapeRegex(entity.name)}["']\\s*$`, 'm');
  const nameMatch = yamlText.match(nameRx);
  if (nameMatch) {
    const indent = nameMatch[1].length;
    const namePos = nameMatch.index + nameMatch[0].length;
    const rest = yamlText.slice(namePos);
    const endRx = new RegExp(`\\n(?=\\s{0,${indent}}-\\s+platform:|\\S)`, 'm');
    const endMatch = rest.match(endRx);
    const insertPos = namePos + (endMatch ? endMatch.index : rest.length);
    return yamlText.slice(0, insertPos) + '\n' + wiring + yamlText.slice(insertPos);
  }

  return yamlText;
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function seedPendingFromManagedEntities(dbApi, deviceId, boardProfileId, entitiesMap) {
  if (!dbApi || !deviceId || !Array.isArray(entitiesMap) || !entitiesMap.length) return;
  if (typeof dbApi.noteDeviceConfig !== 'function') return;

  dbApi.noteDeviceConfig({
    deviceId: String(deviceId).trim(),
    ts: Date.now(),
    retained: false,
    config: {
      board_profile_id: boardProfileId || null,
      entities: entitiesMap.map((e) => ({
        key: e.key,
        group: e.group || (['relay', 'analog_out', 'ao', 'dimmer'].includes(String(e.type || '').toLowerCase()) ? 'state' : 'tele'),
        type: e.type,
        name: e.name || e.key,
        yaml_id: e.yaml_id || null,
        source: e.source || e.port_id || e.bus_id || null,
        port_id: e.port_id || null,
        bus_id: e.bus_id || null,
      })),
    },
  });
}

function mountFlashRoutes({ app, db, dbApi, wsApi, dataDir, cfgDir, venvDir, requireEngineerAccess, state }) {

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
      if (ok) {
        seedPendingFromManagedEntities(
          dbApi,
          payload.device_name,
          profile?.id || payload.board_profile_id || null,
          Array.isArray(payload.entitiesMap) ? payload.entitiesMap : []
        );
      }
      if (clientId && wsApi.sendToClient) wsApi.sendToClient(clientId, { type: 'esphome_done', ok, code });
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${payload.device_name}" seeded into Installer` : `✗ Flash failed (exit ${code})`);
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
    // Detect !secret tags — they require a secrets.yaml file that ESPHome
    // won't have in our build context. Reject early with a helpful message
    // instead of silently corrupting the YAML with random values.
    const secretMatches = finalYaml.match(/!secret\s+(\S+)/g);
    if (secretMatches && secretMatches.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'yaml_contains_secrets',
        details: `The following !secret references were found: ${secretMatches.join(', ')}. Replace them with literal values before flashing — ESPHome needs a secrets.yaml file that is not available in this environment.`,
      });
    }
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
      yaml_id: e.yaml_id || null,
      group: e.group || (['relay', 'analog_out', 'ao', 'dimmer'].includes(String(e.type || '').toLowerCase()) ? 'state' : 'tele'),
      type: e.type,
      name: e.name || e.key,
      source: e.source || null,
      port_id: e.port_id || null,
      bus_id: e.bus_id || null,
      pin: e.pin || null,
    })) : [];
    if (mqtt_host) {
      const configJson = buildManagedConfigJson({
        deviceName: device_id,
        boardProfileId: resolvedProfile.id,
        boardLabel: resolvedProfile.label || device_name,
        entitiesMap: managedEntities,
      });
      finalYaml = injectManagedOverlay(finalYaml, { deviceName: device_id, mqttHost: mqtt_host, configJson, canonicalEntities: managedEntities });
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
      entitiesMap: managedEntities,
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
      if (ok) {
        seedPendingFromManagedEntities(
          dbApi,
          device_id,
          resolvedProfile?.id || payload.board_profile_id || null,
          managedEntities
        );
      }
      if (client_id && wsApi.sendToClient) wsApi.sendToClient(client_id, { type: 'esphome_done', ok, code });
      appendLog(ok ? 'info' : 'error', ok ? `✓ Flash complete — "${device_name}" seeded into Installer` : `✗ Flash failed (exit ${code})`);
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
