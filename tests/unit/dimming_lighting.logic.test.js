// tests/unit/dimming_lighting.logic.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dimmingModule from '../../src/automation/dimming_lighting.js';
const { dimmingLightingHandler, dimmingLevel, doubleTapUpTs, doubleTapDnTs, diUpPrev, diDnPrev, diDebounce } = dimmingModule;

let nextId = 9000;

function createCtx({ instanceId = nextId++, states = {}, settings = {}, mappings = [] } = {}) {
  const stored = new Map(Object.entries(settings).map(([k, v]) => [k, String(v)]));
  const ioMap = new Map();
  for (const m of mappings) {
    ioMap.set(m.key, { id: m.io_id ?? 1, key: m.key, type: m.type || 'di', device_id: 'dev1', name: m.key });
  }
  return {
    instance: { id: instanceId, module_id: 'dimming_lighting', name: 'Test Dimmer' },
    mappings: mappings.map(m => ({ input_key: m.key, io_id: m.io_id ?? 1, io_key: m.key, io_type: m.type || 'di', device_id: 'dev1', io_name: m.key })),
    io(key) { return ioMap.get(key) || null; },
    state(key) { return Object.prototype.hasOwnProperty.call(states, key) ? String(states[key]) : null; },
    setting(key, def) { if (!stored.has(key)) return def; const n = parseFloat(stored.get(key)); return Number.isNaN(n) ? def : n; },
    settingStr(key, def = '') { return stored.has(key) ? stored.get(key) : def; },
    setSetting(key, value) { stored.set(key, String(value)); },
    broadcastState: vi.fn(),
  };
}

describe('dimmingLightingHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    dimmingLevel.clear();
    doubleTapUpTs.clear();
    doubleTapDnTs.clear();
    diUpPrev.clear();
    diDnPrev.clear();
    diDebounce.clear();
  });

  it('Up press increases level by step', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 40);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_up: '1' },
      settings: { step: 10 },
      mappings: [
        { key: 'di_up', type: 'di' },
        { key: 'ao',    type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 50, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(50);
  });

  it('Down press decreases level by step', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 40);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_down: '1' },
      settings: { step: 10 },
      mappings: [
        { key: 'di_down', type: 'di' },
        { key: 'ao',      type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 30, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(30);
  });

  it('Up press clamps level at 100', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 95);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_up: '1' },
      settings: { step: 10 },
      mappings: [
        { key: 'di_up', type: 'di' },
        { key: 'ao',    type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 100, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(100);
  });

  it('Down press clamps level at 0', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 5);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_down: '1' },
      settings: { step: 10 },
      mappings: [
        { key: 'di_down', type: 'di' },
        { key: 'ao',      type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 0, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(0);
  });

  it('Double-tap Up sets level to double_tap_up_level', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 40);
    // Seed first tap timestamp 200ms ago
    doubleTapUpTs.set(instId, Date.now() - 200);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_up: '1' },
      settings: { step: 10, double_tap_up_level: 100 },
      mappings: [
        { key: 'di_up', type: 'di' },
        { key: 'ao',    type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 100, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(100);
  });

  it('Double-tap Down sets level to double_tap_down_level', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 60);
    doubleTapDnTs.set(instId, Date.now() - 200);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_down: '1' },
      settings: { step: 10, double_tap_down_level: 0 },
      mappings: [
        { key: 'di_down', type: 'di' },
        { key: 'ao',      type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 0, expect.any(String));
    expect(dimmingLevel.get(instId)).toBe(0);
  });

  it('DO follows AO — sends ON when level > 0', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 0);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_up: '1' },
      settings: { step: 20 },
      mappings: [
        { key: 'di_up', type: 'di' },
        { key: 'ao',    type: 'ao' },
        { key: 'do',    type: 'do' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 20, expect.any(String));
    expect(send).toHaveBeenCalledWith('do', 'ON', expect.any(String));
  });

  it('DO follows AO — sends OFF when level reaches 0', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 10);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_down: '1' },
      settings: { step: 20 },
      mappings: [
        { key: 'di_down', type: 'di' },
        { key: 'ao',      type: 'ao' },
        { key: 'do',      type: 'do' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).toHaveBeenCalledWith('ao', 0, expect.any(String));
    expect(send).toHaveBeenCalledWith('do', 'OFF', expect.any(String));
  });

  it('test_mode skips real outputs', () => {
    const instId = nextId++;
    dimmingLevel.set(instId, 40);
    const send = vi.fn();
    const ctx = createCtx({
      instanceId: instId,
      states: { di_up: '1' },
      settings: { step: 10, test_mode: '1' },
      mappings: [
        { key: 'di_up', type: 'di' },
        { key: 'ao',    type: 'ao' },
      ],
    });
    dimmingLightingHandler(ctx, send);
    expect(send).not.toHaveBeenCalled();
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({ last_reason: expect.stringContaining('[TEST]') }));
  });
});
