// src/automation/zoned_thermostat.js
// Zoned Thermostat — up to 6 zones, each with temp sensor or call contact, output, optional pump, plus central pump.

const { parseDemandState, applyMinRunOff, rememberTransition } = require('./helpers/thermostat_common');

const manualState = new Map();
const MAX_ZONES   = 6;

const DEFAULTS = {
  cooling: { setpoint: 24, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
  heating: { setpoint: 21, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
};

function hasMapping(ctx, key) { return !!ctx.io(key); }

function zoneKeys(ctx, n) {
  return {
    temp:   hasMapping(ctx, `zone_${n}_temp`)   ? `zone_${n}_temp`   : null,
    call:   hasMapping(ctx, `zone_${n}_call`)   ? `zone_${n}_call`   : null,
    output: hasMapping(ctx, `zone_${n}_output`) ? `zone_${n}_output` : null,
    pump:   hasMapping(ctx, `zone_${n}_pump`)   ? `zone_${n}_pump`   : null,
  };
}

function zoneConfigured(ctx, n) {
  const k = zoneKeys(ctx, n);
  return !!(k.temp || k.call || k.output || k.pump);
}

function zoneDisplayName(ctx, n) {
  return String(ctx.settingStr(`zone_${n}_name`, '') || '').trim() || `Zone ${n}`;
}

function evaluateZoneDemand({ ctx, keys, mode, setpoint, hyst }) {
  const isCooling = mode === 'cooling';
  const callRaw   = keys.call ? ctx.state(keys.call) : null;
  const demand    = keys.call ? parseDemandState(callRaw) : null;

  if (demand !== null) {
    return { desiredActive: demand, reason: demand ? 'Call active' : 'Call inactive', source: 'call' };
  }

  const temp = keys.temp ? ctx.value(keys.temp) : null;
  if (temp === null) {
    return { desiredActive: false, reason: 'No sensor reading', source: 'none' };
  }

  let desired = false;
  let reason  = `Temp ${temp.toFixed(1)}°C within band`;

  if (isCooling) {
    if (temp >= setpoint + hyst)      { desired = true;  reason = `Temp ${temp.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C`; }
    else if (temp <= setpoint - hyst) { desired = false; reason = `Temp ${temp.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C`; }
  } else {
    if (temp <= setpoint - hyst)      { desired = true;  reason = `Temp ${temp.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C`; }
    else if (temp >= setpoint + hyst) { desired = false; reason = `Temp ${temp.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C`; }
  }

  return { desiredActive: desired, reason, source: 'temp' };
}

function zonedThermostatHandler(ctx, send) {
  const instId  = ctx.instance.id;
  const mode    = ctx.settingStr('mode', 'heating');
  const defaults = DEFAULTS[mode] || DEFAULTS.heating;
  const globalSp   = ctx.setting('setpoint',     defaults.setpoint);
  const globalHyst = ctx.setting('hysteresis',   defaults.hysteresis);
  const minRunMs   = ctx.setting('min_run_time',  defaults.min_run_time) * 1000;
  const minOffMs   = ctx.setting('min_off_time',  defaults.min_off_time) * 1000;

  if (mode === 'off') {
    for (let n = 1; n <= MAX_ZONES; n++) {
      const k = zoneKeys(ctx, n);
      if (k.output) send(k.output, 'OFF', 'Thermostat OFF', { action: `Zone_${n}_OFF` });
      if (k.pump)   send(k.pump,   'OFF', 'Thermostat OFF', { action: `Zone_${n}_Pump_OFF` });
    }
    if (hasMapping(ctx, 'central_pump')) send('central_pump', 'OFF', 'Thermostat OFF', { action: 'Central_Pump_OFF' });
    ctx.broadcastState({ status: 'off', output_on: false, source: 'mode', last_reason: 'Mode is OFF', mode });
    return;
  }

  // Manual override (all zones)
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    let anyActive = false;
    for (let n = 1; n <= MAX_ZONES; n++) {
      if (!zoneConfigured(ctx, n)) continue;
      const k = zoneKeys(ctx, n);
      const isOn = k.output ? ctx.isOn(k.output) : (k.pump ? ctx.isOn(k.pump) : false);
      const rKey = `${instId}:z${n}`;
      const active = applyMinRunOff(isOn, !!manual.on, rKey, minRunMs, minOffMs);
      if (active !== isOn) {
        rememberTransition(rKey, active);
        if (k.output) send(k.output, active ? 'ON' : 'OFF', reason, { action: `Zone_${n}_${active ? 'ON' : 'OFF'}` });
        if (k.pump)   send(k.pump,   active ? 'ON' : 'OFF', reason, { action: `Zone_${n}_Pump_${active ? 'ON' : 'OFF'}` });
      }
      if (active) anyActive = true;
    }
    if (hasMapping(ctx, 'central_pump')) {
      const centralOn = ctx.isOn('central_pump');
      if (anyActive !== centralOn) send('central_pump', anyActive ? 'ON' : 'OFF', reason, { action: `Central_Pump_${anyActive ? 'ON' : 'OFF'}` });
    }
    ctx.broadcastState({ status: anyActive ? 'on' : 'off', output_on: anyActive, source: 'manual', last_reason: reason, mode });
    return;
  }

  // Zone evaluation
  let anyActive = false;
  const zoneStatus = [];

  for (let n = 1; n <= MAX_ZONES; n++) {
    if (!zoneConfigured(ctx, n)) continue;
    const k    = zoneKeys(ctx, n);
    const name = zoneDisplayName(ctx, n);

    const spRaw   = ctx.setting(`zone_${n}_setpoint`,   NaN);
    const hystRaw = ctx.setting(`zone_${n}_hysteresis`,  NaN);
    const setpoint = isNaN(spRaw)   ? globalSp   : spRaw;
    const hyst     = isNaN(hystRaw) ? globalHyst : hystRaw;

    const demand = evaluateZoneDemand({ ctx, keys: k, mode, setpoint, hyst });
    const isOn   = k.output ? ctx.isOn(k.output) : (k.pump ? ctx.isOn(k.pump) : false);
    const rKey   = `${instId}:z${n}`;
    const active = applyMinRunOff(isOn, demand.desiredActive, rKey, minRunMs, minOffMs);

    if (active !== isOn) {
      rememberTransition(rKey, active);
      if (k.output) send(k.output, active ? 'ON' : 'OFF', demand.reason, { action: `Zone_${n}_${active ? 'ON' : 'OFF'}` });
      if (k.pump)   send(k.pump,   active ? 'ON' : 'OFF', demand.reason, { action: `Zone_${n}_Pump_${active ? 'ON' : 'OFF'}` });
    }

    if (active) anyActive = true;
    zoneStatus.push({ n, name, active, reason: demand.reason });

    // Store per-zone state for dashboard
    ctx.setSetting(`_zone_${n}_status`, active ? 'on' : 'off');
    ctx.setSetting(`_zone_${n}_reason`, demand.reason);
    ctx.setSetting(`_zone_${n}_name`,   name);
  }

  // Central pump follows any active zone
  if (hasMapping(ctx, 'central_pump')) {
    const centralOn = ctx.isOn('central_pump');
    if (anyActive !== centralOn) {
      send('central_pump', anyActive ? 'ON' : 'OFF',
        anyActive ? 'Zone demand active' : 'No zone demand',
        { action: `Central_Pump_${anyActive ? 'ON' : 'OFF'}` });
    }
  }

  const activeZones = zoneStatus.filter(z => z.active).map(z => z.name).join(', ');
  const reason = anyActive
    ? `Active: ${activeZones}`
    : 'No zone demand';

  ctx.broadcastState({ status: anyActive ? 'on' : 'off', output_on: anyActive, source: 'zones', last_reason: reason, mode });
}

function setManual(instId, on) { manualState.set(instId, { on: !!on, ts: Date.now() }); }
function clearManual(instId)   { manualState.delete(instId); }

// Build inputs and zone setpoints for N zones
const zoneInputs = [];
for (let n = 1; n <= MAX_ZONES; n++) {
  zoneInputs.push(
    { key: `zone_${n}_temp`,   label: `Zone ${n} Temperature`, type: 'sensor', unit: '°C', required: false,
      description: `Temp sensor for zone ${n}. Use this or a call contact — not both.` },
    { key: `zone_${n}_call`,   label: `Zone ${n} Call (DI)`,   type: 'sensor',             required: false,
      description: `Thermostat contact for zone ${n} (ON = demand). Use this or a temp sensor — not both.` },
    { key: `zone_${n}_output`, label: `Zone ${n} Output (DO)`, type: 'relay',              required: false,
      description: `Valve or relay for zone ${n}.` },
    { key: `zone_${n}_pump`,   label: `Zone ${n} Pump (DO)`,   type: 'relay',              required: false,
      description: `Optional zone pump for zone ${n}.` },
  );
}

const zoneSetpoints = [];
for (let n = 1; n <= MAX_ZONES; n++) {
  zoneSetpoints.push(
    { group: 'Zones', key: `zone_${n}_name`,       label: `Zone ${n} Name`,        type: 'text',   default: '',
      help: `Custom display name for zone ${n} (e.g. "Living Room").` },
    { group: 'Zones', key: `zone_${n}_setpoint`,   label: `Zone ${n} Setpoint`,    type: 'number', unit: '°C', step: 0.5, default: null,
      help: `Override global setpoint for zone ${n}. Leave empty to use global.` },
    { group: 'Zones', key: `zone_${n}_hysteresis`, label: `Zone ${n} Hysteresis`,  type: 'number', unit: '°C', step: 0.1, default: null,
      help: `Override hysteresis for zone ${n}. Leave empty to use global.` },
  );
}

const ZONED_THERMOSTAT_MODULE = {
  id:          'zoned_thermostat',
  name:        'Zoned Thermostat',
  icon:        '🌡️',
  description: 'Up to 6 zones, each with temp sensor or call contact, zone output, and optional zone pump. Shared central pump. Per-zone name and setpoint overrides.',
  color:       '#00c8ff',
  category:    'climate',
  inputs: [
    ...zoneInputs,
    { key: 'central_pump', label: 'Central Pump (DO)', type: 'relay', required: false,
      description: 'Shared circulation pump. ON when any zone has active demand.' },
  ],
  setpoints: [
    { group: 'Basic', key: 'mode',          label: 'Mode',        type: 'select', options: ['heating','cooling','off'], default: 'heating',
      help: 'All zones follow the same heating/cooling direction.' },
    { group: 'Basic', key: 'setpoint',      label: 'Target Temp', type: 'number', unit: '°C', step: 0.5, default: 21,
      help: 'Global target temperature. Per-zone overrides take precedence.' },
    { group: 'Basic', key: 'hysteresis',    label: 'Hysteresis',  type: 'number', unit: '°C', step: 0.1, default: 0.5,
      help: 'Global dead band. Per-zone overrides take precedence.' },
    { group: 'Timers', key: 'min_run_time', label: 'Min Run Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum ON time per zone output/pump.' },
    { group: 'Timers', key: 'min_off_time', label: 'Min OFF Time', type: 'number', unit: 'sec', step: 30, default: 120,
      help: 'Minimum OFF time before a zone may start again.' },
    ...zoneSetpoints,
  ],
};

module.exports = { zonedThermostatHandler, setManual, clearManual, ZONED_THERMOSTAT_MODULE };
