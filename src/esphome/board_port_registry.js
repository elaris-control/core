'use strict';

const { parseGpio, toGpioLabel } = require('./schema');

const PERIPHERAL_MATRIX = {
  relay: { mode: 'port', supports: [], protocols: ['do'] },
  di: { mode: 'port', supports: [], protocols: ['di', 'gpio'] },
  ds18b20: { mode: 'port', supports: ['ds18b20'], protocols: ['onewire', 'gpio'] },
  dht11: { mode: 'port', supports: ['dht11'], protocols: ['onewire', 'gpio'] },
  dht: { mode: 'port', supports: ['dht'], protocols: ['onewire', 'gpio'] },
  analog: { mode: 'port', supports: ['analog'], protocols: ['adc', 'gpio'] },
  pulse_counter: { mode: 'port', supports: ['pulse_counter'], protocols: ['gpio', 'di'] },
  bh1750: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x23', '0x5c'] },
  sht3x: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x44', '0x45'] },
  bme280: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x76', '0x77'] },
  bmp280: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x76', '0x77'] },
  veml7700: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x10'] },
  ina219: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x40', '0x41', '0x44', '0x45'] },
  ccs811: { mode: 'bus', busProtocols: ['i2c'], addresses: ['0x5a', '0x5b'] },
  mhz19: { mode: 'bus', busProtocols: ['uart', 'rs485'] },
  pzem004t: { mode: 'bus', busProtocols: ['uart', 'rs485'] },
};

function titleFromGroup(group) {
  const g = String(group || '').toLowerCase();
  if (g === 'ht' || g === 'onewire') return 'Sensor Ports';
  if (g === 'ai') return 'Analog Inputs';
  if (g === 'di') return 'Digital Inputs';
  if (g === 'do') return 'Digital Outputs';
  if (g === 'i2c') return 'I²C Buses';
  if (g === 'rs485') return 'RS485';
  if (g === 'gpio') return 'GPIO';
  return 'Board Ports';
}

