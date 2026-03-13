// Source: https://devices.esphome.io/devices/kincony-kc868-a8/
// LAN8720 Ethernet, PCF8574 expanders, DS18B20 on GPIO14
module.exports = {
  id: 'kincony_kc868_a8',
  label: 'KinCony KC868-A8 (8 relay / 8 DI)',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'arduino',
  supports: { usb: true, ota: true, wifi: true, ethernet: true },
  notes: [
    'LAN8720 Ethernet (MDC=23, MDIO=18, CLK=17).',
    'Relays via PCF8574 at 0x24. Inputs via PCF8574 at 0x22.',
    'Extra GPIO inputs: GPIO32 (S3), GPIO33 (S4).',
    'DS18B20 1-Wire temperature sensor on GPIO14.',
    'Source: devices.esphome.io/devices/kincony-kc868-a8/',
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
    { id: 'pcf8574_hub_out_1', address: '0x24' },
    { id: 'pcf8574_hub_in_1',  address: '0x22' },
  ],
  pinRules: {
    reserved: [4, 5, 14, 17, 18, 23],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [
    // 8 relays via PCF8574 0x24
    ...Array.from({ length: 8 }, (_, i) => ({
      key: `relay_${i + 1}`,
      name: `Relay ${i + 1}`,
      type: 'relay',
      source: `OUT${i + 1}`,
      pcf8574: 'pcf8574_hub_out_1',
      number: i,
      mode: 'OUTPUT',
      inverted: true,
    })),
    // 8 digital inputs via PCF8574 0x22
    ...Array.from({ length: 8 }, (_, i) => ({
      key: `di_${i + 1}`,
      name: `DI ${i + 1}`,
      type: 'di',
      source: `IN${i + 1}`,
      pcf8574: 'pcf8574_hub_in_1',
      number: i,
      mode: 'INPUT',
      inverted: true,
    })),
    // 2 extra direct GPIO inputs
    { key: 'di_9',  name: 'DI 9 (S3)',  type: 'di', source: 'IN9',  pin: 'GPIO32', inverted: true },
    { key: 'di_10', name: 'DI 10 (S4)', type: 'di', source: 'IN10', pin: 'GPIO33', inverted: true },
    // DS18B20 temperature sensor
    { key: 'ds18b20_1', name: 'Temperature 1', type: 'ds18b20', source: 'DS1', pin: 'GPIO14', index: 0 },
  ],
  resolveSource(source) {
    const s = String(source || '').trim().toUpperCase();
    return this.entityDefaults.find(e => e.source === s) || null;
  },
};
