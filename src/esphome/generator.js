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
  const counts = entities.reduce((acc, e) => {
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
  });
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
function addPeripheralToYaml(yamlText, deviceSafeName, entity) {
  const { type, name, key, pin } = entity;
  let result = yamlText;

  if (type === 'ds18b20') {
    // Check if one_wire already declared for this exact pin
    const hasOneWireForPin = /^one_wire:/m.test(result) && result.includes(`pin: ${pin}`);

    if (!hasOneWireForPin) {
      const owBlock = `one_wire:\n  - platform: gpio\n    pin: ${pin}`;
      // Insert before existing sensor: block, or append
      if (/^sensor:\s*$/m.test(result)) {
        result = result.replace(/^(sensor:\s*)$/m, owBlock + '\n\n$1');
      } else {
        result = result.trimEnd() + '\n\n' + owBlock + '\n';
      }
    }

    // Count existing dallas_temp sensors to assign correct index
    const dsIndex = (result.match(/platform:\s+dallas_temp/g) || []).length;

    const sensorItem = [
      '  - platform: dallas_temp',
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
  }

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