function normalizeSupports(items) {
  return [...new Set((items || []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeBoardToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function addAliasToken(set, value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return;
  set.add(raw);
  const flat = raw.replace(/[\s._\-/]+/g, '');
  if (flat) set.add(flat);
  const compact = raw.replace(/\s+/g, ' ');
  if (compact) set.add(compact);
  const numbered = raw.match(/^([A-Z]+)0+(\d+)$/);
  if (numbered) set.add(`${numbered[1]}${Number(numbered[2])}`);
}

function inferIndexedPortNumber(raw = {}) {
  const candidates = [raw.id, raw.label, raw.source].concat(Array.isArray(raw.aliases) ? raw.aliases : []);
  for (const item of candidates) {
    const m = String(item || '').trim().toUpperCase().match(/(?:^|[^A-Z])(DI|DO|AI|AO|HT|DS|IN|OUT|X|Y|AN|ADC|RELAY|TEMP|INPUT)0*(\d+)$/);
    if (m) return Number(m[2]);
  }
  return null;
}

function addIndexedAliases(set, group, index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return;
  const plain = String(n);
  const padded = String(n).padStart(2, '0');
  const families = {
    do: ['DO', 'OUT', 'Y', 'RELAY'],
    di: ['DI', 'IN', 'X', 'INPUT'],
    ai: ['AI', 'AN', 'ADC'],
    ao: ['AO', 'PWM'],
    ht: ['HT', 'DS', 'TEMP', 'ONEWIRE'],
    onewire: ['HT', 'DS', 'TEMP', 'ONEWIRE'],
  };
  for (const prefix of (families[String(group || '').toLowerCase()] || [])) {
    addAliasToken(set, `${prefix}${plain}`);
    addAliasToken(set, `${prefix}${padded}`);
  }
}

function buildPortAliases(raw = {}, derived = {}) {
  const set = new Set();
  [raw.id, raw.label, raw.source, raw.pin, derived.id, derived.label, derived.pin].forEach(v => addAliasToken(set, v));
  for (const alias of (raw.aliases || [])) addAliasToken(set, alias);
  for (const alias of (derived.aliases || [])) addAliasToken(set, alias);
  const gpio = parseGpio(raw.pin != null ? raw.pin : derived.pin);
  if (gpio !== null) {
    addAliasToken(set, toGpioLabel(gpio));
    addAliasToken(set, String(gpio));
  }
  addIndexedAliases(set, derived.group || raw.group || raw.kind, inferIndexedPortNumber(raw));
  return [...set];
}

function buildBusAliases(raw = {}, derived = {}) {
  const set = new Set();
  [raw.id, raw.label, raw.protocol, derived.id, derived.label, derived.protocol].forEach(v => addAliasToken(set, v));
  for (const alias of (raw.aliases || [])) addAliasToken(set, alias);
  for (const alias of (derived.aliases || [])) addAliasToken(set, alias);
  if (derived.protocol === 'i2c' && derived.sda && derived.scl) {
    addAliasToken(set, `${derived.sda}/${derived.scl}`);
    addAliasToken(set, `I2C${derived.sda}${derived.scl}`);
  }
  if ((derived.protocol === 'uart' || derived.protocol === 'rs485') && derived.tx && derived.rx) {
    addAliasToken(set, `${derived.tx}/${derived.rx}`);
  }
  return [...set];
}

function extractLookupTokens(value) {
  const out = new Set();
  const push = (candidate) => {
    const raw = String(candidate || '').trim().toUpperCase();
    if (!raw) return;
    addAliasToken(out, raw);
    raw.split(/[^A-Z0-9]+/).filter(Boolean).forEach(part => addAliasToken(out, part));
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return [...out].map(normalizeBoardToken).filter(Boolean);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj || null));
}

function deriveBoardPorts(profile) {
  const ports = [];
  const buses = [];
  if (Array.isArray(profile?.boardPorts)) {
    for (const raw of profile.boardPorts) {
      const gpio = parseGpio(raw.pin);
      ports.push({
        id: String(raw.id || raw.label || raw.source || (gpio !== null ? toGpioLabel(gpio) : '')).trim(),
        label: String(raw.label || raw.id || raw.source || (gpio !== null ? toGpioLabel(gpio) : 'Port')).trim(),
        group: String(raw.group || raw.kind || 'gpio').trim().toLowerCase(),
        role: String(raw.role || '').trim().toLowerCase() || null,
        pin: gpio !== null ? toGpioLabel(gpio) : (raw.pin ? String(raw.pin).trim().toUpperCase() : null),
        protocols: normalizeSupports(raw.protocols || []),
        supports: normalizeSupports(raw.supports || []),
        hint: String(raw.hint || '').trim() || null,
        range: raw.range || null,
        multi_instance: raw.multi_instance !== false,
        shared_bus: !!raw.shared_bus,
        aliases: [],
        meta: raw.meta || {},
      });
      ports[ports.length - 1].aliases = buildPortAliases(raw, ports[ports.length - 1]);
    }
  }
  if (Array.isArray(profile?.boardBuses)) {
    for (const raw of profile.boardBuses) {
      const protocol = String(raw.protocol || '').trim().toLowerCase();
      const bus = {
        id: String(raw.id || raw.label || protocol || 'bus').trim(),
        label: String(raw.label || raw.id || 'Bus').trim(),
        protocol,
        supports: normalizeSupports(raw.supports || []),
        addresses: (raw.addresses || []).map(a => String(a).trim().toLowerCase()).filter(Boolean),
        hint: String(raw.hint || '').trim() || null,
        shared_bus: raw.shared_bus !== false,
        aliases: [],
        meta: raw.meta || {},
      };
      if (protocol === 'i2c') {
        const sda = parseGpio(raw.sda);
        const scl = parseGpio(raw.scl);
        if (sda !== null) bus.sda = toGpioLabel(sda);
        if (scl !== null) bus.scl = toGpioLabel(scl);
      }
      if (raw.tx != null) {
        const tx = parseGpio(raw.tx);
        if (tx !== null) bus.tx = toGpioLabel(tx);
      }
      if (raw.rx != null) {
        const rx = parseGpio(raw.rx);
        if (rx !== null) bus.rx = toGpioLabel(rx);
      }
      bus.aliases = buildBusAliases(raw, bus);
      buses.push(bus);
    }
  }

  // Fallback buses from legacy profile fields.
  if (!buses.some(b => b.protocol === 'i2c')) {
    const rawI2c = profile?.i2c;
    const arr = Array.isArray(rawI2c) ? rawI2c : (rawI2c ? [rawI2c] : []);
    for (const raw of arr) {
      const sda = parseGpio(raw?.sda);
      const scl = parseGpio(raw?.scl);
      if (sda === null || scl === null) continue;
      buses.push({
        id: String(raw.id || `i2c_${buses.length + 1}`).trim(),
        label: String(raw.label || raw.id || `I²C ${buses.length + 1}`).trim(),
        protocol: 'i2c',
        supports: ['bh1750', 'sht3x', 'bme280', 'bmp280', 'veml7700', 'ina219', 'ccs811'],
        addresses: [],
        sda: toGpioLabel(sda),
        scl: toGpioLabel(scl),
        hint: raw.scan ? 'Shared scan-enabled I²C bus.' : 'Shared I²C bus.',
        shared_bus: true,
        aliases: [],
        meta: { derived: true },
      });
      buses[buses.length - 1].aliases = buildBusAliases(raw, buses[buses.length - 1]);
    }
  }

  // Fallback logical ports from entity defaults.
  const seenPortIds = new Set(ports.map(p => p.id));
  for (const e of Array.isArray(profile?.entityDefaults) ? profile.entityDefaults : []) {
    const pin = parseGpio(e.pin || e.source);
    if (pin === null) continue;
    const source = String(e.source || e.pin || '').trim().toUpperCase();
    const kind = String(e.type || '').trim().toLowerCase();
    let group = 'gpio';
    let supports = [];
    let protocols = ['gpio'];
    if (kind === 'analog') { group = 'ai'; supports = ['analog']; protocols = ['adc', 'gpio']; }
    else if (kind === 'pulse_counter') { group = 'di'; supports = ['pulse_counter']; protocols = ['gpio', 'di']; }
    else if (kind === 'ds18b20') { group = source.startsWith('HT') ? 'ht' : 'onewire'; supports = ['ds18b20']; protocols = ['onewire', 'gpio']; }
    else if (kind === 'dht' || kind === 'dht11') { group = source.startsWith('HT') ? 'ht' : 'gpio'; supports = [kind]; protocols = ['gpio']; }
    else continue;
    const portId = source || toGpioLabel(pin);
    if (seenPortIds.has(portId)) continue;
    ports.push({
      id: portId,
      label: source || toGpioLabel(pin),
      group,
      role: null,
      pin: toGpioLabel(pin),
      protocols,
      supports,
      hint: e.name || source || toGpioLabel(pin),
      range: null,
      multi_instance: kind === 'ds18b20',
      shared_bus: kind === 'ds18b20',
      aliases: [],
      meta: { derived: true },
    });
    ports[ports.length - 1].aliases = buildPortAliases(e, ports[ports.length - 1]);
    seenPortIds.add(portId);
  }

  // If a board has no logical ports, it falls back to generic GPIO mode.
  const portGroups = [];
  const groupSeen = new Set();
  for (const p of ports) {
    if (groupSeen.has(p.group)) continue;
    groupSeen.add(p.group);
    portGroups.push({ key: p.group, label: titleFromGroup(p.group), kind: 'port' });
  }
  for (const b of buses) {
    const key = String(b.protocol || 'bus').toLowerCase();
    if (groupSeen.has(key)) continue;
    groupSeen.add(key);
    portGroups.push({ key, label: titleFromGroup(key), kind: 'bus' });
  }

  return { ports, buses, portGroups };
}

function getPeripheralSpec(type) {
  return PERIPHERAL_MATRIX[String(type || '').trim().toLowerCase()] || null;
}

function filterBoardPorts(profile, type) {
  const spec = getPeripheralSpec(type);
  const derived = deriveBoardPorts(profile);
  if (!spec) return { ports: [], buses: [], portGroups: derived.portGroups };
  if (spec.mode === 'bus') {
    return {
      ports: [],
      buses: derived.buses.filter(b => {
        const proto = String(b.protocol || '').toLowerCase();
        if (!spec.busProtocols.includes(proto)) return false;
        if (!b.supports.length) return true;
        if (b.supports.includes(String(type).toLowerCase())) return true;
        if (proto === 'i2c' && ['bh1750','sht3x','bme280','bmp280','veml7700','ina219','ccs811'].includes(String(type).toLowerCase())) return true;
        if ((proto === 'uart' || proto === 'rs485') && ['mhz19','pzem004t'].includes(String(type).toLowerCase())) return true;
        return false;
      }),
      portGroups: derived.portGroups,
    };
  }
  const want = String(type || '').toLowerCase();
  return {
    ports: derived.ports.filter(p => (!p.supports.length || p.supports.includes(want)) && (!spec.protocols || !p.protocols.length || p.protocols.some(proto => spec.protocols.includes(proto)))),
    buses: [],
    portGroups: derived.portGroups,
  };
}

function findBoardPort(profile, portId) {
  const tokens = extractLookupTokens(portId);
  if (!tokens.length) return null;
  const wanted = new Set(tokens);
  return deriveBoardPorts(profile).ports.find(p =>
    [p.id, p.label, p.pin].concat(Array.isArray(p.aliases) ? p.aliases : [])
      .map(normalizeBoardToken)
      .filter(Boolean)
      .some(token => wanted.has(token))
  ) || null;
}

function findBoardBus(profile, busId) {
  const tokens = extractLookupTokens(busId);
  if (!tokens.length) return null;
  const wanted = new Set(tokens);
  return deriveBoardPorts(profile).buses.find(b =>
    [b.id, b.label].concat(Array.isArray(b.aliases) ? b.aliases : [])
      .map(normalizeBoardToken)
      .filter(Boolean)
      .some(token => wanted.has(token))
  ) || null;
}

function classToPortGroups(kind) {
  const upper = String(kind || '').trim().toUpperCase();
  if (upper === 'DO') return ['do'];
  if (upper === 'DI') return ['di'];
  if (upper === 'AO') return ['ao'];
  if (upper === 'AI') return ['ai', 'ht', 'onewire'];
  return [];
}

function matchBoardPathFromText(profile, rawText, opts = {}) {
  const runtime = deriveBoardPorts(profile);
  const tokens = extractLookupTokens(rawText);
  if (!tokens.length) return null;
  const wanted = new Set(tokens);
  const preferGroups = new Set(classToPortGroups(opts.entityClass || opts.kind));
  let best = null;

  const consider = (kind, item, aliasToken, score) => {
    if (!item || !aliasToken || score <= 0) return;
    if (!best || score > best.score) best = { kind, item, alias: aliasToken, score };
  };

  for (const port of runtime.ports) {
    const group = String(port.group || '').toLowerCase();
    const aliases = [port.id, port.label, port.pin].concat(Array.isArray(port.aliases) ? port.aliases : []);
    for (const alias of aliases) {
      const aliasToken = normalizeBoardToken(alias);
      if (!aliasToken || !wanted.has(aliasToken)) continue;
      let score = 100 + aliasToken.length;
      if (preferGroups.size && preferGroups.has(group)) score += 25;
      consider('port', port, aliasToken, score);
    }
  }

  for (const bus of runtime.buses) {
    const aliases = [bus.id, bus.label].concat(Array.isArray(bus.aliases) ? bus.aliases : []);
    for (const alias of aliases) {
      const aliasToken = normalizeBoardToken(alias);
      if (!aliasToken || !wanted.has(aliasToken)) continue;
      let score = 80 + aliasToken.length;
      if (String(opts.entityClass || '').trim().toUpperCase() === 'AI') score += 10;
      consider('bus', bus, aliasToken, score);
    }
  }

  if (!best) return null;
  if (best.kind === 'port') {
    return {
      kind: 'port',
      port: best.item,
      source: String(best.item.id || best.item.label || '').trim() || null,
      port_id: String(best.item.id || best.item.label || '').trim() || null,
      bus_id: null,
      score: best.score,
      alias: best.alias,
    };
  }
  return {
    kind: 'bus',
    bus: best.item,
    source: String(best.item.id || best.item.label || '').trim() || null,
    port_id: null,
    bus_id: String(best.item.id || best.item.label || '').trim() || null,
    score: best.score,
    alias: best.alias,
  };
}

function resolvePeripheralSelection(profile, rawEntity = {}) {
  const type = String(rawEntity.type || '').trim().toLowerCase();
  const spec = getPeripheralSpec(type);
  if (!spec) return { ok: false, error: 'unsupported_entity_type' };
  const warnings = [];
  if (spec.mode === 'bus') {
    const selectedBus = findBoardBus(profile, rawEntity.bus_id) || null;
    if (selectedBus) {
      return {
        ok: true,
        resolved: {
          ...clone(rawEntity),
          sda: selectedBus.sda,
          scl: selectedBus.scl,
          address: rawEntity.address,
          bus_id: selectedBus.id,
          allow_reserved_profile_bus: true,
        },
        selectedBus,
        warnings,
      };
    }
    return { ok: true, resolved: { ...clone(rawEntity) }, selectedBus: null, warnings };
  }
  const selectedPort = findBoardPort(profile, rawEntity.port_id) || null;
  if (selectedPort) {
    return {
      ok: true,
      resolved: {
        ...clone(rawEntity),
        pin: selectedPort.pin,
        port_id: selectedPort.id,
        allow_reserved_profile_port: true,
      },
      selectedPort,
      warnings,
    };
  }
  return { ok: true, resolved: { ...clone(rawEntity) }, selectedPort: null, warnings };
}

module.exports = {
  PERIPHERAL_MATRIX,
  deriveBoardPorts,
  getPeripheralSpec,
  filterBoardPorts,
  findBoardPort,
  findBoardBus,
  matchBoardPathFromText,
  resolvePeripheralSelection,
};
