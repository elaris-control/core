module.exports = {
  id: 'wt32_eth01',
  label: 'WT32-ETH01 (ESP32 + LAN8720)',
  board: 'wt32-eth01',
  platform: 'esp32',
  frameworkDefault: 'esp-idf',
  supports: { usb: true, ota: true, wifi: true, ethernet: true },
  notes: [
    'Ethernet-capable generic profile for WT32-ETH01.',
    'No board-specific channel preset is applied.',
  ],
  ethernet: {
    type: 'LAN8720',
    mdc_pin: 23,
    mdio_pin: 18,
    clk: { mode: 'CLK_IN', pin: 0 },
    phy_addr: 1,
  },
  boardBuses: [
    { id: 'i2c_default', label: 'Custom I²C Bus', protocol: 'i2c', supports: ['bh1750', 'sht3x', 'bme280', 'bmp280', 'veml7700', 'ina219', 'ccs811'], addresses: ['0x23', '0x5c', '0x44', '0x45'], hint: 'Manual SDA/SCL selection for external sensors.' },
  ],
  pinRules: {
    reserved: [0, 18, 23],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 4, 5, 12, 15],
  },
  entityDefaults: [],
  resolveSource() { return null; },
};
