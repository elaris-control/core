import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import customModule from '../../src/automation/custom.js';

const { customHandler, evalConditions, evalLogicGroup, evalCond } = customModule;

let nextInstanceId = 6000;

function createCtx({ instanceId = nextInstanceId++, settings = {}, mappings = [], latest = {}, testIOValues = {} } = {}) {
  const stored = new Map(Object.entries(settings).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v) === undefined ? String(v) : String(v)]));
  const mappingsRows = mappings.map((m) => ({
    input_key: m.input_key,
    io_id: Number(m.io_id),
    io_key: m.io_key || m.input_key,
    io_type: m.io_type || 'DO',
    device_id: m.device_id || 'dev1',
  }));

  const ioById = new Map();
  const latestState = new Map();
  for (const m of mappingsRows) {
    ioById.set(Number(m.io_id), { id: Number(m.io_id), key: m.io_key, type: (m.io_type || '').toLowerCase(), device_id: m.device_id });
    const v = latest[m.io_id] ?? latest[String(m.io_id)] ?? latest[m.input_key];
    if (v !== undefined) latestState.set(`${m.device_id}:${m.io_key}`, { value: String(v) });
  }

  const engine = {
    _getIOById: ioById,
    _getLatestState: {
      get(deviceId, key) {
        return latestState.get(`${deviceId}:${key}`) || null;
      },
    },
    getActiveIOOverride: () => null,
    getInstanceBroadcastState: () => null,
    scenesApi: { activate: vi.fn(async () => ({ ok: true })) },
    notify: vi.fn(),
    mqttApi: null,
    getDryRunLogSummary: vi.fn(() => ({ count: 0, recent: [] })),
    clearDryRunLog: vi.fn(),
  };

  return {
    instance: { id: instanceId, module_id: 'custom' },
    mappings: mappingsRows,
    _engine: engine,
    _siteInfo: { timezone: 'Europe/Berlin' },
    _testIOValues: testIOValues,
    setting(key, defaultVal) {
      if (!stored.has(key)) return defaultVal;
      const raw = stored.get(key);
      const n = parseFloat(raw);
      return Number.isNaN(n) ? defaultVal : n;
    },
    settingStr(key, defaultVal = '') {
      return stored.has(key) ? stored.get(key) : defaultVal;
    },
    setSetting(key, value) {
      stored.set(key, String(value));
    },
    broadcastState: vi.fn(),
  };
}

