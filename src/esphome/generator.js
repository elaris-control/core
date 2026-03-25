const { safeName } = require('./schema');
const { findBoardBus } = require('./board_port_registry');

// Escape a string for use inside YAML double-quoted scalars
function yamlStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

const I2C_ENTITY_TYPES = ['bh1750', 'sht3x', 'bme280', 'bmp280', 'veml7700', 'ina219', 'ccs811'];
const UART_ENTITY_TYPES = ['mhz19', 'pzem004t'];

function discoveryEntries(entity) {
  const type = String(entity?.type || '').toLowerCase();
  if (!entity || !entity.key) return [];
  if (type === 'dht' || type === 'dht11') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Temperature`, unit: '°C', device_class: 'temperature' },
      { key: `${entity.key}_hum`, group: 'tele', type: 'sensor', name: `${entity.name} Humidity`, unit: '%', device_class: 'humidity' },
    ];
  }
  if (type === 'sht3x') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Temperature`, unit: '°C', device_class: 'temperature' },
      { key: `${entity.key}_hum`, group: 'tele', type: 'sensor', name: `${entity.name} Humidity`, unit: '%', device_class: 'humidity' },
    ];
  }
  if (type === 'bme280') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Temperature`, unit: '°C', device_class: 'temperature' },
      { key: `${entity.key}_hum`, group: 'tele', type: 'sensor', name: `${entity.name} Humidity`, unit: '%', device_class: 'humidity' },
      { key: `${entity.key}_press`, group: 'tele', type: 'sensor', name: `${entity.name} Pressure`, unit: 'hPa', device_class: 'pressure' },
    ];
  }
  if (type === 'bmp280') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Temperature`, unit: '°C', device_class: 'temperature' },
      { key: `${entity.key}_press`, group: 'tele', type: 'sensor', name: `${entity.name} Pressure`, unit: 'hPa', device_class: 'pressure' },
    ];
  }
  if (type === 'ina219') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Current`, unit: 'A', device_class: 'current' },
      { key: `${entity.key}_power`, group: 'tele', type: 'sensor', name: `${entity.name} Power`, unit: 'W', device_class: 'power' },
      { key: `${entity.key}_voltage`, group: 'tele', type: 'sensor', name: `${entity.name} Voltage`, unit: 'V', device_class: 'voltage' },
    ];
  }
  if (type === 'ccs811') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} eCO2`, unit: 'ppm', device_class: 'carbon_dioxide' },
      { key: `${entity.key}_tvoc`, group: 'tele', type: 'sensor', name: `${entity.name} TVOC`, unit: 'ppb' },
    ];
  }
  if (type === 'mhz19') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} CO2`, unit: 'ppm', device_class: 'carbon_dioxide' },
      { key: `${entity.key}_temp`, group: 'tele', type: 'sensor', name: `${entity.name} Temperature`, unit: '°C', device_class: 'temperature' },
    ];
  }
  if (type === 'pzem004t') {
    return [
      { key: entity.key, group: 'tele', type: 'sensor', name: `${entity.name} Power`, unit: 'W', device_class: 'power' },
      { key: `${entity.key}_voltage`, group: 'tele', type: 'sensor', name: `${entity.name} Voltage`, unit: 'V', device_class: 'voltage' },
      { key: `${entity.key}_current`, group: 'tele', type: 'sensor', name: `${entity.name} Current`, unit: 'A', device_class: 'current' },
      { key: `${entity.key}_energy`, group: 'tele', type: 'sensor', name: `${entity.name} Energy`, unit: 'kWh', device_class: 'energy' },
    ];
  }
  if (type === 'ds18b20') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit: '°C', device_class: 'temperature' }];
  if (type === 'di') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
  if (type === 'analog') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
  if (type === 'bh1750' || type === 'veml7700') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit: 'lx', device_class: 'illuminance' }];
  if (type === 'pulse_counter') {
    let unit = 'pulses/min';
    if (entity.scale === 'yfs201') unit = 'L/min';
    else if (entity.scale === 'anemometer') unit = 'Hz';
    else if (entity.scale === 'custom' && entity.scale_unit) unit = entity.scale_unit;
    return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit }];
  }
  if (type === 'relay' || type === 'switch') return [{ key: entity.key, group: 'state', type: 'relay', name: entity.name }];
  return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
}

function mqttDiscoveryJson({ deviceName, boardLabel, boardProfileId, entities }) {
  const entityList = (Array.isArray(entities) ? entities : []).flatMap((e) => discoveryEntries(e));
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
  return discoveryEntries(entity);
}

function buildI2cBusDefs(profile, entities) {
  const defs = [];
  const seen = new Set();
  const useIds = new Set((entities || []).filter((e) => I2C_ENTITY_TYPES.includes(String(e.type || '').toLowerCase())).map((e) => String(e.bus_id || '').trim()).filter(Boolean));
  const push = (id, sda, scl) => {
    const key = `${id || ''}|${sda || ''}|${scl || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    defs.push({ id, sda, scl });
  };
  const rawI2c = profile?.i2c;
  const arr = Array.isArray(rawI2c) ? rawI2c : (rawI2c ? [rawI2c] : []);
  for (const raw of arr) push(raw.id || null, raw.sda || null, raw.scl || null);
  for (const id of useIds) {
    const bus = findBoardBus(profile, id);
    if (bus && String(bus.protocol || '').toLowerCase() === 'i2c') push(bus.id || id, bus.sda || null, bus.scl || null);
  }
  return defs.filter((d) => d.sda && d.scl);
}

