const yaml = require('js-yaml');

/**
 * Parse an ESPHome YAML config and extract a board profile definition.
 * Handles: switch→relay, binary_sensor→DI, sensor→AI/temp/hum, output→AO
 * Handles: direct GPIO, pcf8574 expander channels, i2c, ethernet (LAN8720)
 */
function parseEsphomeYaml(yamlText) {
  // Resolve ESPHome substitutions (e.g. ${name} → value)
  const subsMatch = yamlText.match(/^substitutions:\s*\n((?:[ \t]+\S.*\n?)*)/m);
  if (subsMatch) {
    const subsLines = subsMatch[1].split('\n');
    const subs = {};
    for (const line of subsLines) {
      const m = line.match(/^\s+(\w+)\s*:\s*(.+)/);
      if (m) subs[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    for (const [k, v] of Object.entries(subs)) {
      yamlText = yamlText.replace(new RegExp('\\$\\{' + k + '\\}', 'g'), v);
    }
  }

  let doc;
  try {
    doc = yaml.load(yamlText);
  } catch (e) {
    throw new Error('Invalid YAML: ' + e.message);
  }
  if (!doc || typeof doc !== 'object') throw new Error('Empty or invalid ESPHome YAML');

  const result = {
    id: '',
    label: '',
    board: 'esp32dev',
    platform: 'esp32',
    frameworkDefault: 'arduino',
    supports: { usb: true, ota: true, wifi: true, ethernet: false },
    notes: [],
    pinRules: {
      reserved: [],
      inputOnly: [34, 35, 36, 39],
      noPullup: [34, 35, 36, 39],
      flashPins: [6, 7, 8, 9, 10, 11],
      strapping: [0, 2, 5, 12, 15],
    },
    entityDefaults: [],
    i2c: null,
    pcf8574: [],
    ethernet: null,
  };

  // ── esphome block ────────────────────────────────────────────────────────
  if (doc.esphome) {
    const name = doc.esphome.name || doc.esphome.friendly_name || '';
    result.id = safeName(name);
    result.label = doc.esphome.friendly_name || doc.esphome.name || '';
  }

  // ── esp32 / esp8266 block ────────────────────────────────────────────────
  const espBlock = doc.esp32 || doc.esp8266 || doc.esp32s2 || doc.esp32c3 || {};
  if (espBlock.board) result.board = espBlock.board;
  result.platform = doc.esp32 ? 'esp32' : doc.esp8266 ? 'esp8266' : 'esp32';
  if (espBlock.framework) {
    const fw = espBlock.framework;
    result.frameworkDefault = typeof fw === 'string' ? fw : (fw.type || 'arduino');
  }

  // ── ethernet ─────────────────────────────────────────────────────────────
  if (doc.ethernet) {
    const eth = doc.ethernet;
    result.supports.ethernet = true;
    result.ethernet = {
      type: eth.type || 'LAN8720',
      mdc_pin: parsePin(eth.mdc_pin),
      mdio_pin: parsePin(eth.mdio_pin),
      phy_addr: eth.phy_addr ?? 0,
      clk: eth.clk_mode ? { mode: eth.clk_mode, pin: parsePin(eth.power_pin) } : undefined,
    };
    const reserved = [result.ethernet.mdc_pin, result.ethernet.mdio_pin].filter(Number.isFinite);
    result.pinRules.reserved.push(...reserved);
  }

  // ── i2c ──────────────────────────────────────────────────────────────────
  const i2cBlock = Array.isArray(doc.i2c) ? doc.i2c[0] : doc.i2c;
  if (i2cBlock) {
    result.i2c = {
      sda: parsePin(i2cBlock.sda),
      scl: parsePin(i2cBlock.scl),
      scan: i2cBlock.scan !== false,
      id: i2cBlock.id || 'bus_a',
    };
    const reserved = [result.i2c.sda, result.i2c.scl].filter(Number.isFinite);
    result.pinRules.reserved.push(...reserved);
  }

  // ── pcf8574 expanders ────────────────────────────────────────────────────
  const pcfBlocks = toArray(doc.pcf8574);
  for (const pcf of pcfBlocks) {
    if (pcf && pcf.id) {
      result.pcf8574.push({
        id: pcf.id,
        address: typeof pcf.address === 'number'
          ? '0x' + pcf.address.toString(16).padStart(2, '0')
          : String(pcf.address || ''),
      });
    }
  }

  // ── switches → relay ─────────────────────────────────────────────────────
  let relayIdx = 0;
  for (const sw of toArray(doc.switch)) {
    if (!sw || sw.platform === 'restart' || sw.platform === 'safe_mode' || sw.platform === 'uart') continue;
    relayIdx++;
    const entity = {
      key: `relay_${relayIdx}`,
      name: sw.name || `Relay ${relayIdx}`,
      type: 'relay',
      source: `OUT${relayIdx}`,
      inverted: sw.inverted === true,
    };
    // PCF8574 can be at sw.pcf8574 OR nested under sw.pin.pcf8574
    const swPcf = sw.pcf8574 || sw.pin?.pcf8574;
    const swNum = sw.number ?? sw.pin?.number;
    if (swPcf) {
      entity.pcf8574 = swPcf;
      entity.number = swNum ?? (relayIdx - 1);
      entity.mode = 'OUTPUT';
      entity.inverted = sw.inverted ?? sw.pin?.inverted ?? false;
    } else {
      const pin = resolvePin(sw.pin);
      entity.pin = pin.label;
      if (pin.num !== null) entity.source = pin.label;
    }
    result.entityDefaults.push(entity);
  }

  // ── binary_sensor → DI ───────────────────────────────────────────────────
  let diIdx = 0;
  for (const bs of toArray(doc.binary_sensor)) {
    if (!bs || bs.platform === 'status' || bs.platform === 'template') continue;
    diIdx++;
    const entity = {
      key: `di_${diIdx}`,
      name: bs.name || `DI ${diIdx}`,
      type: 'di',
      source: `IN${diIdx}`,
      inverted: bs.inverted === true,
    };
    const bsPcf = bs.pcf8574 || bs.pin?.pcf8574;
    const bsNum = bs.number ?? bs.pin?.number;
    if (bsPcf) {
      entity.pcf8574 = bsPcf;
      entity.number = bsNum ?? (diIdx - 1);
      entity.inverted = bs.inverted ?? bs.pin?.inverted ?? false;
      entity.mode = 'INPUT';
    } else {
      const pin = resolvePin(bs.pin);
      entity.pin = pin.label;
      if (pin.num !== null) entity.source = pin.label;
    }
    result.entityDefaults.push(entity);
  }

  // ── sensor → AI / ds18b20 / dht ─────────────────────────────────────────
  let aiIdx = 0;
  let dsIdx = 0;
  for (const s of toArray(doc.sensor)) {
    if (!s || !s.platform) continue;
    const plat = String(s.platform).toLowerCase();

    if (plat === 'adc') {
      aiIdx++;
      const pin = resolvePin(s.pin);
      result.entityDefaults.push({
        key: `ai_${aiIdx}`,
        name: s.name || `Analog Input ${aiIdx}`,
        type: 'analog',
        source: pin.label || `AI${aiIdx}`,
        pin: pin.label,
      });
    } else if (plat === 'dallas' || plat === 'dallas_temp') {
      dsIdx++;
      result.entityDefaults.push({
        key: `ds18b20_${dsIdx}`,
        name: s.name || `Temperature ${dsIdx}`,
        type: 'ds18b20',
        source: `DS${dsIdx}`,
        address: s.address,
        index: s.index ?? dsIdx - 1,
      });
    } else if (plat === 'dht') {
      const pin = resolvePin(s.pin);
      result.entityDefaults.push({
        key: 'dht_temp',
        name: s.name || 'Temperature',
        type: 'dht',
        source: pin.label || 'DHT',
        pin: pin.label,
        model: s.model || 'DHT22',
      });
    }
  }

  // ── output → AO ──────────────────────────────────────────────────────────
  let aoIdx = 0;
  for (const out of toArray(doc.output)) {
    if (!out) continue;
    const plat = String(out.platform || '').toLowerCase();
    if (plat === 'ledc' || plat === 'sigma_delta' || plat === 'slow_pwm') {
      aoIdx++;
      const pin = resolvePin(out.pin);
      result.entityDefaults.push({
        key: `ao_${aoIdx}`,
        name: out.id ? out.id.replace(/_/g, ' ') : `Analog Output ${aoIdx}`,
        type: 'ao',
        source: pin.label || `AO${aoIdx}`,
        pin: pin.label,
      });
    }
  }

  // ── dedupe pinRules.reserved ─────────────────────────────────────────────
  result.pinRules.reserved = [...new Set(result.pinRules.reserved)].filter(Number.isFinite);

  // ── clean up empty optional fields ───────────────────────────────────────
  if (!result.i2c) delete result.i2c;
  if (!result.pcf8574.length) delete result.pcf8574;
  if (!result.ethernet) delete result.ethernet;

  return result;
}

// ── helpers ───────────────────────────────────────────────────────────────

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function safeName(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// parsePin('GPIO26') → 26, parsePin(26) → 26, parsePin('34') → 34
function parsePin(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const m = String(val).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// resolvePin handles both string 'GPIO26' and object { number: 26, ... }
function resolvePin(pinVal) {
  if (!pinVal && pinVal !== 0) return { num: null, label: '' };
  if (typeof pinVal === 'number') return { num: pinVal, label: `GPIO${pinVal}` };
  if (typeof pinVal === 'string') {
    const n = parsePin(pinVal);
    return { num: n, label: pinVal.toUpperCase().startsWith('GPIO') ? pinVal.toUpperCase() : (n !== null ? `GPIO${n}` : pinVal) };
  }
  // object form: { number: 26, mode: INPUT_PULLUP, ... }
  if (typeof pinVal === 'object') {
    const n = parsePin(pinVal.number ?? pinVal.gpio ?? pinVal.pin);
    return { num: n, label: n !== null ? `GPIO${n}` : '' };
  }
  return { num: null, label: '' };
}

module.exports = { parseEsphomeYaml };
