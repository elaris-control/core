import { describe, it, expect, beforeEach, vi } from 'vitest';
import solarModule from '../../src/automation/solar_v2.js';
import runtimeModule from '../../src/core/runtime.js';

const { solarEngineHandler } = solarModule;
const { clear } = runtimeModule;

function resetSolarRuntime(instanceId) {
  ['pump_timer', 'last_sent', 'vspd_pump', 'anti_freeze', 'heater_timer', 'backup_timer', 'legionella', 'stagnation'].forEach(bucket => clear(instanceId, bucket));
}

let nextInstanceId = 2000;

function createCtx({ instanceId = nextInstanceId++, values = {}, states = {}, settings = {}, mappings = [] } = {}) {
  const stored = new Map(Object.entries(settings).map(([k, v]) => [k, String(v)]));
  const ioMap = new Map();
  const allMappings = mappings.map((m) => {
    const row = {
      input_key: m.input_key,
      io_id: m.io_id ?? Math.floor(Math.random() * 10000) + 1,
      io_key: m.io_key || m.input_key,
      io_name: m.io_name || m.input_key,
      io_type: m.io_type || (m.input_key.includes('temp') ? 'AI' : 'DO'),
      device_id: m.device_id || 'dev1',
    };
    ioMap.set(row.input_key, { id: row.io_id, key: row.io_key, type: row.io_type, device_id: row.device_id });
    return row;
  });

  return {
    instance: { id: instanceId, module_id: 'solar_v2' },
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
  };
}

