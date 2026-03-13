module.exports = [
  {
    id: 'generic_esp32_devkit',
    label: 'ESP32 DevKit V1',
    boardId: 'esp32dev',
    platform: 'esp32',
    frameworkDefault: 'arduino',
    supports: { usb: true, ota: true, ethernet: false, wifi: true },
    pinRules: {
      inputOnly: [34, 35, 36, 39],
      noPullup: [34, 35, 36, 39],
      flashPins: [6, 7, 8, 9, 10, 11],
      strappingPins: [0, 2, 5, 12, 15],
      ethernetReservedPins: []
    },
    notes: ['Generic ESP32 profile. Use raw GPIO pins carefully.']
  },
  {
    id: 'wt32_eth01',
    label: 'WT32-ETH01 (ESP32 + LAN8720)',
    boardId: 'wt32-eth01',
    platform: 'esp32',
    frameworkDefault: 'arduino',
    supports: { usb: true, ota: true, ethernet: true, wifi: true },
    networkDefaults: { ethernet: true },
    ethernet: {
      type: 'LAN8720',
      mdc_pin: 'GPIO23',
      mdio_pin: 'GPIO18',
      clk: { pin: 'GPIO17', mode: 'CLK_OUT' },
      phy_addr: 1,
    },
    pinRules: {
      inputOnly: [34, 35, 36, 39],
      noPullup: [34, 35, 36, 39],
      flashPins: [6, 7, 8, 9, 10, 11],
      strappingPins: [0, 2, 5, 12, 15],
      ethernetReservedPins: [17, 18, 23]
    },
    notes: ['Generic WT32-ETH01 Ethernet profile.']
  },
  {
    id: '__custom__',
    label: 'Custom…',
    boardId: '__custom__',
    platform: null,
    supports: { usb: true, ota: true, ethernet: true, wifi: true },
    pinRules: {
      inputOnly: [34, 35, 36, 39],
      noPullup: [34, 35, 36, 39],
      flashPins: [6, 7, 8, 9, 10, 11],
      strappingPins: [0, 2, 5, 12, 15],
      ethernetReservedPins: []
    },
    notes: ['Custom board mode keeps raw board ID support.']
  }
];
