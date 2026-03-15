const { safeName } = require('./schema');

// Escape a string for use inside YAML double-quoted scalars
function yamlStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function mqttDiscoveryJson({ deviceName, boardLabel, boardProfileId, entities }) {
  const entityList = (Array.isArray(entities) ? entities : []).flatMap((e) => {
    const type = String(e.type || '').toLowerCase();
    const group = e.group || (type === 'relay' || type === 'switch' ? 'state' : 'tele');
    if (type === 'dht' || type === 'dht11') {
      return [
        {
          key: e.key,
          group: 'tele',
          type: 'sensor',
          name: `${e.name} Temperature`,
          unit: '°C',
          device_class: 'temperature',
        },
        {
          key: `${e.key}_hum`,
          group: 'tele',
          type: 'sensor',
          name: `${e.name} Humidity`,
          unit: '%',
          device_class: 'humidity',
        },
      ];
    }
    if (type === 'relay' || type === 'switch') {
      return [{ key: e.key, group: 'state', type: 'relay', name: e.name }];
    }
    if (type === 'di') {
      return [{ key: e.key, group: group, type: 'sensor', name: e.name }];
    }
    if (type === 'ds18b20') {
      return [{ key: e.key, group: 'tele', type: 'sensor', name: e.name, unit: '°C', device_class: 'temperature' }];
    }
    if (type === 'analog') {
      return [{ key: e.key, group: 'tele', type: 'sensor', name: e.name }];
    }
    if (type === 'pulse_counter') {
      let unit = 'pulses/min';
      if (e.scale === 'yfs201') unit = 'L/min';
      else if (e.scale === 'anemometer') unit = 'Hz';
      else if (e.scale === 'custom' && e.scale_unit) unit = e.scale_unit;
      return [{ key: e.key, group: 'tele', type: 'sensor', name: e.name, unit }];
    }
    return [{ key: e.key, group, type: type === 'sensor' ? 'sensor' : 'sensor', name: e.name }];
  });

  const counts = entityList.reduce((acc, e) => {
    const t = String(e.type || '').toLowerCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return JSON.stringify({
    device: {
      name: deviceName,
      hostname: safeName(deviceName),
      model: boardLabel || 'ELARIS Board',
      board_profile_id: boardProfileId || null,
      sw: '1.0.0',
    },
    capabilities: counts,
    entities: entityList,
  });
}

function peripheralDiscoveryEntities(entity) {
  const type = String(entity?.type || '').toLowerCase();
  if (!entity || !entity.key) return [];
  if (type === 'dht' || type === 'dht11') {
    return [
      {
        key: entity.key,
        group: 'tele',
        type: 'sensor',
        name: `${entity.name} Temperature`,
        unit: '°C',
        device_class: 'temperature',
      },
      {
        key: `${entity.key}_hum`,
        group: 'tele',
        type: 'sensor',
        name: `${entity.name} Humidity`,
        unit: '%',
        device_class: 'humidity',
      },
    ];
  }
  if (type === 'ds18b20') {
    return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit: '°C', device_class: 'temperature' }];
  }
  if (type === 'analog') {
    return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
  }
  if (type === 'pulse_counter') {
    let unit = 'pulses/min';
    if (entity.scale === 'yfs201') unit = 'L/min';
    else if (entity.scale === 'anemometer') unit = 'Hz';
    else if (entity.scale === 'custom' && entity.scale_unit) unit = entity.scale_unit;
    return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit }];
  }
  return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
}

