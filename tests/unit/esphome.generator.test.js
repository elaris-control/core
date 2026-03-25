import { describe, it, expect } from 'vitest';
import generatorModule from '../../src/esphome/generator.js';

const { generateYAML, applyYamlOverrides } = generatorModule;

describe('ESPHome generator / overrides', () => {
  it('generates YAML for shared-bus and multi-entity sensors', () => {
    const profile = {
      id: 'kincony_kc868_a16',
      label: 'KinCony KC868-A16',
      board: 'esp32dev',
      platform: 'esp32',
      frameworkDefault: 'esp-idf',
      i2c: { sda: 4, scl: 5, id: 'bus_a' },
    };
    const yaml = generateYAML({ profile, payload: {
      device_name: 'Test Node',
      framework: 'esp-idf',
      transport: 'wifi',
      network_mode: 'wifi',
      wifi_ssid: 'ssid',
      wifi_pass: 'pass',
      mqtt_host: '192.168.1.2',
      entities: [
        { key: 'temp_top', name: 'Top Temp', type: 'ds18b20', pin: 'GPIO32' },
        { key: 'temp_bottom', name: 'Bottom Temp', type: 'ds18b20', pin: 'GPIO32' },
        { key: 'lux_1', name: 'Lux Meter', type: 'bh1750', bus_id: 'bus_a', address: '0x23' },
        { key: 'climate_1', name: 'Climate', type: 'sht3x', bus_id: 'bus_a', address: '0x44' },
      ],
    } });

    expect(yaml).toContain('one_wire:');
    expect(yaml).toContain('pin: GPIO32');
    expect(yaml).toContain('platform: dallas_temp');
    expect(yaml).toContain('platform: bh1750');
    expect(yaml).toContain('address: 0x23');
    expect(yaml).toContain('platform: sht3xd');
    expect(yaml).toContain('address: 0x44');
  });

  it('applies device / wifi / mqtt overrides into existing YAML', () => {
    const base = `esphome:\n  name: \"old_name\"\n  friendly_name: \"old_name\"\n\nwifi:\n  ssid: \"old_ssid\"\n  password: \"old_pass\"\n\nmqtt:\n  broker: 10.0.0.1\n`;
    const out = applyYamlOverrides(base, {
      device_name: 'new-node',
      wifi_ssid: 'new-ssid',
      wifi_pass: 'new-pass',
      mqtt_host: '192.168.1.50',
    });

    expect(out).toContain('name: "new-node"');
    expect(out).toContain('friendly_name: "new-node"');
    expect(out).toContain('ssid: "new-ssid"');
    expect(out).toContain('password: "new-pass"');
    expect(out).toContain('broker: 192.168.1.50');
  });
});
