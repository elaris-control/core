const dis = Array.from({ length: 16 }, (_, i) => ({
  key: `di_${i + 1}`,
  name: `DI ${i + 1}`,
  type: 'di',
  source: `IN${i + 1}`,
  pcf8574: i < 8 ? 'pcf8574_hub_in_1' : 'pcf8574_hub_in_2',
  number: i % 8,
  mode: 'INPUT',
  inverted: true,
}));

module.exports = {
  id: 'kincony_kc868_e16s',
  label: 'KinCony KC868-E16S (Ethernet + 16 DI)',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'arduino',
  supports: { usb: true, ota: true, wifi: true, ethernet: true },
  notes: [
    'Validated as Ethernet-first profile with logical IN1-IN16 channels.',
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
    { id: 'pcf8574_hub_in_1', address: '0x22' },
    { id: 'pcf8574_hub_in_2', address: '0x23' },
  ],
  pinRules: {
    reserved: [4, 5, 17, 18, 23],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [...dis],
  resolveSource(source) {
    const s = String(source || '').trim().toUpperCase();
    return this.entityDefaults.find(e => e.source === s) || null;
  },
};
