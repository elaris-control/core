// src/automation/scheduled_motion.js
// Scheduled + Motion — PIR triggers only during schedule window.

const {
  isTruthyState, setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');
const { parseTime, inRange, getSun } = require('./lighting');

const switchState    = new Map();
const manualState    = new Map();
const pirSeenState   = new Map();
const lastMotionTime = new Map();

function scheduledMotionHandler(ctx, send, siteInfo) {
  const instId = ctx.instance.id;
  const now = Date.now();
  const pirTimeout  = ctx.setting('pir_timeout', 300) * 1000;
  const schedOnStr  = ctx.settingStr('schedule_on', '');
  const schedOffStr = ctx.settingStr('schedule_off', '');
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Scheduled_Motion' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Scheduled_Motion');
    broadcastState(ctx, { manual_active: true, source: 'manual', status: manual.on ? 'on' : 'off', output_on: !!manual.on, last_reason: reason });
    return;
  }

  // Schedule check
  const sun = siteInfo ? getSun(siteInfo.lat, siteInfo.lon) : null;
  const schedOn  = parseTime(schedOnStr, sun);
  const schedOff = parseTime(schedOffStr, sun);
  const inSched = (schedOn != null && schedOff != null) ? inRange(nowMin, schedOn, schedOff) : false;

  // PIR
  const pirState = ctx.io('pir_sensor') ? ctx.state('pir_sensor') : null;
  const prevPir = pirSeenState.get(instId);
  pirSeenState.set(instId, pirState);
  const pirOn = isTruthyState(pirState);
  const prevPirOn = isTruthyState(prevPir);

  if (pirOn) lastMotionTime.set(instId, now);
  const timeSince = lastMotionTime.has(instId) ? now - lastMotionTime.get(instId) : Infinity;

  // Outside schedule -> stay OFF
  if (!inSched) {
    if (isOn) {
      setRelays(send, ctx, false, 'Outside schedule', 'Schedule', 'Scheduled_Motion');
    }
    broadcastState(ctx, { source: 'schedule', schedule_active: false, motion_active: !!pirOn, status: 'off', output_on: false, last_reason: 'Outside schedule' });
    return;
  }

  // Inside schedule + motion -> ON
  if (pirOn && !prevPirOn && !isOn) {
    setRelays(send, ctx, true, 'Motion in schedule', 'PIR', 'Scheduled_Motion');
    broadcastState(ctx, { source: 'pir', schedule_active: true, motion_active: true, last_reason: 'Motion in schedule', status: 'on', output_on: true });
    return;
  }

  // Timeout -> OFF
  if (isOn && !pirOn && timeSince > pirTimeout) {
    lastMotionTime.delete(instId);
    setRelays(send, ctx, false, `No motion ${Math.round(timeSince / 1000)}s`, 'PIR', 'Scheduled_Motion');
    broadcastState(ctx, { source: 'pir', schedule_active: true, motion_active: false, last_reason: 'Timeout', status: 'off', output_on: false });
    return;
  }

  broadcastState(ctx, { source: 'idle', schedule_active: true, motion_active: !!pirOn, status: isOn ? 'on' : 'off', output_on: isOn, last_reason: pirOn ? 'Motion active' : 'Waiting for motion' });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const SCHEDULED_MOTION_MODULE = {
  id: 'scheduled_motion',
  name: 'Scheduled + Motion',
  icon: '\u{1F4A1}',
  description: 'Switch + schedule + PIR. Motion triggers only during schedule window.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: false, description: 'Physical wall switch or push button.' },
    { key: 'pir_sensor', label: 'PIR Motion (DI)', type: 'sensor', required: true, description: 'PIR motion detector.' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true, description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button. follow = rocker switch.' },
    { group: 'Schedule', key: 'schedule_on', label: 'ON at', type: 'text', default: '',
      help: 'Start of active window. Format: "HH:MM", "sunset-30", "sunrise+60".' },
    { group: 'Schedule', key: 'schedule_off', label: 'OFF at', type: 'text', default: '',
      help: 'End of active window.' },
    { group: 'Motion', key: 'pir_timeout', label: 'OFF after no motion', type: 'number', unit: 'sec', step: 30, default: 300,
      help: 'Auto-OFF timer within schedule.' },
  ],
};

module.exports = { scheduledMotionHandler, setManual, clearManual, SCHEDULED_MOTION_MODULE };
