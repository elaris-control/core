// Source: https://devices.esphome.io/devices/kincony-kc868-a32/
// LAN8720 Ethernet, dual I2C buses, 8x PCF8574, 4 ADC inputs
module.exports = {
  id: 'kincony_kc868_a32',
  label: 'KinCony KC868-A32 (32 relay / 32 DI)',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'arduino',
  supports: { usb: true, ota: true, wifi: true, ethernet: true },
  notes: [
    'LAN8720 Ethernet (MDC=23, MDIO=18, CLK=17).',
    'Dual I2C: bus_a (SDA=15/SCL=13) for relay expanders, bus_b (SDA=4/SCL=5) for input expanders.',
    'Relay PCF8574: 0x24, 0x25, 0x21, 0x22 on bus_a.',
    'Input PCF8574: 0x24, 0x25, 0x21, 0x22 on bus_b.',
    '4 ADC analog inputs on GPIO39, GPIO34, GPIO36, GPIO35.',
    'Source: devices.esphome.io/devices/kincony-kc868-a32/',
  ],
  ethernet: {
    type: 'LAN8720',
    mdc_pin: 23,
    mdio_pin: 18,
    clk: { mode: 'CLK_OUT', pin: 17 },
    phy_addr: 0,
  },
  // Dual I2C buses
  i2c: [
    { sda: 15, scl: 13, scan: true, id: 'bus_a' },
    { sda: 4,  scl: 5,  scan: true, id: 'bus_b' },
  ],
  pcf8574: [
    // Relay expanders on bus_a
    { id: 'pcf8574_hub_out_1', address: '0x24', i2c_id: 'bus_a' },
    { id: 'pcf8574_hub_out_2', address: '0x25', i2c_id: 'bus_a' },
    { id: 'pcf8574_hub_out_3', address: '0x21', i2c_id: 'bus_a' },
    { id: 'pcf8574_hub_out_4', address: '0x22', i2c_id: 'bus_a' },
    // Input expanders on bus_b
    { id: 'pcf8574_hub_in_1', address: '0x24', i2c_id: 'bus_b' },
    { id: 'pcf8574_hub_in_2', address: '0x25', i2c_id: 'bus_b' },
    { id: 'pcf8574_hub_in_3', address: '0x21', i2c_id: 'bus_b' },
    { id: 'pcf8574_hub_in_4', address: '0x22', i2c_id: 'bus_b' },
  ],
  pinRules: {
    reserved: [4, 5, 13, 15, 17, 18, 23],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [
    // 32 relays via 4x PCF8574 on bus_a
    ...Array.from({ length: 32 }, (_, i) => ({
      key: `relay_${i + 1}`,
      name: `Relay ${i + 1}`,
      type: 'relay',
      source: `OUT${i + 1}`,
      pcf8574: `pcf8574_hub_out_${Math.floor(i / 8) + 1}`,
      number: i % 8,
      mode: 'OUTPUT',
      inverted: true,
    })),
    // 32 digital inputs via 4x PCF8574 on bus_b
    ...Array.from({ length: 32 }, (_, i) => ({
      key: `di_${i + 1}`,
      name: `DI ${i + 1}`,
      type: 'di',
      source: `IN${i + 1}`,
      pcf8574: `pcf8574_hub_in_${Math.floor(i / 8) + 1}`,
      number: i % 8,
      mode: 'INPUT',
      inverted: true,
    })),
    // 4 ADC analog inputs
    { key: 'ai_1', name: 'Analog 1', type: 'analog', source: 'AI1', pin: 'GPIO39' },
    { key: 'ai_2', name: 'Analog 2', type: 'analog', source: 'AI2', pin: 'GPIO34' },
    { key: 'ai_3', name: 'Analog 3', type: 'analog', source: 'AI3', pin: 'GPIO36' },
    { key: 'ai_4', name: 'Analog 4', type: 'analog', source: 'AI4', pin: 'GPIO35' },
  ],
  resolveSource(source) {
    const s = String(source || '').trim().toUpperCase();
    return this.entityDefaults.find(e => e.source === s) || null;
  },
};