describe('custom logic builder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('evaluates flat AND conditions correctly', () => {
    const ctx = createCtx({
      mappings: [
        { input_key: 'temp_a', io_id: 1, io_key: 'temp_a', io_type: 'AI' },
        { input_key: 'temp_b', io_id: 2, io_key: 'temp_b', io_type: 'AI' },
      ],
      latest: { 1: 70, 2: 50 },
    });

    const ok = evalConditions([
      { type: 'sensor_value', io_id: 1, operator: '>', value: 60 },
      { type: 'sensor_vs_sensor', io_a: 1, io_b: 2, operator: '>=', offset: 10 },
    ], 'AND', ctx);

    expect(ok).toBe(true);
  });

  it('evaluates nested logic groups correctly', () => {
    const ctx = createCtx({
      mappings: [
        { input_key: 'temp_a', io_id: 1, io_key: 'temp_a', io_type: 'AI' },
        { input_key: 'temp_b', io_id: 2, io_key: 'temp_b', io_type: 'AI' },
        { input_key: 'flow_ok', io_id: 3, io_key: 'flow_ok', io_type: 'DI' },
      ],
      latest: { 1: 70, 2: 50, 3: 'ON' },
    });

    const group = {
      type: 'AND',
      conditions: [
        { type: 'sensor_value', io_id: 1, operator: '>', value: 60 },
      ],
      groups: [
        {
          type: 'OR',
          conditions: [
            { type: 'sensor_vs_sensor', io_a: 1, io_b: 2, operator: '>=', offset: 15 },
            { type: 'io_state', io_id: 3, equals: 'ON' },
          ],
        },
      ],
    };

    expect(evalLogicGroup(ctx, group)).toBe(true);
  });

  it('runs a stateful ON/OFF rule through customHandler', () => {
    const send = vi.fn();
    const mappings = [
      { input_key: 'relay_out', io_id: 10, io_key: 'relay_out', io_type: 'relay' },
      { input_key: 'temp_a', io_id: 1, io_key: 'temp_a', io_type: 'AI' },
      { input_key: 'temp_b', io_id: 2, io_key: 'temp_b', io_type: 'AI' },
    ];
    const rules = [{
      id: 1,
      name: 'Delta Rule',
      enabled: true,
      mode: 'stateful',
      logic: 'AND',
      conditions: [
        { type: 'sensor_vs_sensor', io_a: 1, io_b: 2, operator: '>=', offset: 10 },
      ],
      actions: [
        { kind: 'DO', io_id: 10, command: 'ON' },
      ],
    }];

    const onCtx = createCtx({ instanceId: 6100, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 70, 2: 50 } });
    customHandler(onCtx, send);
    expect(send).toHaveBeenCalledWith('relay_out', 'ON', 'Rule "Delta Rule" ON');

    send.mockClear();
    const offCtx = createCtx({ instanceId: 6100, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 55, 2: 50 } });
    customHandler(offCtx, send);
    expect(send).toHaveBeenCalledWith('relay_out', 'OFF', 'Rule "Delta Rule" OFF');
  });

  it('forces outputs OFF immediately when a hard interlock is active', () => {
    const send = vi.fn();
    const mappings = [
      { input_key: 'relay_out', io_id: 10, io_key: 'relay_out', io_type: 'relay' },
      { input_key: 'interlock', io_id: 99, io_key: 'interlock', io_type: 'DI' },
      { input_key: 'temp_a', io_id: 1, io_key: 'temp_a', io_type: 'AI' },
      { input_key: 'temp_b', io_id: 2, io_key: 'temp_b', io_type: 'AI' },
    ];
    const rules = [{
      id: 2,
      name: 'Interlocked Rule',
      enabled: true,
      mode: 'stateful',
      logic: 'AND',
      conditions: [
        { type: 'sensor_vs_sensor', io_a: 1, io_b: 2, operator: '>=', offset: 10 },
      ],
      safety: {
        interlock_io: 99,
        interlock_active_state: 'ON',
      },
      actions: [
        { kind: 'DO', io_id: 10, command: 'ON' },
      ],
    }];

    const ctx = createCtx({
      instanceId: 6200,
      settings: { rules: JSON.stringify(rules) },
      mappings,
      latest: { 1: 70, 2: 50, 99: 'ON' },
    });

    customHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('relay_out', 'OFF', 'CRITICAL: Hard Interlock Active');
  });

  it('respects stateful cooldown before retriggering ON', () => {
    const send = vi.fn();
    const mappings = [
      { input_key: 'relay_out', io_id: 10, io_key: 'relay_out', io_type: 'relay' },
      { input_key: 'temp_a', io_id: 1, io_key: 'temp_a', io_type: 'AI' },
      { input_key: 'temp_b', io_id: 2, io_key: 'temp_b', io_type: 'AI' },
    ];
    const rules = [{
      id: 3,
      name: 'Cooldown Rule',
      enabled: true,
      mode: 'stateful',
      cooldown: 60,
      logic: 'AND',
      conditions: [
        { type: 'sensor_vs_sensor', io_a: 1, io_b: 2, operator: '>=', offset: 10 },
      ],
      actions: [
        { kind: 'DO', io_id: 10, command: 'ON' },
      ],
    }];

    customHandler(createCtx({ instanceId: 6300, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 70, 2: 50 } }), send);
    expect(send).toHaveBeenCalledWith('relay_out', 'ON', 'Rule "Cooldown Rule" ON');

    send.mockClear();
    customHandler(createCtx({ instanceId: 6300, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 55, 2: 50 } }), send);
    expect(send).toHaveBeenCalledWith('relay_out', 'OFF', 'Rule "Cooldown Rule" OFF');

    send.mockClear();
    vi.advanceTimersByTime(30_000);
    customHandler(createCtx({ instanceId: 6300, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 70, 2: 50 } }), send);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(31_000);
    customHandler(createCtx({ instanceId: 6300, settings: { rules: JSON.stringify(rules) }, mappings, latest: { 1: 70, 2: 50 } }), send);
    expect(send).toHaveBeenCalledWith('relay_out', 'ON', 'Rule "Cooldown Rule" ON');
  });

  it('custom test-log commands proxy to engine dry-run log APIs', () => {
    const ctx = createCtx({ instanceId: 6400, settings: { test_mode: '1' } });
    ctx._engine.getDryRunLogSummary.mockReturnValue({ count: 2, recent: [{ key: 'relay_out', value: 'ON' }] });

    const got = customModule.CUSTOM_MODULE.commands.get_test_log(ctx, { limit: 10 });
    expect(got).toEqual({ success: true, test_mode: true, entries: [{ key: 'relay_out', value: 'ON' }], total: 2 });

    const cleared = customModule.CUSTOM_MODULE.commands.clear_test_log(ctx);
    expect(cleared).toEqual({ success: true });
    expect(ctx._engine.clearDryRunLog).toHaveBeenCalledWith(6400);
  });
});
