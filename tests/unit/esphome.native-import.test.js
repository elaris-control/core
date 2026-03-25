import { describe, it, expect } from 'vitest';
import nativeImportModule from '../../src/integrations/esphome/native_import.js';

const { normalizeNativeImportPayload } = nativeImportModule;

describe('ESPHome native import normalization', () => {
  it('normalizes external native payloads into the expected internal shape', () => {
    const out = normalizeNativeImportPayload({
      site_id: '2',
      device_name: 'Boiler Node',
      friendly_name: 'Boiler Node',
      ip_address: '192.168.1.50',
      api_port: '6053',
      encryption_key: 'abc123',
      entities: [
        { name: 'Relay 1', key: 'relay_1', entity_class: 'switch', type: 'relay', port_id: 'R1' },
        { name: 'Flow Temp', key: 'flow_temp', entity_class: 'sensor', unit: '°C' },
      ],
    });

    expect(out.site_id).toBe(2);
    expect(out.device_name).toBe('Boiler Node');
    expect(out.board_profile_id).toBe('external_native_generic');
    expect(out.integration_key).toBe('esphome');
    expect(out.ownership_mode).toBe('external_native');
    expect(out.config_source).toBe('native_api');
    expect(out.read_only).toBe(1);
    expect(out.api_host).toBe('192.168.1.50');
    expect(out.api_port).toBe(6053);
    expect(out.source_meta.native_api.encryption_key_present).toBe(true);
    expect(out.entities).toEqual([
      expect.objectContaining({ key: 'relay_1', entity_class: 'DO', group: 'state', type: 'relay', port_id: 'R1' }),
      expect.objectContaining({ key: 'flow_temp', entity_class: 'AI', group: 'tele', type: 'sensor', unit: '°C' }),
    ]);
  });

  it('applies ownership/read-only normalization for managed payloads', () => {
    const out = normalizeNativeImportPayload({
      device_name: 'Managed Node',
      ownership_mode: 'managed_internal',
      read_only: 0,
      entities: [{ name: 'Output', key: 'out1', entity_class: 'relay' }],
    });

    expect(out.ownership_mode).toBe('managed_internal');
    expect(out.read_only).toBe(0);
    expect(out.entities[0]).toEqual(expect.objectContaining({ key: 'out1', entity_class: 'DO', group: 'state' }));
  });
});
