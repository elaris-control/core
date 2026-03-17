'use strict';

const { addPeripheralToYaml } = require('./generator');
const { safeName } = require('./schema');

function yamlStr(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function peripheralDiscoveryEntities(entity) {
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
  if (type === 'ds18b20') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit: '°C', device_class: 'temperature' }];
  if (type === 'bh1750') return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name, unit: 'lx', device_class: 'illuminance' }];
  return [{ key: entity.key, group: 'tele', type: 'sensor', name: entity.name }];
}

function flattenPeripheralEntities(peripherals) {
  return (Array.isArray(peripherals) ? peripherals : []).flatMap(peripheralDiscoveryEntities);
}

function parsePayloadLineInfo(yamlText) {
  const lines = String(yamlText || '').split('\n');
  const idx = lines.findIndex((line) => line.includes('topic: "elaris/') && line.includes('/config"'));
  if (idx < 0) return null;
  let payloadIdx = -1;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 12); i++) {
    if (/^\s*payload:\s*/.test(lines[i])) { payloadIdx = i; break; }
    if (/^\s*topic:\s*/.test(lines[i])) break;
  }
  if (payloadIdx < 0) return null;
  const m = lines[payloadIdx].match(/^(\s*payload:\s*)'(.*)'\s*$/);
  if (!m) return null;
  let parsed = null;
  try { parsed = JSON.parse(m[2].replace(/''/g, "'")); } catch (_) { parsed = null; }
  return { lines, payloadIdx, prefix: m[1], parsed };
}

