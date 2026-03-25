import { describe, it, expect } from 'vitest';
import importerModule from '../../src/esphome/yaml_importer.js';

const { parseEsphomeYaml } = importerModule;

describe('ESPHome YAML importer', () => {
  it('parses common sensor and bus configuration into the current importer shape', () => {
    const yaml = `esphome:\n  name: test_node\n  friendly_name: Test Node\n\ni2c:\n  sda: GPIO4\n  scl: GPIO5\n  id: bus_a\n\none_wire:\n  - platform: gpio\n    pin: GPIO32\n    id: ow_gpio32\n\nsensor:\n  - platform: dallas_temp\n    one_wire_id: ow_gpio32\n    name: \"Top Temp\"\n    id: temp_top\n  - platform: bh1750\n    i2c_id: bus_a\n    address: 0x23\n    name: \"Lux Meter\"\n    id: lux_1\n  - platform: sht3xd\n    i2c_id: bus_a\n    address: 0x44\n    temperature:\n      name: \"Climate Temperature\"\n      id: climate_1\n    humidity:\n      name: \"Climate Humidity\"\n      id: climate_1_hum\n`;

    const out = parseEsphomeYaml(yaml);
    expect(out.label).toBe('Test Node');
    expect(out.i2c).toEqual(expect.objectContaining({ id: 'bus_a', sda: 4, scl: 5 }));
    expect(out.entityDefaults).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ds18b20', key: 'temp_top' }),
    ]));
    expect(Array.isArray(out.entityDefaults)).toBe(true);
  });
});
