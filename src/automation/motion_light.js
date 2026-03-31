// src/automation/motion_light.js
// Motion Light — switch + PIR with auto-OFF timer.

const {
  isTruthyState, setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');

const switchState    = new Map();
const manualState    = new Map();
const pirSeenState   = new Map();
const lastMotionTime = new Map();

function motionLightHandler(ctx, send) {
  const instId = ctx.instance.id;
  const now = Date.now();
  const pirTimeout = ctx.setting('pir_timeout', 300) * 1000;

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Motion_Light' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Motion_Light');
    broadcastState(ctx, { manual_active: true, source: 'manual', status: manual.on ? 'on' : 'off', output_on: !!manual.on, last_reason: reason });
    return;
  }

  // PIR detection
  const pirState = ctx.io('pir_sensor') ? ctx.state('pir_sensor') : null;
  const prevPir = pirSeenState.get(instId);
  pirSeenState.set(instId, pirState);
  const pirOn = isTruthyState(pirState);
  const prevPirOn = isTruthyState(prevPir);
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));

  if (pirOn) lastMotionTime.set(instId, now);
  const timeSince = lastMotionTime.has(instId) ? now - lastMotionTime.get(instId) : Infinity;

  // PIR rising edge -> ON
  if (pirOn && !prevPirOn && !isOn) {
    setRelays(send, ctx, true, 'Motion', 'PIR', 'Motion_Light');
    broadcastState(ctx, { source: 'pir', motion_active: true, last_reason: 'Motion', status: 'on', output_on: true });
    return;
  }

  // Timeout -> OFF
  if (isOn && !pirOn && timeSince > pirTimeout) {
    lastMotionTime.delete(instId);
    setRelays(send, ctx, false, `No motion ${Math.round(timeSince / 1000)}s`, 'PIR', 'Motion_Light');
    broadcastState(ctx, { source: 'pir', motion_active: false, last_reason: 'Timeout', status: 'off', output_on: false });
    return;
  }

  broadcastState(ctx, { source: 'idle', motion_active: !!pirOn, status: isOn ? 'on' : 'off', output_on: isOn, last_reason: pirOn ? 'Motion active' : 'No motion' });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const MOTION_LIGHT_MODULE = {
  id: 'motion_light',
  name: 'Motion Light',
  icon: '\u{1F4A1}',
  description: 'Switch + PIR motion sensor with auto-OFF timer.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: false,
      description: 'Physical wall switch or push button.' },
    { key: 'pir_sensor', label: 'PIR Motion (DI)', type: 'sensor', required: true,
      description: 'PIR motion detector (ON = motion detected).' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true,
      description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select',
      options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button. follow = rocker switch.' },
    { group: 'Motion', key: 'pir_timeout', label: 'OFF after no motion', type: 'number',
      unit: 'sec', step: 30, default: 300,
      help: 'Seconds after last motion before auto-OFF.' },
  ],
};

module.exports = { motionLightHandler, setManual, clearManual, MOTION_LIGHT_MODULE };
