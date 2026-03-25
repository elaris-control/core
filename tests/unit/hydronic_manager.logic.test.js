import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import hydronicModule from '../../src/automation/hydronic_manager.js';

const { hydronicManagerHandler } = hydronicModule;

let nextInstanceId = 5000;

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
    instance: { id: instanceId, module_id: 'hydronic_manager' },
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
    testLogSummary: vi.fn(() => ({ count: 0, recent: [] })),
    notify: vi.fn(),
    _settings: stored,
  };
}

describe('hydronicManagerHandler logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays idle and shuts outputs down when there is no zone demand', () => {
    const send = vi.fn();
    const ctx = createCtx({
      states: {
        zone_1_thermostat: 'OFF',
        zone_1_pump: 'ON',
        main_pump: 'ON',
        heat_source_1: 'ON',
      },
      mappings: [
        { input_key: 'zone_1_thermostat', io_type: 'DI' },
        { input_key: 'zone_1_pump', io_type: 'DO' },
        { input_key: 'main_pump', io_type: 'DO' },
        { input_key: 'heat_source_1', io_type: 'DO' },
      ],
    });

    hydronicManagerHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('zone_1_pump', 'OFF', 'No zone demand');
    expect(send).toHaveBeenCalledWith('main_pump', 'OFF', 'No zone demand');
    expect(send).toHaveBeenCalledWith('heat_source_1', 'OFF', 'No zone demand');
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'idle',
      calling_zones: 0,
    }));
  });

  it('runs direct-mode heating when a zone calls and starts the primary source', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { temp_buffer: 40 },
      states: {
        zone_1_thermostat: 'ON',
        zone_1_pump: 'OFF',
        main_pump: 'OFF',
        heat_source_1: 'OFF',
      },
      settings: {
        topology: 'direct',
        mode: 'heating',
        buffer_demand_min: 45,
      },
      mappings: [
        { input_key: 'zone_1_thermostat', io_type: 'DI' },
        { input_key: 'zone_1_pump', io_type: 'DO' },
        { input_key: 'main_pump', io_type: 'DO' },
        { input_key: 'heat_source_1', io_type: 'DO' },
        { input_key: 'temp_buffer', io_type: 'AI' },
      ],
    });

    hydronicManagerHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('zone_1_pump', 'ON', 'Zone 1 thermostat call');
    expect(send).toHaveBeenCalledWith('main_pump', 'ON', 'Zone demand — main pump ON');
    expect(send).toHaveBeenCalledWith('heat_source_1', 'ON', expect.stringContaining('Buffer 40'));
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      topology: 'direct',
      calling_zones: 1,
    }));
  });

  it('enters purge on mode switch and keeps outputs shut down during purge window', () => {
    const send = vi.fn();
    const instanceId = nextInstanceId++;
    const mappings = [
      { input_key: 'zone_1_thermostat', io_type: 'DI' },
      { input_key: 'zone_1_pump', io_type: 'DO' },
      { input_key: 'main_pump', io_type: 'DO' },
      { input_key: 'heat_source_1', io_type: 'DO' },
    ];

    const heatingCtx = createCtx({
      instanceId,
      states: {
        zone_1_thermostat: 'ON',
        zone_1_pump: 'OFF',
        main_pump: 'OFF',
        heat_source_1: 'OFF',
      },
      settings: { topology: 'direct', mode: 'heating', mode_switch_purge_min: 5 },
      mappings,
    });
    hydronicManagerHandler(heatingCtx, send);
    send.mockClear();

    const coolingCtx = createCtx({
      instanceId,
      states: {
        zone_1_thermostat: 'ON',
        zone_1_pump: 'ON',
        main_pump: 'ON',
        heat_source_1: 'ON',
      },
      settings: { topology: 'direct', mode: 'cooling', mode_switch_purge_min: 5 },
      mappings,
    });
    hydronicManagerHandler(coolingCtx, send);

    expect(send).toHaveBeenCalledWith('zone_1_pump', 'OFF', 'Mode switch purge (5 min)');
    expect(send).toHaveBeenCalledWith('main_pump', 'OFF', 'Mode switch purge (5 min)');
    expect(send).toHaveBeenCalledWith('heat_source_1', 'OFF', 'Mode switch purge (5 min)');
    expect(coolingCtx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'purge',
      purge_active: true,
    }));
  });

  it('blocks cooling on high humidity and shuts outputs down safely', () => {
    const send = vi.fn();
    const ctx = createCtx({
      values: { humidity_room: 75 },
      states: {
        zone_1_thermostat: 'ON',
        zone_1_pump: 'ON',
        main_pump: 'ON',
      },
      settings: {
        topology: 'direct',
        mode: 'cooling',
        humidity_alert: 70,
      },
      mappings: [
        { input_key: 'zone_1_thermostat', io_type: 'DI' },
        { input_key: 'zone_1_pump', io_type: 'DO' },
        { input_key: 'main_pump', io_type: 'DO' },
        { input_key: 'humidity_room', io_type: 'AI' },
      ],
    });

    hydronicManagerHandler(ctx, send);

    expect(send).toHaveBeenCalledWith('zone_1_pump', 'OFF', expect.stringContaining('High humidity 75'));
    expect(send).toHaveBeenCalledWith('main_pump', 'OFF', expect.stringContaining('High humidity 75'));
    expect(ctx.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: '💧 Hydronic Alert',
    }));
    expect(ctx.broadcastState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'blocked',
      condensation_lock: true,
    }));
  });
});
