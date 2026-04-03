// src/automation/basic_light.js
// Basic Light — simplest lighting module: switch (DI) controls relay(s).

const {
  setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');

const switchState = new Map();
const manualState = new Map();

function basicLightHandler(ctx, send) {
  const instId = ctx.instance.id;
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Basic_Light' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const isOn = relayKeys(ctx).some(k => ctx.isOn(k));
    if (isOn !== manual.on) {
      const reason = manual.on ? 'Manual ON' : 'Manual OFF';
      setRelays(send, ctx, manual.on, reason, 'Manual', 'Basic_Light');
      broadcastState(ctx, { manual_active: true, source: 'manual', status: manual.on ? 'on' : 'off', output_on: !!manual.on, last_reason: reason });
    } else {
      broadcastState(ctx, { manual_active: true, source: 'manual', status: isOn ? 'on' : 'off', output_on: isOn, last_reason: 'Already set' });
    }
    return;
  }

  // Idle
  broadcastState(ctx, { source: 'idle', status: isOn ? 'on' : 'off', output_on: isOn, last_reason: 'No change' });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const BASIC_LIGHT_MODULE = {
  id: 'basic_light',
  name: 'Basic Light',
  icon: '\u{1F4A1}',
  description: 'Simple switch-to-relay lighting. Follow mode (rocker) or toggle mode (push button).',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: true,
      description: 'Physical wall switch or push button.' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true,
      description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false,
      description: 'Second relay output controlled together.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false,
      description: 'Third relay output controlled together.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false,
      description: 'Fourth relay output controlled together.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select',
      options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button (each press flips ON/OFF). follow = rocker switch (light mirrors switch position).' },
  ],
};

module.exports = { basicLightHandler, setManual, clearManual, BASIC_LIGHT_MODULE };
