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
