module.exports = {
  id: 'generic_esp32dev',
  label: 'Generic ESP32 DevKit',
  board: 'esp32dev',
  platform: 'esp32',
  frameworkDefault: 'esp-idf',
  supports: { usb: true, ota: true, wifi: true, ethernet: false },
  notes: [
    'Generic profile: use raw GPIO pins carefully.',
    'Validator blocks flash pins and output-on-input-only mistakes.',
  ],
  boardBuses: [
    { id: 'i2c_default', label: 'Custom I²C Bus', protocol: 'i2c', supports: ['bh1750', 'sht3x', 'bme280', 'bmp280', 'veml7700', 'ina219', 'ccs811'], addresses: ['0x23', '0x5c', '0x44', '0x45'], hint: 'Manual SDA/SCL selection.' },
  ],
  pinRules: {
    reserved: [],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  entityDefaults: [],
  resolveSource() { return null; },
};