describe('solarEngineHandler logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
  });

  it('turns the pump ON in basic profile when delta-T exceeds the start threshold', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_solar: 70, temp_boiler: 50 },
      states: { pump: 'OFF' },
      settings: { profile: 'basic', dt_on: 8, dt_off: 3, min_solar_temp: 40, max_boiler_temp: 85 },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
      ],
    });

    solarEngineHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('pump', 'ON', expect.stringContaining('ON threshold'));
  });

  it('turns the pump OFF in basic profile when delta-T falls below the stop threshold', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_solar: 52, temp_boiler: 50 },
      states: { pump: 'ON' },
      settings: { profile: 'basic', dt_on: 8, dt_off: 3, min_solar_temp: 40, max_boiler_temp: 85 },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
      ],
    });

    solarEngineHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('pump', 'OFF', expect.stringContaining('OFF threshold'));
  });

  it('forces the pump OFF on boiler overheat', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_solar: 95, temp_boiler: 86 },
      states: { pump: 'ON' },
      settings: { profile: 'basic', dt_on: 8, dt_off: 3, min_solar_temp: 40, max_boiler_temp: 85 },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
      ],
    });

    solarEngineHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('pump', 'OFF', expect.stringContaining('Safety: boiler 86°C >= max 85°C'));
  });

  it('respects pump minimum ON time in basic profile', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const base = {
      instanceId,
      settings: { profile: 'basic', dt_on: 8, dt_off: 3, min_solar_temp: 40, max_boiler_temp: 85, pump_min_on_s: 120, pump_min_off_s: 0 },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
      ],
    };

    resetSolarRuntime(instanceId);

    const ctxOn = createCtx({
      ...base,
      values: { temp_solar: 70, temp_boiler: 50 },
      states: { pump: 'OFF' },
    });
    solarEngineHandler(ctxOn, send);
    expect(send).toHaveBeenCalledWith('pump', 'ON', expect.any(String));

    send.mockClear();
    vi.advanceTimersByTime(30_000);

    const ctxEarlyOff = createCtx({
      ...base,
      values: { temp_solar: 52, temp_boiler: 50 },
      states: { pump: 'ON' },
    });
    solarEngineHandler(ctxEarlyOff, send);

    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when required temperatures are missing', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_solar: null, temp_boiler: 50 },
      states: { pump: 'OFF' },
      settings: { profile: 'basic' },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
      ],
    });

    solarEngineHandler(ctx, send);

    expect(send).not.toHaveBeenCalled();
  });

  it('enters inverter kickstart and drives configured kickstart speed', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const base = {
      instanceId,
      settings: {
        profile: 'inverter_dt',
        dt_on: 8,
        dt_off: 3,
        dt_target: 10,
        min_solar_temp: 40,
        max_boiler_temp: 85,
        min_speed: 25,
        max_speed: 100,
        start_delay_s: 0,
        stop_delay_s: 0,
        kickstart_s: 5,
        kickstart_pct: 55,
        anti_cycle_s: 0,
      },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
        { input_key: 'pump_speed', io_type: 'AO' },
      ],
    };

    resetSolarRuntime(instanceId);

    const ctxStart = createCtx({
      ...base,
      values: { temp_solar: 70, temp_boiler: 50 },
      states: { pump: 'OFF' },
    });
    solarEngineHandler(ctxStart, send);
    expect(send).toHaveBeenCalledWith('pump', 'ON', expect.stringContaining('Pump start'));
    expect(send).toHaveBeenCalledWith('pump_speed', 0, 'Pump speed 0%');

    send.mockClear();
    vi.advanceTimersByTime(1000);
    const ctxKick = createCtx({
      ...base,
      values: { temp_solar: 70, temp_boiler: 50 },
      states: { pump: 'ON' },
    });
    solarEngineHandler(ctxKick, send);

    expect(send).toHaveBeenCalledWith('pump_speed', 55, 'Pump speed 55%');
  });

  it('respects inverter anti-cycle and does not restart immediately after stop', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const base = {
      instanceId,
      settings: {
        profile: 'inverter_dt',
        dt_on: 8,
        dt_off: 3,
        dt_target: 10,
        min_solar_temp: 40,
        max_boiler_temp: 85,
        min_speed: 25,
        max_speed: 100,
        start_delay_s: 0,
        stop_delay_s: 0,
        kickstart_s: 0,
        anti_cycle_s: 60,
        ramp_down_pct_s: 100,
      },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
        { input_key: 'pump_speed', io_type: 'AO' },
      ],
    };

    resetSolarRuntime(instanceId);

    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 70, temp_boiler: 50 }, states: { pump: 'OFF' } }), send);
    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 70, temp_boiler: 50 }, states: { pump: 'ON' } }), send);
    send.mockClear();

    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 52, temp_boiler: 50 }, states: { pump: 'ON' } }), send);
    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 52, temp_boiler: 50 }, states: { pump: 'ON' } }), send);
    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 52, temp_boiler: 50 }, states: { pump: 'ON' } }), send);
    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 52, temp_boiler: 50 }, states: { pump: 'OFF' } }), send);

    send.mockClear();

    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 70, temp_boiler: 50 }, states: { pump: 'OFF' } }), send);

    expect(send).not.toHaveBeenCalledWith('pump', 'ON', expect.any(String));
  });

  it('applies manual speed override in inverter mode while keeping pump running', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const base = {
      instanceId,
      settings: {
        profile: 'inverter_dt',
        dt_on: 8,
        dt_off: 3,
        dt_target: 10,
        min_solar_temp: 40,
        max_boiler_temp: 85,
        min_speed: 25,
        max_speed: 100,
        start_delay_s: 0,
        stop_delay_s: 0,
        kickstart_s: 0,
        anti_cycle_s: 0,
        manual_override: 1,
        manual_speed: 77,
      },
      mappings: [
        { input_key: 'temp_solar', io_type: 'AI' },
        { input_key: 'temp_boiler', io_type: 'AI' },
        { input_key: 'pump', io_type: 'DO' },
        { input_key: 'pump_speed', io_type: 'AO' },
      ],
    };

    resetSolarRuntime(instanceId);

    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 70, temp_boiler: 50 }, states: { pump: 'OFF' } }), send);
    vi.advanceTimersByTime(1000);
    solarEngineHandler(createCtx({ ...base, values: { temp_solar: 70, temp_boiler: 50 }, states: { pump: 'ON' } }), send);

    expect(send).toHaveBeenCalledWith('pump_speed', 77, 'Pump speed 77%');
  });
});
