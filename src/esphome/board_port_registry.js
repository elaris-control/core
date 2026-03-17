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
        aliases: [...new Set((raw.aliases || []).map(v => String(v || '').trim().toUpperCase()).filter(Boolean))],
        meta: raw.meta || {},
      });
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
        aliases: [...new Set((raw.aliases || []).map(v => String(v || '').trim().toUpperCase()).filter(Boolean))],
        aliases: [...new Set((raw.aliases || []).map(v => String(v || '').trim().toUpperCase()).filter(Boolean))],
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
        meta: { derived: true },
      });
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
      meta: { derived: true },
    });
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
  const id = String(portId || '').trim().toUpperCase();
  if (!id) return null;
  return deriveBoardPorts(profile).ports.find(p =>
    String(p.id || '').trim().toUpperCase() === id ||
    String(p.label || '').trim().toUpperCase() === id ||
    (Array.isArray(p.aliases) && p.aliases.includes(id))
  ) || null;
}

function findBoardBus(profile, busId) {
  const id = String(busId || '').trim().toUpperCase();
  if (!id) return null;
  return deriveBoardPorts(profile).buses.find(b =>
    String(b.id || '').trim().toUpperCase() === id ||
    String(b.label || '').trim().toUpperCase() === id ||
    (Array.isArray(b.aliases) && b.aliases.includes(id))
  ) || null;
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
  resolvePeripheralSelection,
};
