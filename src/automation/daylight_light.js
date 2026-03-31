// src/automation/daylight_light.js
// Daylight Light — switch + lux sensor. ON only when dark.

const {
  setRelays, broadcastState, handleSwitch, relayKeys,
} = require('./helpers/light_common');

const switchState = new Map();
const manualState = new Map();

function daylightLightHandler(ctx, send) {
  const instId = ctx.instance.id;
  const luxThreshold    = ctx.setting('lux_threshold', 50);
  const luxThresholdOff = ctx.setting('lux_threshold_off', luxThreshold * 1.15);
  const lux = ctx.value('lux_sensor');
  const isOn = relayKeys(ctx).some(k => ctx.isOn(k));
  const isDark = lux == null ? true : lux < luxThreshold;

  // Wall switch — takes priority, can override dashboard manual
  const sw = handleSwitch(ctx, send, instId, { switchState, manualState, fallback: 'Daylight_Light' });
  if (sw.handled) return;

  // Manual override from dashboard
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    setRelays(send, ctx, manual.on, reason, 'Manual', 'Daylight_Light');
    broadcastState(ctx, { manual_active: true, source: 'manual', last_reason: reason, dark: isDark, lux_value: lux });
    return;
  }

  // Lux automation
  if (!isOn && isDark) {
    setRelays(send, ctx, true, `Dark: lux=${lux ?? '?'} < ${luxThreshold}`, 'Lux', 'Daylight_Light');
    broadcastState(ctx, { source: 'lux', dark: true, lux_value: lux, last_reason: `Dark: lux=${lux}`, status: 'on', output_on: true });
    return;
  }
  if (isOn && lux != null && lux >= luxThresholdOff) {
    setRelays(send, ctx, false, `Bright: lux=${lux?.toFixed?.(0) ?? lux}`, 'Lux', 'Daylight_Light');
    broadcastState(ctx, { source: 'lux', dark: false, lux_value: lux, last_reason: `Bright: lux=${lux}`, status: 'off', output_on: false });
    return;
  }

  broadcastState(ctx, { source: 'idle', dark: isDark, lux_value: lux, last_reason: isDark ? `Dark: lux=${lux}` : `Bright: lux=${lux}` });
}

function setManual(instId, on) { manualState.set(instId, { on, ts: Date.now() }); }
function clearManual(instId) { manualState.delete(instId); }

const DAYLIGHT_LIGHT_MODULE = {
  id: 'daylight_light',
  name: 'Daylight Light',
  icon: '\u{1F4A1}',
  description: 'Switch + lux sensor. Light turns ON only when dark enough.',
  color: '#ffd700',
  category: 'lighting',
  inputs: [
    { key: 'switch_di', label: 'Wall Switch (DI)', type: 'sensor', required: false, description: 'Physical wall switch or push button.' },
    { key: 'lux_sensor', label: 'Lux Sensor (AI)', type: 'sensor', unit: 'lux', required: true, description: 'Ambient light sensor in lux.' },
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true, description: 'Primary light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay.' },
  ],
  setpoints: [
    { group: 'Switch', key: 'switch_type', label: 'Switch type', type: 'select', options: ['toggle', 'follow'], default: 'toggle',
      help: 'toggle = push button. follow = rocker switch.' },
    { group: 'Lux', key: 'lux_threshold', label: 'Dark below (ON)', type: 'number', unit: 'lux', step: 10, default: 50,
      help: 'Light activates when lux drops below this value.' },
    { group: 'Lux', key: 'lux_threshold_off', label: 'Bright above (OFF)', type: 'number', unit: 'lux', step: 10, default: 60,
      help: 'Light turns OFF when lux rises above this. Hysteresis prevents rapid toggling.' },
  ],
};

module.exports = { daylightLightHandler, setManual, clearManual, DAYLIGHT_LIGHT_MODULE };
