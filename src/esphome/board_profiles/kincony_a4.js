// Source: https://devices.esphome.io/devices/kincony-kc868-a4/
// Direct GPIO — no I2C expander, WiFi only
module.exports = {
  id: 'kincony_kc868_a4',
  label: 'KinCony KC868-A4 (4 relay / 4 DI)',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'arduino',
  supports: { usb: true, ota: true, wifi: true, ethernet: false },
  notes: [
    'WiFi only (no Ethernet).',
    'Direct GPIO — no I2C expander.',
    'Source: devices.esphome.io/devices/kincony-kc868-a4/',
  ],
  boardPorts: [
    { id: 'DO1', label: 'DO1', group: 'do', pin: 'GPIO2', protocols: ['do'], supports: [], aliases: ['OUT1'], hint: 'Relay output 1.' },
    { id: 'DO2', label: 'DO2', group: 'do', pin: 'GPIO15', protocols: ['do'], supports: [], aliases: ['OUT2'], hint: 'Relay output 2.' },
    { id: 'DO3', label: 'DO3', group: 'do', pin: 'GPIO5', protocols: ['do'], supports: [], aliases: ['OUT3'], hint: 'Relay output 3.' },
    { id: 'DO4', label: 'DO4', group: 'do', pin: 'GPIO4', protocols: ['do'], supports: [], aliases: ['OUT4'], hint: 'Relay output 4.' },
    { id: 'DI1', label: 'DI1', group: 'di', pin: 'GPIO36', protocols: ['gpio', 'di'], supports: ['pulse_counter'], aliases: ['IN1'], hint: 'Digital input 1.' },
    { id: 'DI2', label: 'DI2', group: 'di', pin: 'GPIO39', protocols: ['gpio', 'di'], supports: ['pulse_counter'], aliases: ['IN2'], hint: 'Digital input 2.' },
    { id: 'DI3', label: 'DI3', group: 'di', pin: 'GPIO27', protocols: ['gpio', 'di'], supports: ['pulse_counter'], aliases: ['IN3'], hint: 'Digital input 3.' },
    { id: 'DI4', label: 'DI4', group: 'di', pin: 'GPIO14', protocols: ['gpio', 'di'], supports: ['pulse_counter'], aliases: ['IN4'], hint: 'Digital input 4.' },
  ],
  pinRules: {
    reserved: [],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [
    { key: 'relay_1', name: 'Relay 1', type: 'relay', source: 'OUT1', pin: 'GPIO2'  },
    { key: 'relay_2', name: 'Relay 2', type: 'relay', source: 'OUT2', pin: 'GPIO15' },
    { key: 'relay_3', name: 'Relay 3', type: 'relay', source: 'OUT3', pin: 'GPIO5'  },
    { key: 'relay_4', name: 'Relay 4', type: 'relay', source: 'OUT4', pin: 'GPIO4'  },
    { key: 'di_1', name: 'DI 1', type: 'di', source: 'IN1', pin: 'GPIO36' },
    { key: 'di_2', name: 'DI 2', type: 'di', source: 'IN2', pin: 'GPIO39' },
    { key: 'di_3', name: 'DI 3', type: 'di', source: 'IN3', pin: 'GPIO27' },
    { key: 'di_4', name: 'DI 4', type: 'di', source: 'IN4', pin: 'GPIO14' },
  ],
  resolveSource(source) {
    const s = String(source || '').trim().toUpperCase();
    return this.entityDefaults.find(e => e.source === s) || null;
  },
};
