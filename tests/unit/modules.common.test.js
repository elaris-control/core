import { describe, it, expect } from 'vitest';
import commonModule from '../../src/modules/common.js';

const { withStandardTestMode } = commonModule;

describe('withStandardTestMode', () => {
  it('injects test_mode when missing', () => {
    const def = withStandardTestMode({ id: 'demo', setpoints: [{ key: 'setpoint', type: 'number' }] });
    expect(def.capabilities.test_mode).toBe(true);
    expect(def.setpoints.some(sp => sp.key === 'test_mode')).toBe(true);
  });

  it('does not duplicate test_mode and preserves custom metadata', () => {
    const def = withStandardTestMode({
      id: 'demo',
      setpoints: [{ key: 'test_mode', label: 'Existing Label', type: 'select', options: ['0', '1'], default: '1' }]
    });
    const rows = def.setpoints.filter(sp => sp.key === 'test_mode');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Existing Label');
    expect(rows[0].help).toContain('Logic runs normally');
  });

  it('supports explicit opt-out', () => {
    const def = withStandardTestMode({ id: 'demo', capabilities: { test_mode: false }, setpoints: [] });
    expect(def.capabilities.test_mode).toBe(false);
    expect(def.setpoints).toEqual([]);
  });
});
