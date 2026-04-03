// src/automation/scheduled_light.js
// Scheduled Light — switch + schedule ON/OFF with sunrise/sunset support.

const {
  setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');
const { parseTime, inRange, getSun } = require('./lighting');

const switchState = new Map();
const manualState = new Map();

function scheduledLightHandler(ctx, send, siteInfo) {
  const instId = ctx.instance.id;
  const schedOnStr  = ctx.settingStr('schedule_on', '18:00');
  const schedOffStr = ctx.settingStr('schedule_off', '23:00');
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));
  const nowMin = localMinutes(siteInfo);

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Scheduled_Light' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Scheduled_Light');
    broadcastState(ctx, { manual_active: true, source: 'manual', status: manual.on ? 'on' : 'off', output_on: !!manual.on, last_reason: reason });
    return;
  }

  // Schedule automation
  const sun = siteInfo ? getSun(siteInfo.lat, siteInfo.lon) : null;
  const schedOn  = parseTime(schedOnStr, sun);
  const schedOff = parseTime(schedOffStr, sun);

  if (schedOn == null || schedOff == null) {
    broadcastState(ctx, { source: 'idle', schedule_active: false, status: isOn ? 'on' : 'off', output_on: isOn, last_reason: 'Invalid schedule values' });
    return;
  }

  const inSched = inRange(nowMin, schedOn, schedOff);

  if (inSched && !isOn) {
    setRelays(send, ctx, true, `Schedule ON (${schedOnStr || schedOn})`, 'Schedule', 'Scheduled_Light');
  }
  if (!inSched && isOn) {
    setRelays(send, ctx, false, `Schedule OFF (${schedOffStr || schedOff})`, 'Schedule', 'Scheduled_Light');
  }

  broadcastState(ctx, { source: 'schedule', schedule_active: inSched, status: isOn ? 'on' : 'off', output_on: isOn, last_reason: inSched ? 'In schedule window' : 'Outside schedule' });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const SCHEDULED_LIGHT_MODULE = {
  id: 'scheduled_light',
  name: 'Scheduled Light',
  icon: '\u{1F4A1}',
  description: 'Switch + time schedule with sunrise/sunset support.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: false, description: 'Physical wall switch or push button.' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true, description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button. follow = rocker switch.' },
    { group: 'Schedule', key: 'schedule_on', label: 'ON at', type: 'text', default: '18:00',
      help: 'Default 18:00. Format: "HH:MM", "sunset-30", "sunrise+60".' },
    { group: 'Schedule', key: 'schedule_off', label: 'OFF at', type: 'text', default: '23:00',
      help: 'Default 23:00. Same format.' },
  ],
};

module.exports = { scheduledLightHandler, setManual, clearManual, SCHEDULED_LIGHT_MODULE };
