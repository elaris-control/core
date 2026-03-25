import { describe, it, expect, beforeEach, vi } from 'vitest';
import thermostatModule from '../../src/automation/thermostat.js';

const { thermostatHandler } = thermostatModule;

let nextInstanceId = 1000;

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
    instance: { id: instanceId, module_id: 'thermostat' },
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
    _settings: stored,
  };
}

describe('thermostatHandler logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
  });

  it('turns legacy heating output ON when room temperature is below threshold', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_room: 19 },
      states: { ac_relay: 'OFF' },
      settings: { mode: 'heating', setpoint: 21, hysteresis: 0.5, min_run_time: 0, min_off_time: 0 },
      mappings: [
        { input_key: 'temp_room', io_type: 'AI' },
        { input_key: 'ac_relay', io_type: 'DO' },
      ],
    });

    thermostatHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('ac_relay', 'ON', expect.stringContaining('heating ON'));
  });

  it('turns legacy heating output OFF when room temperature is above threshold', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_room: 22 },
      states: { ac_relay: 'ON' },
      settings: { mode: 'heating', setpoint: 21, hysteresis: 0.5, min_run_time: 0, min_off_time: 0 },
      mappings: [
        { input_key: 'temp_room', io_type: 'AI' },
        { input_key: 'ac_relay', io_type: 'DO' },
      ],
    });

    thermostatHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('ac_relay', 'OFF', expect.stringContaining('heating OFF'));
  });

  it('respects hysteresis and does not toggle inside the heating band', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_room: 20.8 },
      states: { ac_relay: 'OFF' },
      settings: { mode: 'heating', setpoint: 21, hysteresis: 0.5, min_run_time: 0, min_off_time: 0 },
      mappings: [
        { input_key: 'temp_room', io_type: 'AI' },
        { input_key: 'ac_relay', io_type: 'DO' },
      ],
    });

    thermostatHandler(ctx, send);

    expect(send).not.toHaveBeenCalled();
  });

  it('respects minimum run time before turning legacy output OFF', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_room: 19 },
      states: { ac_relay: 'OFF' },
      settings: { mode: 'heating', setpoint: 21, hysteresis: 0.5, min_run_time: 120, min_off_time: 0 },
      mappings: [
        { input_key: 'temp_room', io_type: 'AI' },
        { input_key: 'ac_relay', io_type: 'DO' },
      ],
    });

    thermostatHandler(ctx, send);
    expect(send).toHaveBeenCalledTimes(1);

    send.mockClear();
    ctx.value = (key) => (key === 'temp_room' ? 22 : null);
    ctx.state = (key) => (key === 'ac_relay' ? 'ON' : null);
    vi.advanceTimersByTime(30_000);
    thermostatHandler(ctx, send);

    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when the room sensor value is invalid', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_room: null },
      states: { ac_relay: 'OFF' },
      settings: { mode: 'heating', setpoint: 21, hysteresis: 0.5 },
      mappings: [
        { input_key: 'temp_room', io_type: 'AI' },
        { input_key: 'ac_relay', io_type: 'DO' },
      ],
    });

    thermostatHandler(ctx, send);

    expect(send).not.toHaveBeenCalled();
  });
});
