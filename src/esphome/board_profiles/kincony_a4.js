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
