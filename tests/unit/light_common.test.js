import { describe, it, expect, vi } from 'vitest';
import {
  isTruthyState,
  slugifyActionPart,
  actionName,
  relayKeys,
  setRelays,
  broadcastState,
  handleSwitch,
} from '../../src/automation/helpers/light_common.js';

describe('isTruthyState', () => {
  it('returns true for ON/1/true', () => {
    expect(isTruthyState('ON')).toBe(true);
    expect(isTruthyState('1')).toBe(true);
    expect(isTruthyState('true')).toBe(true);
    expect(isTruthyState(1)).toBe(true);
    expect(isTruthyState(true)).toBe(true);
  });
  it('returns false for OFF/0/null/undefined', () => {
    expect(isTruthyState('OFF')).toBe(false);
    expect(isTruthyState('0')).toBe(false);
    expect(isTruthyState(null)).toBe(false);
    expect(isTruthyState(undefined)).toBe(false);
  });
});

describe('slugifyActionPart', () => {
  it('slugifies whitespace and special chars', () => {
    expect(slugifyActionPart('Hello World!')).toBe('Hello_World');
  });
  it('returns fallback for empty input', () => {
    expect(slugifyActionPart('', 'Light')).toBe('Light');
    expect(slugifyActionPart(null, 'Light')).toBe('Light');
  });
});

describe('actionName', () => {
  it('builds action string from instance name, source, on/off', () => {
    const ctx = { instance: { name: 'Kitchen' }, io: () => null };
    expect(actionName(ctx, 'Switch', true, 'Light')).toBe('Kitchen_Switch_Calling_ON');
  });
  it('uses relay name when single relay mapped', () => {
    const ctx = {
      instance: { name: 'Room' },
      io: (k) => k === 'light_relay' ? { name: 'Ceiling Lamp' } : null,
    };
    expect(actionName(ctx, 'PIR', false, 'Light')).toBe('Ceiling_Lamp_PIR_Calling_OFF');
  });
});

describe('relayKeys', () => {
  it('returns only mapped relay keys', () => {
    const ctx = {
      io: (k) => (k === 'light_relay' || k === 'light_relay_3') ? { id: 1 } : null,
    };
    expect(relayKeys(ctx)).toEqual(['light_relay', 'light_relay_3']);
  });
});

describe('setRelays', () => {
  it('sends ON to all mapped relays, logs only first', () => {
    const ctx = {
      instance: { name: 'Hall' },
      io: (k) => (k === 'light_relay' || k === 'light_relay_2') ? { id: 1 } : null,
    };
    const send = vi.fn();
    setRelays(send, ctx, true, 'Test reason', 'Switch', 'Light');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]).toBe('ON');
    expect(send.mock.calls[0][3]).toHaveProperty('action');
    expect(send.mock.calls[1][3]).toHaveProperty('skipLog', true);
  });
});

describe('broadcastState', () => {
  it('calls ctx.broadcastState with defaults merged', () => {
    const ctx = {
      isOn: () => true,
      io: (k) => k === 'light_relay' ? { id: 1 } : null,
      broadcastState: vi.fn(),
    };
    broadcastState(ctx, { source: 'test' });
    expect(ctx.broadcastState).toHaveBeenCalledTimes(1);
    const arg = ctx.broadcastState.mock.calls[0][0];
    expect(arg.output_on).toBe(true);
    expect(arg.status).toBe('on');
    expect(arg.source).toBe('test');
  });
});

describe('handleSwitch', () => {
  it('toggle mode: rising edge flips light OFF->ON', () => {
    const switchState = new Map();
    const manualState = new Map();
    const ctx = {
      instance: { id: 1 },
      io: (k) => k === 'switch_di' ? { id: 1 } : (k === 'light_relay' ? { id: 2 } : null),
      state: () => 'ON',
      isOn: () => false,
      setting: (k, d) => k === 'switch_type' ? 1 : d,
      settingStr: (k, d) => k === 'switch_type' ? 'toggle' : d,
      broadcastState: vi.fn(),
    };
    const send = vi.fn();
    const result = handleSwitch(ctx, send, 1, { switchState, manualState, fallback: 'Light' });
    expect(result.handled).toBe(true);
    expect(result.manualActive).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('follow mode: DI ON -> light ON, DI OFF -> light OFF', () => {
    const switchState = new Map();
    const manualState = new Map();
    switchState.set(1, 'OFF');
    const ctx = {
      instance: { id: 1 },
      io: (k) => k === 'switch_di' ? { id: 1 } : (k === 'light_relay' ? { id: 2 } : null),
      state: () => 'ON',
      isOn: () => false,
      setting: (k, d) => k === 'switch_type' ? 0 : d,
      settingStr: (k, d) => k === 'switch_type' ? 'follow' : d,
      broadcastState: vi.fn(),
    };
    const send = vi.fn();
    const result = handleSwitch(ctx, send, 1, { switchState, manualState, fallback: 'Light' });
    expect(result.handled).toBe(true);
    expect(send.mock.calls[0][1]).toBe('ON');
  });

  it('no change: returns handled=false', () => {
    const switchState = new Map();
    const manualState = new Map();
    switchState.set(1, 'ON');
    const ctx = {
      instance: { id: 1 },
      io: (k) => k === 'switch_di' ? { id: 1 } : (k === 'light_relay' ? { id: 2 } : null),
      state: () => 'ON',
      isOn: () => true,
      setting: (k, d) => k === 'switch_type' ? 1 : d,
      settingStr: (k, d) => k === 'switch_type' ? 'toggle' : d,
      broadcastState: vi.fn(),
    };
    const send = vi.fn();
    const result = handleSwitch(ctx, send, 1, { switchState, manualState, fallback: 'Light' });
    expect(result.handled).toBe(false);
  });
});
