// src/automation/call_thermostat.js
// Call Thermostat — external thermostat dry contact drives one output and optional pump.

const { parseDemandState, applyMinRunOff, rememberTransition } = require('./helpers/thermostat_common');

const manualState = new Map();

function callThermostatHandler(ctx, send) {
  const instId  = ctx.instance.id;
  const mode    = ctx.settingStr('mode', 'heating');
  const minRunMs = ctx.setting('min_run_time', 120) * 1000;
  const minOffMs = ctx.setting('min_off_time', 120) * 1000;
  const hasPump  = !!ctx.io('zone_1_pump');
  const isOn     = ctx.isOn('zone_1_output');
  const rKey     = String(instId);

  if (mode === 'off') {
    send('zone_1_output', 'OFF', 'Thermostat OFF', { action: 'Call_Thermostat_OFF' });
    if (hasPump) send('zone_1_pump', 'OFF', 'Thermostat OFF', { action: 'Call_Pump_OFF' });
    ctx.broadcastState({ status: 'off', output_on: false, source: 'mode', last_reason: 'Mode is OFF', mode });
    return;
  }

  // Manual override
  const manual = manualState.get(instId);
  if (manual) {
    const reason      = manual.on ? 'Manual ON' : 'Manual OFF';
    const finalActive = applyMinRunOff(isOn, !!manual.on, rKey, minRunMs, minOffMs);
    if (finalActive !== isOn) {
      rememberTransition(rKey, finalActive);
      send('zone_1_output', finalActive ? 'ON' : 'OFF', reason, { action: `Call_Thermostat_${finalActive ? 'ON' : 'OFF'}` });
      if (hasPump) send('zone_1_pump', finalActive ? 'ON' : 'OFF', reason, { action: `Call_Pump_${finalActive ? 'ON' : 'OFF'}` });
    }
    ctx.broadcastState({ status: finalActive ? 'on' : 'off', output_on: finalActive, source: 'manual', last_reason: reason, mode });
    return;
  }

  const callRaw    = ctx.io('zone_1_call') ? ctx.state('zone_1_call') : null;
  const callDemand = parseDemandState(callRaw);

  if (callDemand === null) {
    const reason = callRaw == null ? 'No call signal yet' : `Unknown call state: ${String(callRaw)}`;
    ctx.broadcastState({ status: isOn ? 'on' : 'off', output_on: isOn, source: 'idle', last_reason: reason, mode });
    return;
  }

  const modePart = mode === 'cooling' ? 'Cooling' : 'Heating';
  const reason   = callDemand ? `${modePart} call active` : `${modePart} call inactive`;

  const finalActive = applyMinRunOff(isOn, callDemand, rKey, minRunMs, minOffMs);
  if (finalActive !== isOn) {
    rememberTransition(rKey, finalActive);
    send('zone_1_output', finalActive ? 'ON' : 'OFF', reason, { action: `Call_Thermostat_${finalActive ? 'ON' : 'OFF'}` });
    if (hasPump) send('zone_1_pump', finalActive ? 'ON' : 'OFF', reason, { action: `Call_Pump_${finalActive ? 'ON' : 'OFF'}` });
  }

  ctx.broadcastState({ status: finalActive ? 'on' : 'off', output_on: finalActive, source: 'call', last_reason: reason, mode, call_active: callDemand });
}

function setManual(instId, on) { manualState.set(instId, { on: !!on, ts: Date.now() }); }
function clearManual(instId)   { manualState.delete(instId); }

const CALL_THERMOSTAT_MODULE = {
  id:          'call_thermostat',
  name:        'Call Thermostat',
  icon:        '🌡️',
  description: 'External thermostat call (dry contact) drives one output relay and an optional pump. Min run/off timers protect equipment.',
  color:       '#00c8ff',
  category:    'climate',
  inputs: [
    { key: 'zone_1_call',   label: 'Thermostat Call (DI)', type: 'sensor', required: true,
      description: 'Digital input from external thermostat (ON = demand active).' },
    { key: 'zone_1_output', label: 'Output (DO)',           type: 'relay',  required: true,
      description: 'Valve, fan coil, or boiler relay activated when call is active.' },
    { key: 'zone_1_pump',   label: 'Zone Pump (DO)',        type: 'relay',  required: false,
      description: 'Optional pump output. Follows the output state.' },
  ],
  setpoints: [
    { group: 'Basic', key: 'mode', label: 'Mode', type: 'select', options: ['heating','cooling','off'], default: 'heating',
      help: 'Sets mode label for action logging. Off = output always OFF regardless of call.' },
    { group: 'Timers', key: 'min_run_time', label: 'Min Run Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum ON time before output may turn OFF.' },
    { group: 'Timers', key: 'min_off_time', label: 'Min OFF Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum OFF time before output may start again.' },
  ],
};

module.exports = { callThermostatHandler, setManual, clearManual, CALL_THERMOSTAT_MODULE };