function _findOneWireBlock(yamlText, pin) {
  const lines = String(yamlText || '').split(/\r?\n/);
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSection) {
      if (/^one_wire:\s*$/i.test(line)) inSection = true;
      continue;
    }
    if (/^[^\s#][^:]*:\s*$/.test(line) && !line.startsWith(' ')) break;
    if (/^\s*-\s*platform:\s*gpio\s*$/i.test(line)) {
      let end = i + 1;
      while (end < lines.length) {
        const next = lines[end];
        if (/^\s*-\s*platform:\s*gpio\s*$/i.test(next)) break;
        if (/^[^\s#][^:]*:\s*$/.test(next) && !next.startsWith(' ')) break;
        end++;
      }
      const block = lines.slice(i, end);
      const pinIdx = block.findIndex((ln) => /^\s*pin:\s*/i.test(ln));
      if (pinIdx >= 0) {
        const raw = block[pinIdx].replace(/^\s*pin:\s*/i, '').trim().replace(/^['"]|['"]$/g, '');
        if (String(raw).toUpperCase() === String(pin).toUpperCase()) {
          const idIdx = block.findIndex((ln) => /^\s*id:\s*/i.test(ln));
          return { pinIdx: i + pinIdx, idIdx: idIdx >= 0 ? i + idIdx : -1 };
        }
      }
      i = end - 1;
    }
  }
  return null;
}

function _ensureOneWireBusId(yamlText, pin, preferredId) {
  const found = _findOneWireBlock(yamlText, pin);
  if (found) {
    const lines = yamlText.split(/\r?\n/);
    if (found.idIdx >= 0) {
      const existingId = String(lines[found.idIdx]).replace(/^\s*id:\s*/i, '').trim();
      return { yamlText, busId: existingId || preferredId };
    }
    lines.splice(found.pinIdx + 1, 0, `    id: ${preferredId}`);
    return { yamlText: lines.join('\n'), busId: preferredId };
  }

  const owBlock = `one_wire:\n  - platform: gpio\n    pin: ${pin}\n    id: ${preferredId}`;
  if (/^sensor:\s*$/m.test(yamlText)) {
    return { yamlText: yamlText.replace(/^(sensor:\s*)$/m, owBlock + '\n\n$1'), busId: preferredId };
  }
  return { yamlText: yamlText.trimEnd() + '\n\n' + owBlock + '\n', busId: preferredId };
}

function _countDallasSensorsForBus(yamlText, busId) {
  const lines = String(yamlText || '').split(/\r?\n/);
  let inSensor = false;
  let currentPlatform = null;
  let currentHasBus = false;
  let count = 0;
  function flush() {
    if (inSensor && currentPlatform === 'dallas_temp' && currentHasBus) count++;
    currentPlatform = null;
    currentHasBus = false;
  }
  for (const line of lines) {
    if (!inSensor) {
      if (/^sensor:\s*$/i.test(line)) inSensor = true;
      continue;
    }
    if (/^[^\s#][^:]*:\s*$/.test(line) && !line.startsWith(' ')) { flush(); break; }
    const platformMatch = line.match(/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i);
    if (platformMatch) {
      flush();
      currentPlatform = platformMatch[1].toLowerCase();
      continue;
    }
    if (currentPlatform === 'dallas_temp' && /^\s*one_wire_id:\s*/i.test(line)) {
      const v = line.replace(/^\s*one_wire_id:\s*/i, '').trim();
      if (v === busId) currentHasBus = true;
    }
  }
  flush();
  return count;
}

function _refreshDiscoveryPayload(yamlText, deviceSafeName, deviceName, boardLabel, boardProfileId, entitiesToAdd) {
  const topicNeedle = `topic: "elaris/${deviceSafeName}/config"`;
  const lines = yamlText.split('\n');
  const idx = lines.findIndex((line) => line.includes(topicNeedle));
  if (idx < 0) return yamlText;

  let payloadIdx = -1;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 12); i++) {
    if (/^\s*payload:\s*/.test(lines[i])) { payloadIdx = i; break; }
    if (/^\s*topic:\s*/.test(lines[i])) break;
  }
  if (payloadIdx < 0) return yamlText;

  const m = lines[payloadIdx].match(/^(\s*payload:\s*)'(.*)'\s*$/);
  if (!m) return yamlText;

  let parsed;
  try {
    parsed = JSON.parse(m[2].replace(/''/g, "'"));
  } catch (_) {
    parsed = {
      device: { name: deviceName, hostname: safeName(deviceName), model: boardLabel || 'ELARIS Board', board_profile_id: boardProfileId || null, sw: '1.0.0' },
      entities: [],
    };
  }

  const current = Array.isArray(parsed.entities) ? parsed.entities : [];
  const next = [...current];
  for (const entity of entitiesToAdd || []) {
    if (!entity?.key) continue;
    const existingIdx = next.findIndex((x) => String(x.key) === String(entity.key));
    if (existingIdx >= 0) next[existingIdx] = { ...next[existingIdx], ...entity };
    else next.push(entity);
  }
  parsed.entities = next;
  parsed.capabilities = next.reduce((acc, e) => {
    const t = String(e.type || '').toLowerCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  if (!parsed.device || typeof parsed.device !== 'object') parsed.device = {};
  parsed.device.name = parsed.device.name || deviceName;
  parsed.device.hostname = parsed.device.hostname || safeName(deviceName);
  parsed.device.model = parsed.device.model || boardLabel || 'ELARIS Board';
  if (!('board_profile_id' in parsed.device)) parsed.device.board_profile_id = boardProfileId || null;
  parsed.device.sw = parsed.device.sw || '1.0.0';

  const payload = JSON.stringify(parsed).replace(/'/g, "''");
  lines[payloadIdx] = `${m[1]}'${payload}'`;
  return lines.join('\n');
}
function pinLines(entity) {
  if (entity._resolvedExpander) {
    const x = entity._resolvedExpander;
    return [
      '    pin:',
      `      pcf8574: ${x.pcf8574}`,
      `      number: ${x.number}`,
      `      mode: ${x.mode || (entity.type === 'relay' ? 'OUTPUT' : 'INPUT')}`,
      ...(x.inverted ? ['      inverted: true'] : []),
    ];
  }
  const pin = entity._resolvedPin || entity.pin || entity.source;
  return [
    '    pin:',
    `      number: ${pin}`,
    `      mode: ${entity.type === 'relay' ? 'OUTPUT' : 'INPUT'}`,
  ];
}

function generateYAML({ profile, payload }) {
  const sname = safeName(payload.device_name);
  const framework = payload.framework || profile.frameworkDefault || 'esp-idf';
  const entities = payload.entities || [];
  const relays = entities.filter(e => e.type === 'relay');
  const dis = entities.filter(e => e.type === 'di');
  const ds18s = entities.filter(e => e.type === 'ds18b20');
  const dhts = entities.filter(e => e.type === 'dht' || e.type === 'dht11');
  const analogs = entities.filter(e => e.type === 'analog');
  const lines = [];

  const discoveryPayload = mqttDiscoveryJson({ deviceName: payload.device_name, boardLabel: profile.label, boardProfileId: profile.id, entities }).replace(/'/g, "''");

  lines.push('esphome:');
  lines.push(`  name: ${sname}`);
  lines.push(`  friendly_name: "${yamlStr(payload.device_name)}"`);
  lines.push('');

  if (profile.platform === 'esp32') {
    lines.push('esp32:');
    lines.push(`  board: ${profile.board}`);
    lines.push('  framework:');
    lines.push(`    type: ${framework}`);
    lines.push('');
  } else {
    lines.push('esp8266:');
    lines.push(`  board: ${profile.board}`);
    lines.push('');
  }

  lines.push('logger:');
  lines.push('');
  lines.push('ota:');
  lines.push('  - platform: esphome');
  lines.push('');

  if (payload.use_ethernet && profile.ethernet) {
    lines.push('ethernet:');
    lines.push(`  type: ${profile.ethernet.type}`);
    lines.push(`  mdc_pin: GPIO${profile.ethernet.mdc_pin}`);
    lines.push(`  mdio_pin: GPIO${profile.ethernet.mdio_pin}`);
    if (profile.ethernet.clk) {
      lines.push('  clk:');
      lines.push(`    mode: ${profile.ethernet.clk.mode}`);
      lines.push(`    pin: ${profile.ethernet.clk.pin}`);
    }
    lines.push(`  phy_addr: ${profile.ethernet.phy_addr}`);
    lines.push('');
  } else {
    lines.push('wifi:');
    lines.push(`  ssid: "${yamlStr(payload.wifi_ssid)}"`);
    lines.push(`  password: "${yamlStr(payload.wifi_pass)}"`);
    lines.push('');
  }

  if (profile.i2c) {
    lines.push('i2c:');
    lines.push(`  sda: ${profile.i2c.sda}`);
    lines.push(`  scl: ${profile.i2c.scl}`);
    if (profile.i2c.scan) lines.push('  scan: true');
    if (profile.i2c.id) lines.push(`  id: ${profile.i2c.id}`);
    lines.push('');
  }

  if (Array.isArray(profile.pcf8574) && profile.pcf8574.length) {
    lines.push('pcf8574:');
    for (const hub of profile.pcf8574) {
      lines.push(`  - id: '${hub.id}'`);
      lines.push(`    address: ${hub.address}`);
    }
    lines.push('');
  }

  lines.push('mqtt:');
  lines.push(`  broker: ${payload.mqtt_host}`);
  lines.push('  port: 1883');
  lines.push('  discovery: false');
  lines.push('  on_connect:');
  lines.push('    then:');
  lines.push('      - mqtt.publish:');
  lines.push(`          topic: "elaris/${sname}/config"`);
  lines.push(`          payload: '${discoveryPayload}'`);
  lines.push('          retain: true');
  if (relays.length) {
    lines.push('  on_message:');
    for (const r of relays) {
      lines.push(`    - topic: "elaris/${sname}/cmnd/${r.key}"`);
      lines.push('      then:');
      lines.push('        - lambda: |-');
      lines.push(`            if (x == "ON") id(${r.key}).turn_on();`);
      lines.push(`            else id(${r.key}).turn_off();`);
    }
  }
  lines.push('');

  if (relays.length) {
    lines.push('switch:');
    for (const r of relays) {
      lines.push('  - platform: gpio');
      lines.push(`    name: "${r.name}"`);
      lines.push(`    id: ${r.key}`);
      lines.push(...pinLines(r));
      lines.push('    restore_mode: RESTORE_DEFAULT_OFF');
      lines.push('    on_turn_on:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/state/${r.key}"`);
      lines.push('          payload: "ON"');
      lines.push('          retain: true');
      lines.push('    on_turn_off:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/state/${r.key}"`);
      lines.push('          payload: "OFF"');
      lines.push('          retain: true');
    }
    lines.push('');
  }

  if (dis.length) {
    lines.push('binary_sensor:');
    for (const d of dis) {
      lines.push('  - platform: gpio');
      lines.push(`    name: "${d.name}"`);
      lines.push(`    id: ${d.key}`);
      lines.push(...pinLines(d));
      lines.push('    on_state:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/tele/${d.key}"`);
      lines.push('          payload: !lambda |-');
      lines.push('            return x ? "ON" : "OFF";');
    }
    lines.push('');
  }

  if (ds18s.length) {
    const pin = ds18s[0].pin || ds18s[0].source;
    lines.push('one_wire:');
    lines.push('  - platform: gpio');
    lines.push(`    pin: ${pin}`);
    lines.push('');
  }

  if (ds18s.length || dhts.length || analogs.length) {
    lines.push('sensor:');
    ds18s.forEach((s, i) => {
      lines.push('  - platform: dallas_temp');
      lines.push(`    index: ${i}`);
      lines.push(`    name: "${s.name}"`);
      lines.push(`    id: ${s.key}`);
      lines.push('    unit_of_measurement: "°C"');
      lines.push('    update_interval: 30s');
      lines.push('    on_value:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/tele/${s.key}"`);
      lines.push('          payload: !lambda |-');
      lines.push('            return str_sprintf("%.1f", x);');
    });
    dhts.forEach((d) => {
      const pin = d.pin || d.source;
      const model = d.type === 'dht11' ? 'DHT11' : 'DHT22';
      const humKey = d.key + '_hum';
      lines.push('  - platform: dht');
      lines.push(`    pin: ${pin}`);
      lines.push(`    model: ${model}`);
      lines.push('    update_interval: 30s');
      lines.push('    temperature:');
      lines.push(`      name: "${d.name} Temperature"`);
      lines.push(`      id: ${d.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${d.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    humidity:');
      lines.push(`      name: "${d.name} Humidity"`);
      lines.push(`      id: ${humKey}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${humKey}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
    });
    analogs.forEach((a) => {
      const pin = a.pin || a.source;
      lines.push('  - platform: adc');
      lines.push(`    pin: ${pin}`);
      lines.push(`    name: "${a.name}"`);
      lines.push(`    id: ${a.key}`);
      lines.push('    update_interval: 10s');
      lines.push('    on_value:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/tele/${a.key}"`);
      lines.push('          payload: !lambda |-');
      lines.push('            return str_sprintf("%.3f", x);');
    });
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ── Peripheral injection into existing YAML ──────────────────────────────────

/**
 * Inject a new sensor/peripheral into an existing ESPHome YAML string.
 * Uses text-based injection to preserve the original YAML structure exactly.
 *
 * @param {string} yamlText   - existing YAML file content
 * @param {string} deviceSafeName - safe name of the device (for MQTT topics)
 * @param {{ type, name, key, pin }} entity - peripheral to add
 * @returns {string} updated YAML text
 */
function addPeripheralToYaml(yamlText, deviceSafeName, entity, opts = {}) {
  const { type, name, key, pin } = entity;
  const deviceName = opts.deviceName || deviceSafeName;
  const boardLabel = opts.boardLabel || 'ELARIS Board';
  const boardProfileId = opts.boardProfileId || null;
  let result = yamlText;

  if (type === 'ds18b20') {
    const busIdBase = `ow_gpio_${String(pin).replace(/[^0-9]/g, '') || 'bus'}`;
    const ensured = _ensureOneWireBusId(result, pin, busIdBase);
    result = ensured.yamlText;
    const busId = ensured.busId;
    const dsIndex = _countDallasSensorsForBus(result, busId);

    const sensorItem = [
      '  - platform: dallas_temp',
      `    one_wire_id: ${busId}`,
      `    index: ${dsIndex}`,
      `    name: "${yamlStr(name)}"`,
      `    id: ${key}`,
      '    unit_of_measurement: "°C"',
      '    update_interval: 30s',
      '    on_value:',
      '      - mqtt.publish:',
      `          topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '          payload: !lambda |-',
      '            return str_sprintf("%.1f", x);',
    ].join('\n');

    result = _insertSensorItem(result, sensorItem);

  } else if (type === 'dht11' || type === 'dht') {
    const model = type === 'dht11' ? 'DHT11' : 'DHT22';
    const humKey = key + '_hum';

    const sensorItem = [
      '  - platform: dht',
      `    pin: ${pin}`,
      `    model: ${model}`,
      '    update_interval: 30s',
      '    temperature:',
      `      name: "${yamlStr(name)} Temperature"`,
      `      id: ${key}`,
      '      on_value:',
      '        - mqtt.publish:',
      `            topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '            payload: !lambda |-',
      '              return str_sprintf("%.1f", x);',
      '    humidity:',
      `      name: "${yamlStr(name)} Humidity"`,
      `      id: ${humKey}`,
      '      on_value:',
      '        - mqtt.publish:',
      `            topic: "elaris/${deviceSafeName}/tele/${humKey}"`,
      '            payload: !lambda |-',
      '              return str_sprintf("%.1f", x);',
    ].join('\n');

    result = _insertSensorItem(result, sensorItem);

  } else if (type === 'analog') {
    const sensorItem = [
      '  - platform: adc',
      `    pin: ${pin}`,
      `    name: "${yamlStr(name)}"`,
      `    id: ${key}`,
      '    update_interval: 10s',
      '    on_value:',
      '      - mqtt.publish:',
      `          topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '          payload: !lambda |-',
      '            return str_sprintf("%.3f", x);',
    ].join('\n');

    result = _insertSensorItem(result, sensorItem);

  } else if (type === 'pulse_counter') {
    const updateInterval = entity.update_interval || '10s';
    const scale = entity.scale || 'none';
    const scaleFactor = Number(entity.scale_factor) || 1;
    const pinMode = entity.pin_mode || 'INPUT_PULLUP';

    let unit, filterLines;
    if (scale === 'yfs201') {
      unit = 'L/min';
      filterLines = ['    filters:', '      - lambda: return x / 450.0;  # YF-S201: 450 pulses/min = 1 L/min'];
    } else if (scale === 'anemometer') {
      unit = 'Hz';
      filterLines = ['    filters:', '      - lambda: return x / 60.0;  # pulses/min → Hz'];
    } else if (scale === 'custom') {
      unit = entity.scale_unit || 'units';
      filterLines = ['    filters:', `      - lambda: return x * ${scaleFactor};`];
    } else {
      unit = 'pulses/min';
      filterLines = [];
    }

    const sensorItem = [
      '  - platform: pulse_counter',
      '    pin:',
      `      number: ${pin}`,
      `      mode: ${pinMode}`,
      `    name: "${yamlStr(name)}"`,
      `    id: ${key}`,
      `    unit_of_measurement: "${unit}"`,
      `    update_interval: ${updateInterval}`,
      ...filterLines,
      '    on_value:',
      '      - mqtt.publish:',
      `          topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '          payload: !lambda |-',
      '            return str_sprintf("%.2f", x);',
    ].join('\n');

    result = _insertSensorItem(result, sensorItem);
  }

  result = _refreshDiscoveryPayload(result, deviceSafeName, deviceName, boardLabel, boardProfileId, peripheralDiscoveryEntities(entity));
  return result.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Insert a sensor list item (lines starting with "  - platform: ...") into
 * the existing top-level `sensor:` block of a YAML string, or append a new
 * `sensor:` block if one doesn't exist.
 */
function _insertSensorItem(yamlText, sensorItemText) {
  const lines = yamlText.split('\n');

  let sensorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^sensor:\s*$/.test(lines[i])) { sensorIdx = i; break; }
  }

  if (sensorIdx === -1) {
    return yamlText.trimEnd() + '\n\nsensor:\n' + sensorItemText + '\n';
  }

  // Find end of sensor block: first line at column 0 that is non-empty and starts with a letter
  let insertIdx = lines.length;
  for (let i = sensorIdx + 1; i < lines.length; i++) {
    if (lines[i].length > 0 && /^[a-zA-Z]/.test(lines[i])) { insertIdx = i; break; }
  }

  const newLines = sensorItemText.split('\n');
  lines.splice(insertIdx, 0, ...newLines);
  return lines.join('\n');
}

module.exports = { generateYAML, addPeripheralToYaml };
