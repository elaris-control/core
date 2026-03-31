// src/automation/motion_daylight.js
// Motion + Daylight — PIR triggers light only when dark.

const {
  isTruthyState, setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');

const switchState    = new Map();
const manualState    = new Map();
const pirSeenState   = new Map();
const lastMotionTime = new Map();

function motionDaylightHandler(ctx, send) {
  const instId = ctx.instance.id;
  const now = Date.now();
  const pirTimeout      = ctx.setting('pir_timeout', 300) * 1000;
  const luxThreshold    = ctx.setting('lux_threshold', 50);
  const luxThresholdOff = ctx.setting('lux_threshold_off', luxThreshold * 1.15);
  const lux  = ctx.value('lux_sensor');
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));
  const isDark = lux == null ? true : lux < luxThreshold;

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Motion_Daylight' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Motion_Daylight');
    broadcastState(ctx, { manual_active: true, source: 'manual', last_reason: reason, dark: isDark, lux_value: lux });
    return;
  }

  // PIR
  const pirState = ctx.io('pir_sensor') ? ctx.state('pir_sensor') : null;
  const prevPir = pirSeenState.get(instId);
  pirSeenState.set(instId, pirState);
  const pirOn = isTruthyState(pirState);
  const prevPirOn = isTruthyState(prevPir);

  if (pirOn) lastMotionTime.set(instId, now);
  const timeSince = lastMotionTime.has(instId) ? now - lastMotionTime.get(instId) : Infinity;

  // Bright override -> OFF
  if (isOn && lux != null && lux >= luxThresholdOff) {
    lastMotionTime.delete(instId);
    setRelays(send, ctx, false, `Bright: lux=${lux}`, 'Lux', 'Motion_Daylight');
    broadcastState(ctx, { source: 'lux', dark: false, motion_active: !!pirOn, lux_value: lux, last_reason: `Bright: lux=${lux}`, status: 'off', output_on: false });
    return;
  }

  // Motion + dark -> ON
  if (pirOn && !prevPirOn && isDark && !isOn) {
    setRelays(send, ctx, true, `Motion+dark lux=${lux ?? '?'}`, 'PIR', 'Motion_Daylight');
    broadcastState(ctx, { source: 'combined', dark: true, motion_active: true, lux_value: lux, last_reason: `Motion+dark lux=${lux}`, status: 'on', output_on: true });
    return;
  }

  // Timeout -> OFF
  if (isOn && !pirOn && timeSince > pirTimeout) {
    lastMotionTime.delete(instId);
    setRelays(send, ctx, false, `No motion ${Math.round(timeSince / 1000)}s`, 'PIR', 'Motion_Daylight');
    broadcastState(ctx, { source: 'pir', dark: isDark, motion_active: false, lux_value: lux, last_reason: 'Timeout', status: 'off', output_on: false });
    return;
  }

  broadcastState(ctx, { source: 'idle', dark: isDark, motion_active: !!pirOn, lux_value: lux, last_reason: pirOn && isDark ? 'Motion + dark' : (!isDark ? 'Bright' : 'No motion') });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const MOTION_DAYLIGHT_MODULE = {
  id: 'motion_daylight',
  name: 'Motion + Daylight',
  icon: '\u{1F4A1}',
  description: 'Switch + PIR + lux. Motion triggers light only when dark.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: false, description: 'Physical wall switch or push button.' },
    { key: 'pir_sensor', label: 'PIR Motion (DI)', type: 'sensor', required: true, description: 'PIR motion detector.' },
    { key: 'lux_sensor', label: 'Lux Sensor (AI)', type: 'sensor', unit: 'lux', required: true, description: 'Ambient light sensor.' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true, description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button. follow = rocker switch.' },
    { group: 'Motion', key: 'pir_timeout', label: 'OFF after no motion', type: 'number', unit: 'sec', step: 30, default: 300,
      help: 'Auto-OFF timer after last motion.' },
    { group: 'Lux', key: 'lux_threshold', label: 'Dark below (ON)', type: 'number', unit: 'lux', step: 10, default: 50,
      help: 'Motion triggers only when lux is below this.' },
    { group: 'Lux', key: 'lux_threshold_off', label: 'Bright above (OFF)', type: 'number', unit: 'lux', step: 10, default: 60,
      help: 'Force OFF when bright.' },
  ],
};

module.exports = { motionDaylightHandler, setManual, clearManual, MOTION_DAYLIGHT_MODULE };
