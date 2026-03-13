// Source: https://devices.esphome.io/devices/kincony-kc868-a16/
// LAN8720 Ethernet, 4x PCF8574, RS485, IR, 3 GPIO HT sensor ports
module.exports = {
  id: 'kincony_kc868_a16',
  label: 'KinCony KC868-A16 (16 relay / 16 DI)',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'esp-idf',
  supports: { usb: true, ota: true, wifi: true, ethernet: true },
  notes: [
    'LAN8720 Ethernet (MDC=23, MDIO=18, CLK=17).',
    'Relays via PCF8574 0x24 (Y01-Y08) and 0x25 (Y09-Y16).',
    'Inputs via PCF8574 0x22 (X01-X08) and 0x21 (X09-X16).',
    'GPIO32/GPIO33/GPIO14: HT sensor ports (DS18B20 / DHT11).',
    'RS485 UART on GPIO13 (TX) / GPIO16 (RX).',
    'Source: devices.esphome.io/devices/kincony-kc868-a16/',
  ],
  ethernet: {
    type: 'LAN8720',
    mdc_pin: 23,
    mdio_pin: 18,
    clk: { mode: 'CLK_OUT', pin: 17 },
    phy_addr: 0,
  },
  i2c: { sda: 4, scl: 5, scan: true, id: 'bus_a' },
  pcf8574: [
    { id: 'outputs_1_8',  address: '0x24' },
    { id: 'outputs_9_16', address: '0x25' },
    { id: 'inputs_1_8',   address: '0x22' },
    { id: 'inputs_9_16',  address: '0x21' },
  ],
  pinRules: {
    reserved: [4, 5, 13, 16, 17, 18, 23],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [
    // 16 relays via 2x PCF8574
    ...Array.from({ length: 16 }, (_, i) => ({
      key: `relay_${i + 1}`,
      name: `Relay ${i + 1}`,
      type: 'relay',
      source: `OUT${i + 1}`,
      pcf8574: i < 8 ? 'outputs_1_8' : 'outputs_9_16',
      number: i % 8,
      mode: 'OUTPUT',
      inverted: true,
    })),
    // 16 digital inputs via 2x PCF8574
    ...Array.from({ length: 16 }, (_, i) => ({
      key: `di_${i + 1}`,
      name: `DI ${i + 1}`,
      type: 'di',
      source: `IN${i + 1}`,
      pcf8574: i < 8 ? 'inputs_1_8' : 'inputs_9_16',
      number: i % 8,
      mode: 'INPUT',
      inverted: true,
    })),
    // 3 GPIO HT sensor ports (DS18B20 / DHT11)
    { key: 'ht_1', name: 'HT Sensor Port 1', type: 'ds18b20', source: 'HT1', pin: 'GPIO32', index: 0 },
    { key: 'ht_2', name: 'HT Sensor Port 2', type: 'ds18b20', source: 'HT2', pin: 'GPIO33', index: 0 },
    { key: 'ht_3', name: 'HT Sensor Port 3', type: 'ds18b20', source: 'HT3', pin: 'GPIO14', index: 0 },
  ],
  resolveSource(source) {
    const s = String(source || '').trim().toUpperCase();
    return this.entityDefaults.find(e => e.source === s) || null;
  },
};
