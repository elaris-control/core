'use strict';

const { safeName, parseGpio, toGpioLabel } = require('./schema');

function uniqStrings(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map(v => String(v || '').trim())
    .filter(Boolean))];
}

function uniqLower(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map(v => String(v || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizePinLike(value) {
  const n = parseGpio(value);
  if (n !== null) return toGpioLabel(n);
  const raw = String(value || '').trim();
  return raw ? raw.toUpperCase() : null;
}

function boolish(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !!value;
}

function normalizeSupportsObject(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    usb: src.usb !== false,
    ota: src.ota !== false,
    wifi: src.wifi !== false,
    ethernet: !!src.ethernet,
  };
}

function normalizeNotes(raw) {
  if (Array.isArray(raw)) return raw.map(v => String(v || '').trim()).filter(Boolean);
  return String(raw || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizePinRules(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const mapNums = (arr) => [...new Set((Array.isArray(arr) ? arr : [])
    .map(v => parseGpio(v))
    .filter(v => Number.isFinite(v)))];
  return {
    reserved: mapNums(src.reserved),
    inputOnly: mapNums(src.inputOnly),
    noPullup: mapNums(src.noPullup),
    flashPins: mapNums(src.flashPins),
    strapping: mapNums(src.strapping),
  };
}

function normalizeBoardPort(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = String(src.id || src.label || `PORT${index + 1}`).trim();
  if (!id) return null;
  return {
    id,
    label: String(src.label || id).trim(),
    group: String(src.group || src.kind || 'gpio').trim().toLowerCase() || 'gpio',
    role: String(src.role || '').trim().toLowerCase() || null,
    pin: normalizePinLike(src.pin),
    protocols: uniqLower(src.protocols),
    supports: uniqLower(src.supports),
    hint: String(src.hint || '').trim() || null,
    range: src.range ? String(src.range).trim() : null,
    multi_instance: boolish(src.multi_instance, true),
    shared_bus: !!src.shared_bus,
    aliases: uniqStrings(src.aliases).map(v => v.toUpperCase()),
    meta: src.meta && typeof src.meta === 'object' ? src.meta : {},
  };
}

function normalizeBoardBus(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const protocol = String(src.protocol || 'i2c').trim().toLowerCase() || 'i2c';
  const id = String(src.id || src.label || `bus_${index + 1}`).trim();
  if (!id) return null;
  const bus = {
    id,
    label: String(src.label || id).trim(),
    protocol,
    supports: uniqLower(src.supports),
    addresses: uniqLower(src.addresses),
    hint: String(src.hint || '').trim() || null,
    shared_bus: src.shared_bus !== false,
    aliases: uniqStrings(src.aliases).map(v => v.toUpperCase()),
    meta: src.meta && typeof src.meta === 'object' ? src.meta : {},
  };
  if (src.sda != null) bus.sda = normalizePinLike(src.sda);
  if (src.scl != null) bus.scl = normalizePinLike(src.scl);
  if (src.tx != null) bus.tx = normalizePinLike(src.tx);
  if (src.rx != null) bus.rx = normalizePinLike(src.rx);
  return bus;
}

function normalizeEntityDefault(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const type = String(src.type || '').trim().toLowerCase();
  if (!type) return null;
  const name = String(src.name || `Entity ${index + 1}`).trim() || `Entity ${index + 1}`;
  const key = safeName(src.key || name || `entity_${index + 1}`) || `entity_${index + 1}`;
  const source = String(src.source || src.pin || '').trim().toUpperCase();
  const item = {
    key,
    name,
    type,
    source: source || undefined,
  };
  const pin = normalizePinLike(src.pin);
  if (pin) item.pin = pin;
  if (src.port_id) item.port_id = String(src.port_id).trim();
  if (src.bus_id) item.bus_id = String(src.bus_id).trim();
  if (src.pcf8574) item.pcf8574 = String(src.pcf8574).trim();
  if (src.number !== undefined && src.number !== null && src.number !== '') item.number = Number(src.number);
  if (src.mode) item.mode = String(src.mode).trim().toUpperCase();
  if (src.inverted !== undefined) item.inverted = !!src.inverted;
  if (src.address) item.address = String(src.address).trim().toLowerCase();
  if (src.index !== undefined && src.index !== null && src.index !== '') item.index = Number(src.index);
  if (src.model) item.model = String(src.model).trim();
  if (src.unit) item.unit = String(src.unit).trim();
  if (src.device_class) item.device_class = String(src.device_class).trim();
  if (src.subtype) item.subtype = String(src.subtype).trim();
  if (src.metadata && typeof src.metadata === 'object') item.metadata = src.metadata;
  return item;
}

function normalizeI2c(raw) {
  if (!raw) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const mapped = list.map((item, idx) => {
    const bus = normalizeBoardBus({ ...item, protocol: 'i2c' }, idx);
    if (!bus) return null;
    return {
      id: bus.id,
      label: bus.label,
      sda: bus.sda,
      scl: bus.scl,
      scan: item.scan !== false,
    };
  }).filter(Boolean);
  if (!mapped.length) return undefined;
  return mapped.length === 1 ? mapped[0] : mapped;
}

function normalizePcf(raw) {
  return (Array.isArray(raw) ? raw : []).map((item, idx) => {
    const id = String(item?.id || `pcf_${idx + 1}`).trim();
    const address = String(item?.address || '').trim().toLowerCase();
    if (!id || !address) return null;
    const out = { id, address };
    if (item.i2c_id) out.i2c_id = String(item.i2c_id).trim();
    return out;
  }).filter(Boolean);
}

function normalizeEthernet(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {
    type: String(raw.type || 'LAN8720').trim(),
    phy_addr: Number.isFinite(Number(raw.phy_addr)) ? Number(raw.phy_addr) : 0,
  };
  const mdc = parseGpio(raw.mdc_pin);
  const mdio = parseGpio(raw.mdio_pin);
  if (mdc !== null) out.mdc_pin = mdc;
  if (mdio !== null) out.mdio_pin = mdio;
  if (raw.clk && typeof raw.clk === 'object') {
    out.clk = { mode: String(raw.clk.mode || '').trim() || 'CLK_OUT' };
    const clkPin = parseGpio(raw.clk.pin);
    if (clkPin !== null) out.clk.pin = clkPin;
  }
  return out;
}

function normalizeProfileDefinition(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = safeName(src.id || src.label || 'custom_board_profile');
  if (!id) throw new Error('profile_id_required');
  const label = String(src.label || id).trim() || id;
  const boardPorts = (Array.isArray(src.boardPorts) ? src.boardPorts : []).map(normalizeBoardPort).filter(Boolean);
  const boardBuses = (Array.isArray(src.boardBuses) ? src.boardBuses : []).map(normalizeBoardBus).filter(Boolean);
  const entityDefaults = (Array.isArray(src.entityDefaults) ? src.entityDefaults : []).map(normalizeEntityDefault).filter(Boolean);

  const definition = {
    id,
    label,
    board: String(src.board || 'esp32dev').trim() || 'esp32dev',
    platform: String(src.platform || 'esp32').trim() || 'esp32',
    frameworkDefault: String(src.frameworkDefault || src.framework_default || 'arduino').trim() || 'arduino',
    supports: normalizeSupportsObject(src.supports),
    notes: normalizeNotes(src.notes),
    boardPorts,
    boardBuses,
    pinRules: normalizePinRules(src.pinRules),
    entityDefaults,
  };

  const ethernet = normalizeEthernet(src.ethernet);
  if (ethernet) definition.ethernet = ethernet;
  const i2c = normalizeI2c(src.i2c || src.boardBuses?.filter?.(b => String(b?.protocol || '').toLowerCase() === 'i2c'));
  if (i2c) definition.i2c = i2c;
  const pcf8574 = normalizePcf(src.pcf8574);
  if (pcf8574.length) definition.pcf8574 = pcf8574;

  return definition;
}

module.exports = {
  normalizeProfileDefinition,
  normalizeBoardPort,
  normalizeBoardBus,
  normalizeEntityDefault,
};
