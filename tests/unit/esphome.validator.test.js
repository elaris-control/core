import { describe, it, expect } from 'vitest';
import validatorModule from '../../src/esphome/validator.js';

const { validateConfig } = validatorModule;

const profile = {
  pinRules: {
    reserved: [4, 5],
    inputOnly: [34, 35, 36, 39],
    noPullup: [34, 35, 36, 39],
    flashPins: [6, 7, 8, 9, 10, 11],
    strapping: [0, 2, 5, 12, 15],
  },
  boardBuses: [
    { id: 'bus_a', protocol: 'i2c', supports: ['bh1750', 'sht3x', 'bme280'], addresses: ['0x23', '0x44', '0x76'], sda: 'GPIO4', scl: 'GPIO5' },
  ],
};

describe('ESPHome config validator', () => {
  it('accepts valid separated sensors on shared buses / ports', () => {
    const result = validateConfig({ profile, payload: {
      device_name: 'test-node',
      mqtt_host: '192.168.1.2',
      wifi_ssid: 'ssid',
      entities: [
        { name: 'Top Temp', type: 'ds18b20', pin: 'GPIO32' },
        { name: 'Lux Meter', type: 'bh1750', bus_id: 'bus_a', address: '0x23' },
        { name: 'Climate', type: 'sht3x', bus_id: 'bus_a', address: '0x44' },
      ],
    } });
    expect(result.ok).toBe(true);
  });

  it('rejects duplicated raw GPIO assignment for plain GPIO sensors', () => {
    const result = validateConfig({ profile, payload: {
      device_name: 'test-node',
      mqtt_host: '192.168.1.2',
      wifi_ssid: 'ssid',
      entities: [
        { name: 'Humidity 1', type: 'dht', pin: 'GPIO32' },
        { name: 'Humidity 2', type: 'dht', pin: 'GPIO32' },
      ],
    } });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('GPIO32 is assigned more than once');
  });
});
