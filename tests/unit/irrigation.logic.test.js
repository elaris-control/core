import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import irrigationModule from '../../src/automation/irrigation.js';

const { irrigationHandler } = irrigationModule;

let nextInstanceId = 3000;

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

  const ctx = {
    instance: { id: instanceId, module_id: 'irrigation' },
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
    _engine: { notify: vi.fn() },
    _settings: stored,
  };

  return ctx;
}

describe('irrigationHandler logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T05:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('starts a scheduled cycle and opens master valve before zone 1', () => {
    const send = vi.fn();
    const ctx = createCtx({
      settings: {
        schedule_1: '06:00',
        zone_1_min: 10,
        zone_2_min: 0,
        zone_3_min: 0,
        peak_sun_lockout: 0,
      },
      mappings: [
        { input_key: 'master_valve', io_type: 'DO' },
        { input_key: 'zone_1', io_type: 'DO' },
      ],
    });

    irrigationHandler(ctx, send, { timezone: 'Europe/Berlin' });
    expect(send).toHaveBeenCalledWith('master_valve', 'ON', 'Irrigation: opening master valve');

    vi.advanceTimersByTime(2000);

    expect(send).toHaveBeenCalledWith('zone_1', 'ON', expect.stringContaining('Irrigation: Zone 1'));
  });

  it('aborts an active run on manual stop and closes outputs', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const baseMappings = [
      { input_key: 'master_valve', io_type: 'DO' },
      { input_key: 'zone_1', io_type: 'DO' },
    ];

    const startCtx = createCtx({
      instanceId,
      settings: {
        schedule_1: '06:00',
        zone_1_min: 10,
        zone_2_min: 0,
        zone_3_min: 0,
        peak_sun_lockout: 0,
      },
      mappings: baseMappings,
    });

    irrigationHandler(startCtx, send, { timezone: 'Europe/Berlin' });
    vi.advanceTimersByTime(2000);
    send.mockClear();

    const stopCtx = createCtx({
      instanceId,
      settings: {
        _manual_action: 'stop',
      },
      mappings: baseMappings,
    });

    irrigationHandler(stopCtx, send, { timezone: 'Europe/Berlin' });

    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', 'Aborted: Manual stop');
    expect(send).toHaveBeenCalledWith('master_valve', 'OFF', 'Aborted: Manual stop');
    expect(stopCtx._settings.get('_manual_action')).toBe('');
  });

  it('skips scheduled run when frost lockout applies', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_outdoor: 1 },
      settings: {
        schedule_1: '06:00',
        zone_1_min: 10,
        frost_temp: 3,
        peak_sun_lockout: 0,
      },
      mappings: [
        { input_key: 'zone_1', io_type: 'DO' },
        { input_key: 'temp_outdoor', io_type: 'AI' },
      ],
    });

    irrigationHandler(ctx, send, { timezone: 'Europe/Berlin' });

    expect(send).not.toHaveBeenCalled();
    expect(ctx.broadcastState).toHaveBeenCalled();
    expect(ctx._engine.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '🌱 Irrigation Skipped',
      body: expect.stringContaining('Frost protection'),
    }));
  });

  it('aborts a running zone when low flow persists past the alert delay', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'master_valve', io_type: 'DO' },
      { input_key: 'zone_1', io_type: 'DO' },
      { input_key: 'flow_sensor', io_type: 'AI' },
    ];

    const startCtx = createCtx({
      instanceId,
      values: { flow_sensor: 0 },
      settings: {
        schedule_1: '06:00',
        zone_1_min: 10,
        zone_2_min: 0,
        zone_3_min: 0,
        peak_sun_lockout: 0,
        flow_min_l_min: 0.5,
        flow_alert_delay_s: 30,
      },
      mappings,
    });

    irrigationHandler(startCtx, send, { timezone: 'Europe/Berlin' });
    vi.advanceTimersByTime(2000);
    send.mockClear();

    const runningCtx = createCtx({
      instanceId,
      values: { flow_sensor: 0 },
      settings: {
        flow_min_l_min: 0.5,
        flow_alert_delay_s: 30,
      },
      mappings,
    });

    irrigationHandler(runningCtx, send, { timezone: 'Europe/Berlin' });
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(31_000);
    irrigationHandler(runningCtx, send, { timezone: 'Europe/Berlin' });

    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', expect.stringContaining('No flow detected'));
    expect(send).toHaveBeenCalledWith('master_valve', 'OFF', expect.stringContaining('No flow detected'));
    expect(runningCtx._engine.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '💧 Irrigation Alert',
    }));
  });

  it('runs multiple zones sequentially and closes the master valve at completion', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'master_valve', io_type: 'DO' },
      { input_key: 'zone_1', io_type: 'DO' },
      { input_key: 'zone_2', io_type: 'DO' },
    ];

    const ctx = createCtx({
      instanceId,
      settings: {
        schedule_1: '06:00',
        zone_1_min: 1,
        zone_2_min: 1,
        zone_3_min: 0,
        peak_sun_lockout: 0,
      },
      mappings,
    });

    irrigationHandler(ctx, send, { timezone: 'Europe/Berlin' });
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledWith('zone_1', 'ON', expect.stringContaining('Zone 1'));

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', 'Zone 1 done');
    expect(send).toHaveBeenCalledWith('zone_2', 'ON', expect.stringContaining('Zone 2'));

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', 'Irrigation complete');
    expect(send).toHaveBeenCalledWith('zone_2', 'OFF', 'Irrigation complete');
    expect(send).toHaveBeenCalledWith('master_valve', 'OFF', 'Irrigation complete — closing master valve');
  });

  it('performs cycle-and-soak sequencing before resuming the same zone', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'master_valve', io_type: 'DO' },
      { input_key: 'zone_1', io_type: 'DO' },
    ];

    const ctx = createCtx({
      instanceId,
      settings: {
        schedule_1: '06:00',
        zone_1_min: 10,
        zone_2_min: 0,
        zone_3_min: 0,
        peak_sun_lockout: 0,
        cycle_soak_enable: 1,
        cycle_soak_on_min: 1,
        cycle_soak_off_min: 1,
        cycle_soak_cycles: 2,
      },
      mappings,
    });

    irrigationHandler(ctx, send, { timezone: 'Europe/Berlin' });
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledWith('zone_1', 'ON', expect.stringContaining('C&S cycle 1/2'));

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', 'Soak pause (1 min)');

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith('zone_1', 'ON', expect.stringContaining('C&S cycle 2/2'));
  });

  it('skips a wet zone and proceeds to the next eligible one', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'master_valve', io_type: 'DO' },
      { input_key: 'zone_1', io_type: 'DO' },
      { input_key: 'zone_2', io_type: 'DO' },
      { input_key: 'soil_moisture_2', io_type: 'AI' },
    ];

    const ctx = createCtx({
      instanceId,
      values: { soil_moisture_2: 90 },
      settings: {
        schedule_1: '06:00',
        zone_1_min: 1,
        zone_2_min: 1,
        zone_3_min: 0,
        peak_sun_lockout: 0,
        soil_skip_above: 70,
      },
      mappings,
    });

    irrigationHandler(ctx, send, { timezone: 'Europe/Berlin' });
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledWith('zone_1', 'ON', expect.stringContaining('Zone 1'));

    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith('zone_1', 'OFF', 'Irrigation complete');
    expect(send).not.toHaveBeenCalledWith('zone_2', 'ON', expect.any(String));
  });
});
