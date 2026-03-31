// src/automation/basic_thermostat.js
// Basic Thermostat — single room sensor, single output. Heating / cooling / off.

const { parseDemandState, applyMinRunOff, rememberTransition } = require('./helpers/thermostat_common');

const manualState = new Map();

const DEFAULTS = {
  cooling: { setpoint: 24, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
  heating: { setpoint: 21, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
};

function basicThermostatHandler(ctx, send) {
  const instId  = ctx.instance.id;
  const mode    = ctx.settingStr('mode', 'heating');

  if (mode === 'off') {
    send('ac_relay', 'OFF', 'Thermostat OFF', { action: 'Basic_Thermostat_OFF' });
    ctx.broadcastState({ status: 'off', output_on: false, source: 'mode', last_reason: 'Mode is OFF', mode });
    return;
  }

  const defaults  = DEFAULTS[mode] || DEFAULTS.heating;
  const setpoint  = ctx.setting('setpoint',     defaults.setpoint);
  const hyst      = ctx.setting('hysteresis',   defaults.hysteresis);
  const minRunMs  = ctx.setting('min_run_time',  defaults.min_run_time) * 1000;
  const minOffMs  = ctx.setting('min_off_time',  defaults.min_off_time) * 1000;
  const isOn      = ctx.isOn('ac_relay');
  const rKey      = String(instId);

  // Manual override
  const manual = manualState.get(instId);
  if (manual) {
    const reason       = manual.on ? 'Manual ON' : 'Manual OFF';
    const finalActive  = applyMinRunOff(isOn, !!manual.on, rKey, minRunMs, minOffMs);
    if (finalActive !== isOn) {
      rememberTransition(rKey, finalActive);
      send('ac_relay', finalActive ? 'ON' : 'OFF', reason, { action: `Basic_Thermostat_${finalActive ? 'ON' : 'OFF'}` });
    }
    ctx.broadcastState({ status: finalActive ? 'on' : 'off', output_on: finalActive, source: 'manual', last_reason: reason, mode, setpoint });
    return;
  }

  const temp = ctx.value('temp_room');
  if (temp === null) {
    ctx.broadcastState({ status: isOn ? 'on' : 'off', output_on: isOn, source: 'idle', last_reason: 'No sensor reading', mode, setpoint });
    return;
  }

  const isCooling = mode === 'cooling';
  let desired = isOn;
  let reason  = `Temp ${temp.toFixed(1)}°C within band`;

  if (isCooling) {
    if (temp >= setpoint + hyst)      { desired = true;  reason = `Temp ${temp.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C → cooling ON`; }
    else if (temp <= setpoint - hyst) { desired = false; reason = `Temp ${temp.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C → cooling OFF`; }
  } else {
    if (temp <= setpoint - hyst)      { desired = true;  reason = `Temp ${temp.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C → heating ON`; }
    else if (temp >= setpoint + hyst) { desired = false; reason = `Temp ${temp.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C → heating OFF`; }
  }

  const finalActive = applyMinRunOff(isOn, desired, rKey, minRunMs, minOffMs);
  if (finalActive !== isOn) {
    rememberTransition(rKey, finalActive);
    send('ac_relay', finalActive ? 'ON' : 'OFF', reason, { action: `Basic_Thermostat_${finalActive ? 'ON' : 'OFF'}` });
  }

  ctx.broadcastState({ status: finalActive ? 'on' : 'off', output_on: finalActive, source: 'temp', last_reason: reason, mode, temp_value: temp, setpoint });
}

function setManual(instId, on) { manualState.set(instId, { on: !!on, ts: Date.now() }); }
function clearManual(instId)   { manualState.delete(instId); }

const BASIC_THERMOSTAT_MODULE = {
  id:          'basic_thermostat',
  name:        'Basic Thermostat',
  icon:        '🌡️',
  description: 'Single room temperature sensor, single output. Heating, cooling, or off with hysteresis and min run/off timers.',
  color:       '#00c8ff',
  category:    'climate',
  inputs: [
    { key: 'temp_room', label: 'Room Temperature', type: 'sensor', unit: '°C', required: true,
      description: 'Room temperature sensor.' },
    { key: 'ac_relay',  label: 'Heat / Cool Output', type: 'relay', required: true,
      description: 'Output relay (fan coil, boiler zone, etc.).' },
  ],
  setpoints: [
    { group: 'Basic', key: 'mode',         label: 'Mode',        type: 'select', options: ['heating','cooling','off'], default: 'heating',
      help: 'Heating = ON when room falls below target. Cooling = ON when room rises above target.' },
    { group: 'Basic', key: 'setpoint',     label: 'Target Temp', type: 'number', unit: '°C', step: 0.5, default: 21,
      help: 'Target room temperature.' },
    { group: 'Basic', key: 'hysteresis',   label: 'Hysteresis',  type: 'number', unit: '°C', step: 0.1, default: 0.5,
      help: 'Dead band around target. Prevents rapid cycling.' },
    { group: 'Timers', key: 'min_run_time', label: 'Min Run Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum ON time before the output may turn OFF.' },
    { group: 'Timers', key: 'min_off_time', label: 'Min OFF Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum OFF time before the output may start again.' },
  ],
};

module.exports = { basicThermostatHandler, setManual, clearManual, BASIC_THERMOSTAT_MODULE };
