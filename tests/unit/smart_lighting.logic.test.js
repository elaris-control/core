// tests/unit/smart_lighting.logic.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import smartLightingModule from '../../src/automation/smart_lighting.js';
const { smartLightingHandler, activeScenario, adaptiveState, switchPrev, switchDebounce } = smartLightingModule;

let nextId = 8000;

function createSmartCtx({ instanceId = nextId++, states = {}, settings = {}, mappings = [], scenarios = [] } = {}) {
  const stored = new Map(Object.entries(settings).map(([k, v]) => [k, String(v)]));
  stored.set('scenarios', JSON.stringify(scenarios));
  const ioMap = new Map();
  const allMappings = mappings.map(m => {
    const row = {
      input_key: m.input_key,
      io_id: m.io_id ?? Math.floor(Math.random() * 10000) + 1,
      io_key: m.io_key || m.input_key,
      io_name: m.io_name || m.input_key,
      io_type: m.io_type || 'DO',
      device_id: m.device_id || 'dev1',
      name: m.io_name || m.input_key,
    };
    ioMap.set(row.input_key, { id: row.io_id, key: row.io_key, type: row.io_type.toLowerCase(), device_id: row.device_id, name: row.io_name });
    return row;
  });
  return {
    instance: { id: instanceId, module_id: 'smart_lighting', name: 'Test SL' },
    mappings: allMappings,
    io(key) { return ioMap.get(key) || null; },
    value(key) { return null; },
    state(key) { return Object.prototype.hasOwnProperty.call(states, key) ? states[key] : null; },
    setting(key, def) { if (!stored.has(key)) return def; const n = parseFloat(stored.get(key)); return Number.isNaN(n) ? def : n; },
    settingStr(key, def = '') { return stored.has(key) ? stored.get(key) : def; },
    setSetting(key, value) { stored.set(key, String(value)); },
    broadcastState: vi.fn(),
  };
}

describe('smartLightingHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    activeScenario.clear();
    adaptiveState.clear();
    switchPrev.clear();
    switchDebounce.clear();
  });

  it('does not send adaptive brightness commands when manual override is active', () => {
    const instId = nextId++;
    activeScenario.set(instId, { id: 'scene1', name: 'Test', ts: Date.now(), reason: 'Manual', manual: true });
    const send = vi.fn();
    const ctx = createSmartCtx({
      instanceId: instId,
      states: { ai_1: '20' },
      settings: {
        adaptive_brightness: '1',
        adaptive_lux_dark: '50',
        adaptive_lux_medium: '200',
        adaptive_dark_level: '100',
        adaptive_medium_level: '60',
        adaptive_bright_level: '0',
      },
      mappings: [
        { input_key: 'ai_1', io_type: 'ai' },
        { input_key: 'ao_1', io_type: 'ao' },
      ],
      scenarios: [],
    });
    smartLightingHandler(ctx, send, { timezone: 'UTC' });
    const aoCall = send.mock.calls.find(c => c[0] === 'ao_1');
    expect(aoCall).toBeUndefined();
  });

  it('allows wall switch to cycle scenarios even when manual override is active', () => {
    const instId = nextId++;
    const scenario = { id: 'sc1', name: 'Evening', trigger: 'switch', enabled: true, outputs: [{ io_key: 'do_1', level: 100 }] };
    // Pre-set a manual active scenario (different from sc1, so it should cycle to sc1)
    activeScenario.set(instId, { id: 'other', name: 'Other', ts: Date.now(), reason: 'Manual', manual: true });
    const send = vi.fn();

    // First call with switch OFF to establish prevOn=false
    const ctx1 = createSmartCtx({
      instanceId: instId,
      states: { di_1: 'OFF' },
      mappings: [
        { input_key: 'di_1', io_type: 'di' },
        { input_key: 'do_1', io_type: 'do' },
      ],
      scenarios: [scenario],
    });
    smartLightingHandler(ctx1, send, { timezone: 'UTC' });

    // Advance time (switchDebounce uses Date.now() which is faked; 400ms threshold)
    vi.advanceTimersByTime(500);

    // Second call with switch ON — rising edge should fire the cycle
    const ctx2 = createSmartCtx({
      instanceId: instId,
      states: { di_1: 'ON' },
      mappings: [
        { input_key: 'di_1', io_type: 'di' },
        { input_key: 'do_1', io_type: 'do' },
      ],
      scenarios: [scenario],
    });
    smartLightingHandler(ctx2, send, { timezone: 'UTC' });

    // send should have been called (scenario activated via switch)
    expect(send).toHaveBeenCalled();
    const doCall = send.mock.calls.find(c => c[0] === 'do_1');
    expect(doCall).toBeDefined();
  });
});
