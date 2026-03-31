// src/automation/interlocked_switches.js
// Interlocked Switches / Aleretour
// Supports:
//  - button mode: one DI can serve many parallel push-buttons
//  - switch mode: each maintained switch gets its own DI, any state change toggles the output(s)

const {
  isTruthyState, setRelays, broadcastState, relayKeys,
} = require('./helpers/light_common');

const manualState = new Map();
const inputState  = new Map();
const initDone    = new Map();
const lastEventTs = new Map();

function diKeys(ctx, controlType) {
  if (controlType === 'button') {
    return ctx.io('switch_di') ? ['switch_di'] : [];
  }
  return [
    'switch_di',
    'switch_di_2',
    'switch_di_3',
    'switch_di_4',
    'switch_di_5',
    'switch_di_6',
  ].filter(k => !!ctx.io(k));
}

function outputOn(ctx) {
  return relayKeys(ctx).some(k => ctx.isOn(k));
}

function toggleOutputs(ctx, send, reason, source) {
  const targetOn = !outputOn(ctx);
  setRelays(send, ctx, targetOn, reason, source, 'Interlocked_Switches');
  broadcastState(ctx, {
    source,
    manual_active: false,
    status: targetOn ? 'on' : 'off',
    output_on: targetOn,
    last_reason: reason,
  });
  return targetOn;
}

function interlockedSwitchesHandler(ctx, send) {
  const instId = ctx.instance.id;
  const controlType = ctx.settingStr('control_type', 'button'); // button | switch
  const debounceMs  = Math.max(50, Number(ctx.setting('debounce_ms', 250)) || 250);

  const keys = diKeys(ctx, controlType);

  // no mapped inputs -> idle
  if (!keys.length) {
    broadcastState(ctx, { source: 'idle', status: outputOn(ctx) ? 'on' : 'off', output_on: outputOn(ctx), last_reason: 'No switch inputs mapped' });
    return;
  }

  // manual override from app
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Interlocked_Switches');
    broadcastState(ctx, {
      manual_active: true,
      source: 'manual',
      status: manual.on ? 'on' : 'off',
      output_on: !!manual.on,
      last_reason: reason,
    });
    return;
  }

  const prev = inputState.get(instId) || {};
  const current = {};
  let changedKey = null;
  let changedOn = false;

  for (const key of keys) {
    const raw = ctx.state(key);
    const on = isTruthyState(raw);
    current[key] = on;

    if (prev[key] !== undefined && prev[key] !== on && !changedKey) {
      changedKey = key;
      changedOn = on;
    }
  }

  // first pass -> just learn initial states, no action
  if (!initDone.get(instId)) {
    inputState.set(instId, current);
    initDone.set(instId, true);
    broadcastState(ctx, {
      source: 'idle',
      status: outputOn(ctx) ? 'on' : 'off',
      output_on: outputOn(ctx),
      last_reason: 'Initialized switch states',
    });
    return;
  }

  inputState.set(instId, current);

  if (!changedKey) {
    broadcastState(ctx, {
      source: 'idle',
      status: outputOn(ctx) ? 'on' : 'off',
      output_on: outputOn(ctx),
      last_reason: 'No change',
    });
    return;
  }

  const now = Date.now();
  const lastTs = lastEventTs.get(instId) || 0;
  if ((now - lastTs) < debounceMs) {
    broadcastState(ctx, {
      source: 'idle',
      status: outputOn(ctx) ? 'on' : 'off',
      output_on: outputOn(ctx),
      last_reason: `Debounced ${changedKey}`,
    });
    return;
  }
  lastEventTs.set(instId, now);

  if (controlType === 'button') {
    // button mode: react only to rising edge
    if (changedOn) {
      toggleOutputs(ctx, send, `${changedKey} pressed`, 'button');
      return;
    }
  } else {
    // switch mode: any state change from any maintained switch toggles the light(s)
    toggleOutputs(ctx, send, `${changedKey} changed to ${changedOn ? 'ON' : 'OFF'}`, 'switch');
    return;
  }

  broadcastState(ctx, {
    source: 'idle',
    status: outputOn(ctx) ? 'on' : 'off',
    output_on: outputOn(ctx),
    last_reason: 'No trigger',
  });
}

function setManual(instId, on) {
  manualState.set(instId, { on: !!on, ts: Date.now() });
}

function clearManual(instId) {
  manualState.delete(instId);
}

const INTERLOCKED_SWITCHES_MODULE = {
  id: 'interlocked_switches',
  name: 'Interlocked Switches',
  icon: '💡',
  description: 'One light from multiple switch points. Button mode supports many parallel push-buttons on one DI. Switch mode uses one DI per maintained switch and toggles on any state change.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di',   label: 'Switch DI 1', type: 'sensor', required: true,  description: 'Primary switch/button input.' },
    { key: 'switch_di_2', label: 'Switch DI 2', type: 'sensor', required: false, description: 'Second maintained switch input.' },
    { key: 'switch_di_3', label: 'Switch DI 3', type: 'sensor', required: false, description: 'Third maintained switch input.' },
    { key: 'switch_di_4', label: 'Switch DI 4', type: 'sensor', required: false, description: 'Fourth maintained switch input.' },
    { key: 'switch_di_5', label: 'Switch DI 5', type: 'sensor', required: false, description: 'Fifth maintained switch input.' },
    { key: 'switch_di_6', label: 'Switch DI 6', type: 'sensor', required: false, description: 'Sixth maintained switch input.' },

    { key: 'light_relay',   label: 'Light Relay (DO)',   type: 'relay', required: true,  description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second output controlled together.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third output controlled together.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth output controlled together.' },
  ],
  setpoints: [
    {
      group: 'Input',
      key: 'control_type',
      label: 'Input type',
      type: 'select',
      options: ['button', 'switch'],
      default: 'button',
      help: 'button = many parallel push-buttons can share one DI. switch = each maintained switch needs its own DI and any state change toggles the light.',
    },
    {
      group: 'Input',
      key: 'debounce_ms',
      label: 'Debounce',
      type: 'number',
      unit: 'ms',
      step: 50,
      default: 250,
      help: 'Ignore rapid repeated input changes inside this window.',
    },
  ],
};

module.exports = {
  interlockedSwitchesHandler,
  setManual,
  clearManual,
  INTERLOCKED_SWITCHES_MODULE,
};