function syncDiscoveryPayload(yamlText, peripherals, opts = {}) {
  const info = parsePayloadLineInfo(yamlText);
  if (!info) return yamlText;
  const parsed = (info.parsed && typeof info.parsed === 'object') ? info.parsed : {};
  const deviceName = opts.deviceName || parsed?.device?.name || safeName(opts.deviceSafeName || 'device');
  const boardLabel = opts.boardLabel || parsed?.device?.model || 'ELARIS Board';
  const boardProfileId = opts.boardProfileId || parsed?.device?.board_profile_id || null;
  const hostname = parsed?.device?.hostname || safeName(deviceName);
  parsed.device = {
    name: deviceName,
    hostname,
    model: boardLabel,
    board_profile_id: boardProfileId,
    sw: parsed?.device?.sw || '1.0.0',
  };
  const entities = flattenPeripheralEntities(peripherals);
  parsed.entities = entities;
  parsed.capabilities = entities.reduce((acc, e) => {
    const t = String(e.type || '').toLowerCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const payload = JSON.stringify(parsed).replace(/'/g, "''");
  info.lines[info.payloadIdx] = `${info.prefix}'${payload}'`;
  return info.lines.join('\n');
}

function parseOneWireBuses(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const buses = new Map();
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
      const pinLine = block.find((ln) => /^\s*pin:\s*/i.test(ln));
      const idLine = block.find((ln) => /^\s*id:\s*/i.test(ln));
      const pin = pinLine ? String(pinLine).replace(/^\s*pin:\s*/i, '').trim().replace(/^['"]|['"]$/g, '') : null;
      const id = idLine ? String(idLine).replace(/^\s*id:\s*/i, '').trim() : null;
      if (id) buses.set(id, pin || null);
      i = end - 1;
    }
  }
  return buses;
}

function getSensorSectionRanges(lines) {
  let sensorStart = -1;
  let sensorEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^sensor:\s*$/i.test(lines[i])) { sensorStart = i; break; }
  }
  if (sensorStart < 0) return { sensorStart: -1, sensorEnd: -1 };
  for (let i = sensorStart + 1; i < lines.length; i++) {
    if (lines[i].length > 0 && /^[a-zA-Z]/.test(lines[i])) { sensorEnd = i; break; }
  }
  return { sensorStart, sensorEnd };
}

function parseManagedPeripherals(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const buses = parseOneWireBuses(yamlText);
  const out = [];
  const { sensorStart, sensorEnd } = getSensorSectionRanges(lines);
  if (sensorStart < 0) return out;
  let i = sensorStart + 1;
  while (i < sensorEnd) {
    const platformMatch = lines[i].match(/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i);
    if (!platformMatch) { i++; continue; }
    const platform = platformMatch[1].toLowerCase();
    let end = i + 1;
    while (end < sensorEnd && !/^\s*-\s*platform:\s*([a-z_][a-z0-9_]*)\s*$/i.test(lines[end])) end++;
    const block = lines.slice(i, end);
    const lineVal = (re) => {
      const line = block.find((ln) => re.test(ln));
      return line ? String(line).replace(re, '').trim().replace(/^['"]|['"]$/g, '') : '';
    };
    const nestedVal = (section, re) => {
      const idx = block.findIndex((ln) => new RegExp(`^\\s*${section}:\\s*$`, 'i').test(ln));
      if (idx < 0) return '';
      for (let j = idx + 1; j < block.length; j++) {
        if (/^\s{2}[a-z_][a-z0-9_]*:\s*$/i.test(block[j])) break;
        if (re.test(block[j])) return String(block[j]).replace(re, '').trim().replace(/^['"]|['"]$/g, '');
      }
      return '';
    };
    if (platform === 'dallas_temp') {
      const key = lineVal(/^\s*id:\s*/i);
      if (key) {
        const busId = lineVal(/^\s*one_wire_id:\s*/i);
        out.push({ type: 'ds18b20', key, name: lineVal(/^\s*name:\s*/i), pin: buses.get(busId) || '', bus_ref: busId || '', start: i, end, removeKeys: [key] });
      }
    } else if (platform === 'dht') {
      const model = lineVal(/^\s*model:\s*/i).toUpperCase();
      const key = nestedVal('temperature', /^\s*id:\s*/i);
      if (key) {
        const pin = lineVal(/^\s*pin:\s*/i);
        const rawName = nestedVal('temperature', /^\s*name:\s*/i);
        const baseName = rawName.replace(/\s+Temperature$/i, '').trim() || rawName;
        out.push({ type: model === 'DHT11' ? 'dht11' : 'dht', key, name: baseName, pin, start: i, end, removeKeys: [key, `${key}_hum`] });
      }
    } else if (platform === 'adc') {
      const key = lineVal(/^\s*id:\s*/i);
      if (key) out.push({ type: 'analog', key, name: lineVal(/^\s*name:\s*/i), pin: lineVal(/^\s*pin:\s*/i), start: i, end, removeKeys: [key] });
    } else if (platform === 'bh1750') {
      const key = lineVal(/^\s*id:\s*/i);
      if (key) out.push({ type: 'bh1750', key, name: lineVal(/^\s*name:\s*/i), address: lineVal(/^\s*address:\s*/i) || '0x23', bus_id: lineVal(/^\s*i2c_id:\s*/i) || '', bus_ref: lineVal(/^\s*i2c_id:\s*/i) || '', start: i, end, removeKeys: [key] });
    } else if (platform === 'sht3xd') {
      const key = nestedVal('temperature', /^\s*id:\s*/i);
      if (key) {
        const rawName = nestedVal('temperature', /^\s*name:\s*/i);
        const baseName = rawName.replace(/\s+Temperature$/i, '').trim() || rawName;
        out.push({ type: 'sht3x', key, name: baseName, address: lineVal(/^\s*address:\s*/i) || '0x44', bus_id: lineVal(/^\s*i2c_id:\s*/i) || '', bus_ref: lineVal(/^\s*i2c_id:\s*/i) || '', start: i, end, removeKeys: [key, `${key}_hum`] });
      }
    } else if (platform === 'pulse_counter') {
      const key = lineVal(/^\s*id:\s*/i);
      if (key) {
        const pin = lineVal(/^\s*\s*number:\s*/i) || lineVal(/^\s*pin:\s*/i);
        out.push({ type: 'pulse_counter', key, name: lineVal(/^\s*name:\s*/i), pin, start: i, end, removeKeys: [key] });
      }
    }
    i = end;
  }
  return out;
}

function removeManagedPeripheralFromYaml(yamlText, key, opts = {}) {
  const peripherals = parseManagedPeripherals(yamlText);
  const current = peripherals.find((p) => String(p.key) === String(key));
  if (!current) throw new Error('peripheral_not_found');
  const lines = String(yamlText || '').split(/\r?\n/);
  lines.splice(current.start, current.end - current.start);
  let nextYaml = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  const remaining = parseManagedPeripherals(nextYaml);
  nextYaml = syncDiscoveryPayload(nextYaml, remaining, opts);
  return { yaml: nextYaml.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', removed: current, remaining };
}

function updateManagedPeripheralInYaml(yamlText, key, nextEntity, opts = {}) {
  const removed = removeManagedPeripheralFromYaml(yamlText, key, opts);
  let nextYaml = addPeripheralToYaml(removed.yaml, opts.deviceSafeName || safeName(opts.deviceName || 'device'), nextEntity, opts);
  const peripherals = parseManagedPeripherals(nextYaml);
  nextYaml = syncDiscoveryPayload(nextYaml, peripherals, opts);
  return { yaml: nextYaml.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', previous: removed.removed, peripherals };
}

module.exports = {
  parseManagedPeripherals,
  removeManagedPeripheralFromYaml,
  updateManagedPeripheralInYaml,
  syncDiscoveryPayload,
};
