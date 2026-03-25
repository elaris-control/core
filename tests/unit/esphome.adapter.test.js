import { describe, it, expect } from 'vitest';
import esphomeIntegration from '../../src/integrations/esphome/index.js';

const { createEspHomeAdapter } = esphomeIntegration;

describe('ESPHome adapter', () => {
  it('exposes the expected adapter capabilities', () => {
    const adapter = createEspHomeAdapter();

    expect(adapter.key).toBe('esphome');
    expect(adapter.supportsProfiles).toBe(true);
    expect(adapter.supportsImports).toBe(true);
    expect(adapter.supportsProvisioning).toBe(true);
    expect(adapter.supportsStateSync).toBe(true);
    expect(adapter.supportsNativeApi).toBe(true);
    expect(adapter.supportsNativeSessions).toBe(true);
    expect(typeof adapter.mount).toBe('function');
  });

  it('applies sane ownership defaults', () => {
    const adapter = createEspHomeAdapter();
    expect(adapter.ownershipDefaults({})).toEqual({
      integration_key: 'esphome',
      ownership_mode: 'managed_internal',
      config_source: 'board_profile',
      read_only: 0,
    });
  });
});