function renderI2cSection(busDefs) {
  if (!busDefs.length) return [];
  const lines = ['i2c:'];
  if (busDefs.length === 1) {
    const bus = busDefs[0];
    lines.push(`  sda: ${bus.sda}`);
    lines.push(`  scl: ${bus.scl}`);
    if (bus.id) lines.push(`  id: ${bus.id}`);
    return lines.concat(['']);
  }
  busDefs.forEach((bus) => {
    lines.push(`  - id: ${bus.id || 'bus'}`);
    lines.push(`    sda: ${bus.sda}`);
    lines.push(`    scl: ${bus.scl}`);
  });
  return lines.concat(['']);
}

function buildUartBusDefs(profile, entities) {
  const defs = [];
  const seen = new Set();
  const useIds = new Set((entities || []).filter((e) => UART_ENTITY_TYPES.includes(String(e.type || '').toLowerCase())).map((e) => String(e.bus_id || '').trim()).filter(Boolean));
  for (const id of useIds) {
    const bus = findBoardBus(profile, id);
    if (!bus) continue;
    const proto = String(bus.protocol || '').toLowerCase();
    if (proto !== 'uart' && proto !== 'rs485') continue;
    const key = `${bus.id || id}|${bus.tx || ''}|${bus.rx || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    defs.push({ id: bus.id || id, tx: bus.tx || null, rx: bus.rx || null, baud: 9600 });
  }
  return defs.filter((d) => d.tx && d.rx);
}

function renderUartSection(busDefs) {
  if (!busDefs.length) return [];
  const lines = ['uart:'];
  if (busDefs.length === 1) {
    const bus = busDefs[0];
    if (bus.id) lines.push(`  id: ${bus.id}`);
    lines.push(`  tx_pin: ${bus.tx}`);
    lines.push(`  rx_pin: ${bus.rx}`);
    lines.push(`  baud_rate: ${bus.baud || 9600}`);
    return lines.concat(['']);
  }
  busDefs.forEach((bus) => {
    lines.push(`  - id: ${bus.id || 'uart_bus'}`);
    lines.push(`    tx_pin: ${bus.tx}`);
    lines.push(`    rx_pin: ${bus.rx}`);
    lines.push(`    baud_rate: ${bus.baud || 9600}`);
  });
  return lines.concat(['']);
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

function _hasTopLevelBlock(yamlText, blockName) {
  return new RegExp('^' + blockName + ':\\s*$', 'mi').test(String(yamlText || ''));
}

function _parseI2cBlock(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^i2c:\s*$/i.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s#][^:]*:\s*$/.test(lines[i]) && !lines[i].startsWith(' ')) { end = i; break; }
  }
  const blockLines = lines.slice(start + 1, end);
  const buses = [];
  let current = null;
  let listMode = false;
  function flush() {
    if (!current) return;
    buses.push({ id: current.id || null, sda: current.sda || null, scl: current.scl || null });
    current = null;
  }
  for (const line of blockLines) {
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
  return { start, end, buses: buses.filter((b) => b.id || b.sda || b.scl) };
}

function _busMatches(bus, wantedId, wantedSda, wantedScl) {
  const bid = String(bus?.id || '').trim();
  const bsda = String(bus?.sda || '').trim().toUpperCase();
  const bscl = String(bus?.scl || '').trim().toUpperCase();
  const idMatch = wantedId && bid && bid === wantedId;
  const pinMatch = wantedSda && wantedScl && bsda === String(wantedSda).trim().toUpperCase() && bscl === String(wantedScl).trim().toUpperCase();
  return !!(idMatch || pinMatch);
}

function _ensureI2cBlock(yamlText, sda, scl, preferredId) {
  const wantedId = String(preferredId || '').trim() || null;
  const wantedSda = String(sda || 'GPIO21').trim().toUpperCase();
  const wantedScl = String(scl || 'GPIO22').trim().toUpperCase();
  const parsed = _parseI2cBlock(yamlText);
  if (!parsed) {
    const busId = wantedId || 'bus_a';
    const block = `i2c:\n  - id: ${busId}\n    sda: ${wantedSda}\n    scl: ${wantedScl}`;
    if (/^sensor:\s*$/m.test(yamlText)) {
      return { yamlText: yamlText.replace(/^(sensor:\s*)$/m, block + '\n\n$1'), busId };
    }
    return { yamlText: yamlText.trimEnd() + '\n\n' + block + '\n', busId };
  }

  const existing = parsed.buses.find((bus) => _busMatches(bus, wantedId, wantedSda, wantedScl));
  if (existing) return { yamlText, busId: existing.id || wantedId || null };

  const lines = String(yamlText || '').split(/\r?\n/);
  const existingBuses = parsed.buses.length ? parsed.buses.slice() : [{ id: null, sda: wantedSda, scl: wantedScl }];
  const nextId = wantedId || `bus_${existingBuses.length + 1}`;
  const allBuses = existingBuses.concat([{ id: nextId, sda: wantedSda, scl: wantedScl }]);
  const rendered = ['i2c:'];
  allBuses.forEach((bus, idx) => {
    rendered.push(`  - id: ${bus.id || `bus_${idx + 1}`}`);
    rendered.push(`    sda: ${bus.sda || wantedSda}`);
    rendered.push(`    scl: ${bus.scl || wantedScl}`);
  });
  lines.splice(parsed.start, parsed.end - parsed.start, ...rendered);
  return { yamlText: lines.join('\n'), busId: nextId };
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
  const sname = safeName(payload.device_id || payload.device_name);
  const framework = payload.framework || profile.frameworkDefault || 'esp-idf';
  const entities = payload.entities || [];
  const relays = entities.filter(e => e.type === 'relay');
  const dis = entities.filter(e => e.type === 'di');
  const ds18s = entities.filter(e => e.type === 'ds18b20');
  const dhts = entities.filter(e => e.type === 'dht' || e.type === 'dht11');
  const analogs = entities.filter(e => e.type === 'analog');
  const bhs = entities.filter(e => e.type === 'bh1750');
  const shts = entities.filter(e => e.type === 'sht3x');
  const bmes = entities.filter(e => e.type === 'bme280');
  const bmps = entities.filter(e => e.type === 'bmp280');
  const vemls = entities.filter(e => e.type === 'veml7700');
  const ina219s = entities.filter(e => e.type === 'ina219');
  const ccs811s = entities.filter(e => e.type === 'ccs811');
  const mhz19s = entities.filter(e => e.type === 'mhz19');
  const pzems = entities.filter(e => e.type === 'pzem004t');
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

  const i2cBusDefs = buildI2cBusDefs(profile, entities);
  renderI2cSection(i2cBusDefs).forEach((ln) => lines.push(ln));

  const uartBusDefs = buildUartBusDefs(profile, entities);
  renderUartSection(uartBusDefs).forEach((ln) => lines.push(ln));

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

  lines.push('text_sensor:');
  lines.push(`  - platform: ${payload.use_ethernet && profile.ethernet ? 'ethernet_info' : 'wifi_info'}`);
  lines.push('    ip_address:');
  lines.push('      name: "IP Address"');
  lines.push('    mac_address:');
  lines.push('      name: "MAC Address"');
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

  if (ds18s.length || dhts.length || analogs.length || bmes.length || bmps.length || bhs.length || shts.length || vemls.length || ina219s.length || ccs811s.length || mhz19s.length || pzems.length) {
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
    bhs.forEach((e) => {
      lines.push('  - platform: bh1750');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x23'}`);
      lines.push(`    name: "${e.name}"`);
      lines.push(`    id: ${e.key}`);
      lines.push('    update_interval: 30s');
      lines.push('    on_value:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('          payload: !lambda |-');
      lines.push('            return str_sprintf("%.0f", x);');
    });
    shts.forEach((e) => {
      lines.push('  - platform: sht3xd');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x44'}`);
      lines.push('    update_interval: 30s');
      lines.push('    temperature:');
      lines.push(`      name: "${e.name} Temperature"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    humidity:');
      lines.push(`      name: "${e.name} Humidity"`);
      lines.push(`      id: ${e.key}_hum`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_hum"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
    });
    bmes.forEach((e) => {
      lines.push('  - platform: bme280_i2c');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x76'}`);
      lines.push('    update_interval: 60s');
      lines.push('    temperature:');
      lines.push(`      name: "${e.name} Temperature"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    humidity:');
      lines.push(`      name: "${e.name} Humidity"`);
      lines.push(`      id: ${e.key}_hum`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_hum"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    pressure:');
      lines.push(`      name: "${e.name} Pressure"`);
      lines.push(`      id: ${e.key}_press`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_press"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
    });
    bmps.forEach((e) => {
      lines.push('  - platform: bmp280_i2c');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x76'}`);
      lines.push('    update_interval: 60s');
      lines.push('    temperature:');
      lines.push(`      name: "${e.name} Temperature"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    pressure:');
      lines.push(`      name: "${e.name} Pressure"`);
      lines.push(`      id: ${e.key}_press`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_press"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
    });
    vemls.forEach((e) => {
      lines.push('  - platform: veml7700');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x10'}`);
      lines.push(`    name: "${e.name}"`);
      lines.push(`    id: ${e.key}`);
      lines.push('    update_interval: 30s');
      lines.push('    on_value:');
      lines.push('      - mqtt.publish:');
      lines.push(`          topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('          payload: !lambda |-');
      lines.push('            return str_sprintf("%.0f", x);');
    });
    ina219s.forEach((e) => {
      lines.push('  - platform: ina219');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x40'}`);
      lines.push('    current:');
      lines.push(`      name: "${e.name} Current"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.3f", x);');
      lines.push('    power:');
      lines.push(`      name: "${e.name} Power"`);
      lines.push(`      id: ${e.key}_power`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_power"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.3f", x);');
      lines.push('    bus_voltage:');
      lines.push(`      name: "${e.name} Voltage"`);
      lines.push(`      id: ${e.key}_voltage`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_voltage"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.3f", x);');
    });
    ccs811s.forEach((e) => {
      lines.push('  - platform: ccs811');
      if (e.bus_id) lines.push(`    i2c_id: ${e.bus_id}`);
      lines.push(`    address: ${e.address || '0x5A'}`);
      lines.push('    eco2:');
      lines.push(`      name: "${e.name} eCO2"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.0f", x);');
      lines.push('    tvoc:');
      lines.push(`      name: "${e.name} TVOC"`);
      lines.push(`      id: ${e.key}_tvoc`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_tvoc"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.0f", x);');
    });
    mhz19s.forEach((e) => {
      lines.push('  - platform: mhz19');
      if (e.bus_id) lines.push(`    uart_id: ${e.bus_id}`);
      lines.push('    update_interval: 60s');
      lines.push('    automatic_baseline_calibration: false');
      lines.push('    co2:');
      lines.push(`      name: "${e.name} CO2"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.0f", x);');
      lines.push('    temperature:');
      lines.push(`      name: "${e.name} Temperature"`);
      lines.push(`      id: ${e.key}_temp`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_temp"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
    });
    pzems.forEach((e) => {
      lines.push('  - platform: pzemac');
      if (e.bus_id) lines.push(`    uart_id: ${e.bus_id}`);
      lines.push('    current:');
      lines.push(`      name: "${e.name} Current"`);
      lines.push(`      id: ${e.key}_current`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_current"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.3f", x);');
      lines.push('    voltage:');
      lines.push(`      name: "${e.name} Voltage"`);
      lines.push(`      id: ${e.key}_voltage`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_voltage"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    power:');
      lines.push(`      name: "${e.name} Power"`);
      lines.push(`      id: ${e.key}`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.1f", x);');
      lines.push('    energy:');
      lines.push(`      name: "${e.name} Energy"`);
      lines.push(`      id: ${e.key}_energy`);
      lines.push('      on_value:');
      lines.push('        - mqtt.publish:');
      lines.push(`            topic: "elaris/${sname}/tele/${e.key}_energy"`);
      lines.push('            payload: !lambda |-');
      lines.push('              return str_sprintf("%.3f", x);');
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
  const { type, name, key, pin, sda, scl, address } = entity;
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

  } else if (type === 'di') {
    const sensorItem = [
      'binary_sensor:',
      '  - platform: gpio',
      `    pin: ${pin}` ,
      `    name: "${yamlStr(name)}"`,
      `    id: ${key}`,
      '    on_state:',
      '      - mqtt.publish:',
      `          topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '          payload: !lambda |-',
      '            return x ? "ON" : "OFF";',
    ].join('\n');

    if (/^binary_sensor:\s*$/m.test(result)) {
      const lines = result.split('\n');
      const start = lines.findIndex((line) => /^binary_sensor:\s*$/.test(line));
      let insertAt = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^[^\s#][^:]*:\s*$/.test(lines[i]) && !lines[i].startsWith(' ')) { insertAt = i; break; }
      }
      lines.splice(insertAt, 0, ...sensorItem.split('\n').slice(1));
      result = lines.join('\n');
    } else {
      result = result.trimEnd() + '\n\n' + sensorItem + '\n';
    }

  } else if (type === 'bh1750') {
    const ensured = _ensureI2cBlock(result, sda || 'GPIO21', scl || 'GPIO22', entity.bus_id);
    result = ensured.yamlText;
    const sensorItem = [
      '  - platform: bh1750',
      ...(ensured.busId ? [`    i2c_id: ${ensured.busId}`] : []),
      `    address: ${address || '0x23'}`,
      `    name: "${yamlStr(name)}"`,
      `    id: ${key}`,
      '    update_interval: 30s',
      '    on_value:',
      '      - mqtt.publish:',
      `          topic: "elaris/${deviceSafeName}/tele/${key}"`,
      '          payload: !lambda |-',
      '            return str_sprintf("%.0f", x);',
    ].join('\n');
    result = _insertSensorItem(result, sensorItem);

  } else if (type === 'sht3x') {
    const ensured = _ensureI2cBlock(result, sda || 'GPIO21', scl || 'GPIO22', entity.bus_id);
    result = ensured.yamlText;
    const humKey = key + '_hum';
    const sensorItem = [
      '  - platform: sht3xd',
      ...(ensured.busId ? [`    i2c_id: ${ensured.busId}`] : []),
      `    address: ${address || '0x44'}`,
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

  } else if (type === 'pulse_counter') {
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

/**
 * Apply device name, WiFi and MQTT overrides to raw ESPHome YAML.
 * Uses regex to preserve formatting. Works with common ESPHome structure.
 */
function applyYamlOverrides(yamlText, overrides = {}) {
  let out = String(yamlText || '');
  const name = String(overrides.device_name || '').trim();
  // friendly_name is the human label — separate from the MQTT device_id.
  // Falls back to name if not provided.
  const friendlyLabel = String(overrides.friendly_name || overrides.device_name || '').trim();
  const wifiSsid = String(overrides.wifi_ssid || '').trim();
  const wifiPass = String(overrides.wifi_pass ?? '');
  const mqttHost = String(overrides.mqtt_host || '').trim();

  if (name) {
    const nameSafe = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const quotedFriendly = `"${yamlStr(friendlyLabel || nameSafe)}"`;
    // Extract old name before replacing so we can rewrite hardcoded topic strings.
    const oldNameMatch = out.match(/^[ \t]{1,4}name\s*:\s*(\S+)/m);
    const oldNameRaw = oldNameMatch ? String(oldNameMatch[1]).trim() : null;
    const oldNameSafe = oldNameRaw ? oldNameRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '-') : null;
    out = out.replace(/^(\s{2})name\s*:\s*.*$/m, `$1name: ${nameSafe}`);
    out = out.replace(/^(\s{2})friendly_name\s*:\s*.*$/m, `$1friendly_name: ${quotedFriendly}`);
    if (!/^\s{2}name\s*:/m.test(out) && /^esphome:\s*$/m.test(out)) {
      out = out.replace(/(^esphome:\s*)\n/m, `$1\n  name: ${nameSafe}\n  friendly_name: ${quotedFriendly}\n`);
    }
    // Replace hardcoded old device name in MQTT topic strings (lambdas, on_connect, etc.)
    // e.g. "elaris/kc868-a16/tele/..." → "elaris/gamhseme_7df4/tele/..."
    if (oldNameSafe && oldNameSafe !== nameSafe) {
      out = out.split(`elaris/${oldNameSafe}/`).join(`elaris/${nameSafe}/`);
    }
  }

  const hasWifiBlock = /^wifi:\s*$/m.test(out) || /^wifi:\s*\n/m.test(out);
  if (hasWifiBlock && (wifiSsid || wifiPass !== undefined)) {
    out = out.replace(/(^wifi:\s*[\s\S]*?^\S|^wifi:\s*[\s\S]*$)/m, (block) => {
      let next = String(block);
      if (wifiSsid) {
        next = next.replace(/(^\s+ssid\s*:\s*)["']?[^"'\n]*["']?/m, `$1"${yamlStr(wifiSsid)}"`);
      }
      next = next.replace(/(^\s+password\s*:\s*)["']?[^"'\n]*["']?/m, `$1"${yamlStr(wifiPass)}"`);
      return next;
    });
  }

  if (mqttHost) {
    out = out.replace(/(^mqtt:\s*[\s\S]*?^\S|^mqtt:\s*[\s\S]*$)/m, (block) => {
      return String(block).replace(/(^\s+broker\s*:\s*)[^\s\n][^\n]*/m, `$1${mqttHost}`);
    });
  }

  return out;
}

module.exports = { generateYAML, addPeripheralToYaml, applyYamlOverrides };
