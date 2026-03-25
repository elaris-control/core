import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import waterModule from '../../src/automation/water_manager.js';

const { waterManagerHandler } = waterModule;

let nextInstanceId = 4000;

function createCtx({ instanceId = nextInstanceId++, values = {}, states = {}, settings = {}, mappings = [] } = {}) {
  const stored = new Map(Object.entries(settings).map(([k, v]) => [k, String(v)]));
  const ioMap = new Map();
  const allMappings = mappings.map((m) => {
    const row = {
      input_key: m.input_key,
      io_id: m.io_id ?? Math.floor(Math.random() * 10000) + 1,
      io_key: m.io_key || m.input_key,
      io_name: m.io_name || m.input_key,
      io_type: m.io_type || 'DO',
      device_id: m.device_id || 'dev1',
    };
    ioMap.set(row.input_key, { id: row.io_id, key: row.io_key, type: row.io_type, device_id: row.device_id });
    return row;
  });

  return {
    instance: { id: instanceId, module_id: 'water_manager' },
    mappings: allMappings,
    io(key) {
      return ioMap.get(key) || null;
    },
    value(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    state(key) {
      return Object.prototype.hasOwnProperty.call(states, key) ? states[key] : null;
    },
    isOn(key) {
      return String(this.state(key) || '').toUpperCase() === 'ON';
    },
    setting(key, defaultVal) {
      if (!stored.has(key)) return defaultVal;
      const n = parseFloat(stored.get(key));
      return Number.isNaN(n) ? defaultVal : n;
    },
    settingStr(key, defaultVal = '') {
      return stored.has(key) ? stored.get(key) : defaultVal;
    },
    setSetting(key, value) {
      stored.set(key, String(value));
    },
    broadcastState: vi.fn(),
    testLogSummary: vi.fn(() => ({ count: 0, recent: [] })),
    _engine: { notify: vi.fn() },
    _settings: stored,
  };
}

describe('waterManagerHandler logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T01:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('trips and closes the main valve when a leak sensor goes wet', () => {
    const send = vi.fn();
    const ctx = createCtx({
      states: { leak_sensor_1: 'ON' },
      settings: { leak_sensor_1_label: 'Under Boiler', alert_cooldown_s: 0 },
      mappings: [
        { input_key: 'main_valve', io_type: 'DO' },
        { input_key: 'leak_sensor_1', io_type: 'DI' },
      ],
    });

    waterManagerHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('main_valve', 'OFF', 'Water alarm: water_leak — Under Boiler');
    expect(ctx._engine.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '💧 Water Alarm',
      body: 'Valve closed: Under Boiler',
    }));
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'alarm',
      leak_detected: true,
      leak_label: 'Under Boiler',
    }));
  });

  it('trips on rapid pressure drop', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'main_valve', io_type: 'DO' },
      { input_key: 'pressure_sensor', io_type: 'AI' },
    ];

    const ctx1 = createCtx({
      instanceId,
      values: { pressure_sensor: 3.0 },
      settings: { pressure_drop_thresh: 0.5, alert_cooldown_s: 0 },
      mappings,
    });
    waterManagerHandler(ctx1, send);
    send.mockClear();

    vi.advanceTimersByTime(60_000);
    const ctx2 = createCtx({
      instanceId,
      values: { pressure_sensor: 2.0 },
      settings: { pressure_drop_thresh: 0.5, alert_cooldown_s: 0 },
      mappings,
    });
    waterManagerHandler(ctx2, send);

    expect(send).toHaveBeenCalledWith('main_valve', 'OFF', expect.stringContaining('Pressure drop 1.00 bar in 1.0 min'));
    expect(ctx2.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      leak_source: 'pressure_drop',
      status: 'alarm',
    }));
  });

  it('reopens the valve on manual re-arm request', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'main_valve', io_type: 'DO' },
      { input_key: 'leak_sensor_1', io_type: 'DI' },
    ];

    const alarmCtx = createCtx({
      instanceId,
      states: { leak_sensor_1: 'ON' },
      settings: { alert_cooldown_s: 0 },
      mappings,
    });
    waterManagerHandler(alarmCtx, send);
    send.mockClear();

    const rearmCtx = createCtx({
      instanceId,
      states: { leak_sensor_1: 'OFF' },
      settings: { _rearm_request: '1' },
      mappings,
    });
    waterManagerHandler(rearmCtx, send);

    expect(send).toHaveBeenCalledWith('main_valve', 'ON', 'Rearm: valve reopened by operator');
    expect(rearmCtx._settings.get('_rearm_request')).toBe('0');
  });

  it('auto re-arms after the configured cooldown', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'main_valve', io_type: 'DO' },
      { input_key: 'leak_sensor_1', io_type: 'DI' },
    ];

    const alarmCtx = createCtx({
      instanceId,
      states: { leak_sensor_1: 'ON' },
      settings: { auto_rearm_enable: 1, auto_rearm_min: 1, alert_cooldown_s: 0 },
      mappings,
    });
    waterManagerHandler(alarmCtx, send);
    send.mockClear();

    vi.advanceTimersByTime(61_000);
    const rearmCtx = createCtx({
      instanceId,
      states: { leak_sensor_1: 'OFF' },
      settings: { auto_rearm_enable: 1, auto_rearm_min: 1 },
      mappings,
    });
    waterManagerHandler(rearmCtx, send);

    expect(send).toHaveBeenCalledWith('main_valve', 'ON', 'Auto re-arm: valve reopened after 1 min');
    expect(rearmCtx._engine.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '💧 Water Manager: Auto Re-armed',
    }));
  });

  it('does not false-trip on a mild pressure transient below threshold', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'main_valve', io_type: 'DO' },
      { input_key: 'pressure_sensor', io_type: 'AI' },
    ];

    const ctx1 = createCtx({
      instanceId,
      values: { pressure_sensor: 3.0 },
      settings: { pressure_drop_thresh: 0.5 },
      mappings,
    });
    waterManagerHandler(ctx1, send);
    send.mockClear();

    vi.advanceTimersByTime(60_000);
    const ctx2 = createCtx({
      instanceId,
      values: { pressure_sensor: 2.7 },
      settings: { pressure_drop_thresh: 0.5 },
      mappings,
    });
    waterManagerHandler(ctx2, send);

    expect(send).not.toHaveBeenCalled();
    expect(ctx2.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'idle',
      alarm: false,
    }));
  });

  it('trips on ghost flow during configured night hours', () => {
    const send = vi.fn();
    vi.setSystemTime(new Date('2026-03-20T23:30:00Z'));
    const ctx = createCtx({
      values: { flow_sensor: 3.2 },
      settings: {
        night_flow_enable: 1,
        flow_leak_threshold: 2,
        night_start: '23:00',
        night_end: '06:00',
        alert_cooldown_s: 0,
      },
      mappings: [
        { input_key: 'main_valve', io_type: 'DO' },
        { input_key: 'flow_sensor', io_type: 'AI' },
      ],
    });

    waterManagerHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('main_valve', 'OFF', expect.stringContaining('Night ghost flow (3.2 L/min)'));
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      leak_source: 'night_flow',
      status: 'alarm',
    }));
  });

  it('accumulates water meter totals across successive flow updates', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'main_valve', io_type: 'DO' },
      { input_key: 'flow_sensor', io_type: 'AI' },
    ];

    const ctx1 = createCtx({
      instanceId,
      values: { flow_sensor: 6 },
      settings: { meter_enable: 1, night_flow_enable: 0 },
      mappings,
    });
    waterManagerHandler(ctx1, send);

    vi.advanceTimersByTime(60_000);
    const ctx2 = createCtx({
      instanceId,
      values: { flow_sensor: 6 },
      settings: { meter_enable: 1, night_flow_enable: 0 },
      mappings,
    });
    waterManagerHandler(ctx2, send);

    expect(ctx2.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      total_m3: 0.006,
      daily_m3: 0.006,
      status: 'idle',
    }));
  });

  it('alerts on gradual leak when today exceeds rolling baseline', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const runtime = {
      ts: Date.now(),
      shutoff: false,
      reason: null,
      lastAlertTs: 0,
      lastTripTs: 0,
      autoRearmTs: 0,
      totalLitres: 0,
      dailyLitres: 1600,
      dailyKey: '2026-03-20',
      lastFlowTs: Date.now() - 60_000,
      weeklyUsage: [
        { key: '2026-03-17', litres: 1000 },
        { key: '2026-03-18', litres: 1000 },
        { key: '2026-03-19', litres: 1000 },
      ],
    };

    const ctx = createCtx({
      instanceId,
      values: { flow_sensor: 6 },
      settings: {
        meter_enable: 1,
        night_flow_enable: 0,
        gradual_enable: 1,
        gradual_alert_pct: 50,
        alert_cooldown_s: 0,
        _runtime_json: JSON.stringify(runtime),
      },
      mappings: [
        { input_key: 'main_valve', io_type: 'DO' },
        { input_key: 'flow_sensor', io_type: 'AI' },
      ],
    });

    waterManagerHandler(ctx, send);

    expect(ctx._engine.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '💧 Water Usage Alert',
      body: expect.stringContaining('Possible slow leak'),
    }));
    expect(send).not.toHaveBeenCalled();
  });
});
