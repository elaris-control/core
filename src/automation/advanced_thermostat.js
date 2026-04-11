// src/automation/thermostat.js
// ❄️🔥 Thermostat module — simple single-zone OR zoned heating/cooling with optional outputs/pumps

const DEFAULTS = {
  cooling: { setpoint: 24, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
  heating: { setpoint: 21, hysteresis: 0.5, min_run_time: 120, min_off_time: 120 },
};

const lastOnTime    = new Map(); // key -> ts
const lastOffTime   = new Map(); // key -> ts
const tempHistory   = new Map(); // instId → [{ v, ts }]  for window detection
const windowLockout = new Map(); // instId → ts (when lockout expires)
const preLead       = new Map(); // instId → computed lead minutes
const centralPumpPostRun = new Map(); // instId -> ts until central pump should remain ON
const manualState   = new Map(); // instId → { on, ts }
const zoneManualState = new Map(); // instId -> Map<zone, boolean>

const WINDOW_WINDOW_MS = 2 * 60 * 1000; // 2 min rolling window
const MAX_ZONES = 6;

function runtimeKey(instId, zone) {
  return `${instId}:${zone}`;
}

function hasMapping(ctx, key) {
  return !!ctx.io(key);
}

function parseDemandState(raw) {
  if (raw == null) return null;
  const up = String(raw).trim().toUpperCase();
  if (!up) return null;
  if (["ON", "1", "TRUE", "OPEN", "CALL", "HEAT", "YES"].includes(up)) return true;
  if (["OFF", "0", "FALSE", "CLOSED", "CLOSE", "NO"].includes(up)) return false;
  return null;
}

function zoneKeys(ctx, n) {
  const tempKeyLegacy = n === 1 && hasMapping(ctx, 'temp_room') ? 'temp_room' : null;
  const outputLegacy  = n === 1 && hasMapping(ctx, 'ac_relay') ? 'ac_relay' : null;
  return {
    temp: hasMapping(ctx, `zone_${n}_temp`) ? `zone_${n}_temp` : tempKeyLegacy,
    call: hasMapping(ctx, `zone_${n}_call`) ? `zone_${n}_call` : null,
    output: hasMapping(ctx, `zone_${n}_output`) ? `zone_${n}_output` : outputLegacy,
    pump: hasMapping(ctx, `zone_${n}_pump`) ? `zone_${n}_pump` : null,
  };
}

function zoneConfigured(ctx, n) {
  const keys = zoneKeys(ctx, n);
  return !!(keys.temp || keys.call || keys.output || keys.pump);
}

function zoneCurrentActive(ctx, instId, n, keys) {
  if (keys.output) return ctx.isOn(keys.output);
  if (keys.pump) return ctx.isOn(keys.pump);
  const raw = ctx.settingStr(`_zone_${n}_state`, '0');
  return Number(raw) === 1;
}

function applyMinRunOff(currentActive, desiredActive, key, minRunMs, minOffMs) {
  const now = Date.now();
  if (currentActive === desiredActive) return desiredActive;
  if (currentActive && lastOnTime.has(key) && (now - lastOnTime.get(key) < minRunMs)) return true;
  if (!currentActive && lastOffTime.has(key) && (now - lastOffTime.get(key) < minOffMs)) return false;
  return desiredActive;
}

function rememberTransition(key, active) {
  const now = Date.now();
  if (active) {
    lastOnTime.set(key, now);
    lastOffTime.delete(key);
  } else {
    lastOnTime.delete(key);
    lastOffTime.set(key, now);
  }
}

function sendIfMapped(send, key, value, reason, meta = {}) {
  if (!key) return;
  send(key, value, reason, meta || {});
}

function zoneDisplayName(ctx, zone) {
  const custom = String(ctx.settingStr(`zone_${zone}_name`, '') || '').trim();
  return custom || `Zone ${zone}`;
}

function slugifyActionPart(input, fallback = 'Zone') {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const slug = raw
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function zoneCallingAction(name, mode, state) {
  const zone = slugifyActionPart(name);
  const modePart = mode === 'cooling' ? 'Cool' : 'Heat';
  return `${zone}_${modePart}_Calling_${state}`;
}

function zonePumpAction(name, state) {
  return `${slugifyActionPart(name)}_Pump_${state}`;
}

function stateReasonPrefix(mode) {
  if (mode === 'cooling') return 'Cooling';
  if (mode === 'heating') return 'Heating';
  return 'Thermostat';
}

function setZoneStatus(ctx, zone, data = {}) {
  const prefix = `_zone_${zone}_`;
  Object.entries(data).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    ctx.setSetting(prefix + k, String(v));
  });
}

function setCentralStatus(ctx, data = {}) {
  Object.entries(data).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    ctx.setSetting(`_central_${k}`, String(v));
  });
}

// Returns the active scheduled setpoint for a zone, or null if no slot matches
function getScheduledSetpoint(scheduleJson) {
  if (!scheduleJson) return null;
  try {
    const slots = JSON.parse(scheduleJson);
    if (!Array.isArray(slots) || !slots.length) return null;
    const now   = new Date();
    const day   = now.getDay(); // 0=Sun … 6=Sat
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];
    for (const slot of slots) {
      const d = String(slot.days || 'all').toLowerCase();
      const dayMatch =
        d === 'all' ||
        (d === 'weekday' && day >= 1 && day <= 5) ||
        (d === 'weekend' && (day === 0 || day === 6)) ||
        DAY_NAMES[day] === d;
      if (!dayMatch) continue;
      const [sh, sm] = String(slot.start || '00:00').split(':').map(Number);
      const [eh, em] = String(slot.end   || '23:59').split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      const inRange  = startMin <= endMin
        ? (nowMin >= startMin && nowMin < endMin)
        : (nowMin >= startMin || nowMin < endMin); // overnight
      if (inRange && slot.setpoint !== undefined) return parseFloat(slot.setpoint);
    }
  } catch (e) {
    console.warn('[THERMOSTAT] Invalid schedule JSON:', e.message, '| raw:', String(scheduleJson).slice(0, 100));
  }
  return null;
}

// Returns { setpoint, hyst } for a zone — per-zone override → schedule → global fallback
function resolveZoneSetpoint(ctx, zone, globalSetpoint, globalHyst) {
  const zsp  = ctx.setting(`zone_${zone}_setpoint`, NaN);
  const zhyst = ctx.setting(`zone_${zone}_hysteresis`, NaN);
  let setpoint = isNaN(zsp) ? globalSetpoint : zsp;
  const hyst   = isNaN(zhyst) ? globalHyst : zhyst;
  const sched  = getScheduledSetpoint(ctx.settingStr(`zone_${zone}_schedule`, ''));
  if (sched !== null) setpoint = sched;
  return { setpoint, hyst };
}

function evaluateZoneDemand({ ctx, zone, keys, mode, setpoint, hyst }) {
  const isCooling = mode === 'cooling';
  const tempVal = keys.temp ? ctx.value(keys.temp) : null;
  const callMapped = !!keys.call;
  const callRaw = callMapped ? ctx.state(keys.call) : null;
  const callDemand = callMapped ? parseDemandState(callRaw) : null;
  const hasExplicitCallValue = callMapped && callRaw != null && String(callRaw).trim() !== '';

  if (callDemand !== null) {
    return {
      configured: true,
      source: 'call',
      desiredActive: callDemand,
      tempVal,
      callDemand,
      rawCall: callRaw,
      reason: callDemand ? 'Thermostat call active' : 'Thermostat call inactive',
    };
  }

  if (callMapped && hasExplicitCallValue) {
    return {
      configured: true,
      source: 'invalid_call',
      desiredActive: false,
      tempVal,
      callDemand,
      rawCall: callRaw,
      reason: `Invalid thermostat call state: ${String(callRaw)}`,
    };
  }

  if (tempVal === null) {
    return {
      configured: false,
      source: callMapped ? 'call_unreadable' : 'none',
      desiredActive: false,
      tempVal,
      callDemand,
      rawCall: callRaw,
      reason: callMapped ? 'No valid thermostat call state yet' : 'No valid demand source',
    };
  }

  let desired = false;
  let reason = 'Within hysteresis band';
  if (isCooling) {
    if (tempVal >= setpoint + hyst) {
      desired = true;
      reason = `Temp ${tempVal.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C`;
    } else if (tempVal <= setpoint - hyst) {
      desired = false;
      reason = `Temp ${tempVal.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C`;
    } else {
      reason = `Temp ${tempVal.toFixed(1)}°C within cooling band`;
    }
  } else {
    if (tempVal <= setpoint - hyst) {
      desired = true;
      reason = `Temp ${tempVal.toFixed(1)}°C <= ${(setpoint - hyst).toFixed(1)}°C`;
    } else if (tempVal >= setpoint + hyst) {
      desired = false;
      reason = `Temp ${tempVal.toFixed(1)}°C >= ${(setpoint + hyst).toFixed(1)}°C`;
    } else {
      reason = `Temp ${tempVal.toFixed(1)}°C within heating band`;
    }
  }

  return {
    configured: true,
    source: 'temp',
    desiredActive: desired,
    tempVal,
    callDemand,
    rawCall: callRaw,
    reason,
  };
}

function zonedThermostatHandler(ctx, send) {
  const mode      = ctx.settingStr('mode', 'heating');
  const defaults  = DEFAULTS[mode] || DEFAULTS.heating;
  const setpoint  = ctx.setting('setpoint', defaults.setpoint);
  const hyst      = ctx.setting('hysteresis', defaults.hysteresis);
  const minRunMs  = ctx.setting('min_run_time', defaults.min_run_time) * 1000;
  const minOffMs  = ctx.setting('min_off_time', defaults.min_off_time) * 1000;
  const pumpPostRunMs = Math.max(0, ctx.setting('pump_post_run', 60)) * 1000;
  const instId    = ctx.instance.id;
  const now       = Date.now();

  const holidayMode = ctx.settingStr('holiday_mode', 'off') === 'on';
  const holidaySetpoint = ctx.setting('holiday_setpoint', mode === 'cooling' ? 32 : 7);

  if (mode === 'off') {
    centralPumpPostRun.delete(instId);
    let configuredZones = 0;
    for (let zone = 1; zone <= MAX_ZONES; zone++) {
      if (!zoneConfigured(ctx, zone)) continue;
      configuredZones++;
      const keys = zoneKeys(ctx, zone);
      const zoneName = zoneDisplayName(ctx, zone);
      ctx.setSetting(`_zone_${zone}_state`, '0');
      setZoneStatus(ctx, zone, {
        status: 'off',
        source: keys.call ? 'call' : (keys.temp ? 'temp' : 'none'),
        demand: '0',
        output_state: '0',
        pump_state: '0',
        reason: 'Thermostat mode OFF',
      });
      if (keys.output) sendIfMapped(send, keys.output, 'OFF', `${zoneName} thermostat OFF`, { action: zoneCallingAction(zoneName, mode, 'OFF') });
      if (keys.pump) sendIfMapped(send, keys.pump, 'OFF', `${zoneName} pump OFF`, { action: zonePumpAction(zoneName, 'OFF') });
    }
    if (hasMapping(ctx, 'central_pump')) send('central_pump', 'OFF', 'Central pump OFF (thermostat mode OFF)', { action: 'Central_Pump_OFF' });
    setCentralStatus(ctx, {
      state: '0',
      reason: 'Thermostat mode OFF',
      configured_zones: String(configuredZones),
      calling_zones: '0',
      di_calling: '0',
      temp_calling: '0',
    });
    return;
  }

  // Manual override (all zones)
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    let anyActive = false;
    let configuredZones = 0;
    for (let zone = 1; zone <= MAX_ZONES; zone++) {
      if (!zoneConfigured(ctx, zone)) continue;
      configuredZones++;
      const keys = zoneKeys(ctx, zone);
      const zoneName = zoneDisplayName(ctx, zone);
      const outputCurrent = keys.output ? ctx.isOn(keys.output) : false;
      const pumpCurrent = keys.pump ? ctx.isOn(keys.pump) : false;
      const outKey = runtimeKey(instId, `zone_${zone}_output`);
      const pumpKey = runtimeKey(instId, `zone_${zone}_pump`);
      const outputFinal = keys.output ? applyMinRunOff(outputCurrent, !!manual.on, outKey, minRunMs, minOffMs) : false;
      const pumpFinal = keys.pump ? applyMinRunOff(pumpCurrent, !!manual.on, pumpKey, minRunMs, minOffMs) : false;
      if (keys.output && outputFinal !== outputCurrent) {
        rememberTransition(outKey, outputFinal);
        sendIfMapped(send, keys.output, outputFinal ? 'ON' : 'OFF', `${zoneName} manual ${outputFinal ? 'ON' : 'OFF'}`, { action: zoneCallingAction(zoneName, mode, outputFinal ? 'ON' : 'OFF') });
      }
      if (keys.pump && pumpFinal !== pumpCurrent) {
        rememberTransition(pumpKey, pumpFinal);
        sendIfMapped(send, keys.pump, pumpFinal ? 'ON' : 'OFF', `${zoneName} pump manual ${pumpFinal ? 'ON' : 'OFF'}`, { action: zonePumpAction(zoneName, pumpFinal ? 'ON' : 'OFF') });
      }
      if (outputFinal || pumpFinal) anyActive = true;
      setZoneStatus(ctx, zone, {
        status: (outputFinal || pumpFinal) ? 'on' : 'off',
        source: 'manual',
        demand: manual.on ? '1' : '0',
        output_state: outputFinal ? '1' : '0',
        pump_state: pumpFinal ? '1' : '0',
        reason,
      });
    }
    if (hasMapping(ctx, 'central_pump')) {
      const currentCentral = ctx.isOn('central_pump');
      const centralFinal = applyMinRunOff(currentCentral, anyActive, runtimeKey(instId, 'central_pump'), minRunMs, minOffMs);
      if (centralFinal !== currentCentral) {
        rememberTransition(runtimeKey(instId, 'central_pump'), centralFinal);
        send('central_pump', centralFinal ? 'ON' : 'OFF', `Central pump manual ${centralFinal ? 'ON' : 'OFF'}`, { action: `Central_Pump_${centralFinal ? 'ON' : 'OFF'}` });
      }
      setCentralStatus(ctx, {
        state: centralFinal ? '1' : '0',
        reason,
        configured_zones: String(configuredZones),
        calling_zones: anyActive ? String(configuredZones) : '0',
        di_calling: '0',
        temp_calling: '0',
      });
    }
    ctx.broadcastState({
      status: anyActive ? 'on' : 'off',
      output_on: anyActive,
      source: 'manual',
      manual_active: true,
      last_reason: reason,
      mode,
      calling_zones: anyActive ? configuredZones : 0,
      configured_zones: configuredZones,
      di_calling: 0,
      temp_calling: 0,
    });
    return;
  }

  let anyDemand = false;
  let configuredZones = 0;
  let callingZones = 0;
  let diCalling = 0;
  let tempCalling = 0;

  for (let zone = 1; zone <= MAX_ZONES; zone++) {
    if (!zoneConfigured(ctx, zone)) continue;
    configuredZones++;
    const keys = zoneKeys(ctx, zone);
    const zoneName = zoneDisplayName(ctx, zone);
    const zoneResolved = resolveZoneSetpoint(ctx, zone, holidayMode ? holidaySetpoint : setpoint, hyst);
    const evald = evaluateZoneDemand({ ctx, zone, keys, mode, setpoint: zoneResolved.setpoint, hyst: zoneResolved.hyst });

    // Per-zone manual override
    const zManual = zoneManualState.get(instId);
    const zManualOn = zManual && zManual.has(zone) ? zManual.get(zone) : null;
    let desiredActive = evald.desiredActive;
    let reason = evald.reason;
    if (zManualOn !== null) {
      desiredActive = zManualOn;
      reason = zManualOn ? `${zoneName} manual ON` : `${zoneName} manual OFF`;
    }

    const outputCurrent = keys.output ? ctx.isOn(keys.output) : false;
    const pumpCurrent = keys.pump ? ctx.isOn(keys.pump) : false;
    let outputFinal = false;
    let pumpFinal = false;

    if (evald.tempVal !== null) setZoneStatus(ctx, zone, { last_temp: Number(evald.tempVal).toFixed(1) });
    if (evald.callDemand !== null) setZoneStatus(ctx, zone, { last_call: evald.callDemand ? '1' : '0' });

    if (!evald.configured) {
      ctx.setSetting(`_zone_${zone}_state`, '0');
      setZoneStatus(ctx, zone, {
        status: 'off',
        source: evald.source,
        demand: '0',
        output_state: '0',
        pump_state: '0',
        reason: reason,
      });
      if (keys.output) sendIfMapped(send, keys.output, 'OFF', `${zoneName} idle (no valid demand source)`, { action: zoneCallingAction(zoneName, mode, 'OFF') });
      if (keys.pump) sendIfMapped(send, keys.pump, 'OFF', `${zoneName} pump OFF (no valid demand source)`, { action: zonePumpAction(zoneName, 'OFF') });
      continue;
    }

    if (evald.desiredActive) {
      anyDemand = true;
      callingZones++;
      if (evald.source === 'call') diCalling++;
      else if (evald.source === 'temp') tempCalling++;
    }

    if (keys.output) {
      const outKey = runtimeKey(instId, `zone_${zone}_output`);
      outputFinal = applyMinRunOff(outputCurrent, desiredActive, outKey, minRunMs, minOffMs);
      if (outputFinal !== outputCurrent) rememberTransition(outKey, outputFinal);
      sendIfMapped(send, keys.output, outputFinal ? 'ON' : 'OFF', `${zoneName} ${stateReasonPrefix(mode)} output ${outputFinal ? 'ON' : 'OFF'} (${reason})`, { action: zoneCallingAction(zoneName, mode, outputFinal ? 'ON' : 'OFF') });
      if (outputFinal !== desiredActive) reason += outputFinal ? ' · held by min run' : ' · held by min off';
    }

    if (keys.pump) {
      const pumpKey = runtimeKey(instId, `zone_${zone}_pump`);
      pumpFinal = applyMinRunOff(pumpCurrent, desiredActive, pumpKey, minRunMs, minOffMs);
      if (pumpFinal !== pumpCurrent) rememberTransition(pumpKey, pumpFinal);
      sendIfMapped(send, keys.pump, pumpFinal ? 'ON' : 'OFF', `${zoneName} pump ${pumpFinal ? 'ON' : 'OFF'} (${reason})`, { action: zonePumpAction(zoneName, pumpFinal ? 'ON' : 'OFF') });
      if (!keys.output && pumpFinal !== desiredActive) reason += pumpFinal ? ' · pump held by min run' : ' · pump held by min off';
    }

    const storedState = outputFinal || pumpFinal || desiredActive;
    ctx.setSetting(`_zone_${zone}_state`, storedState ? '1' : '0');
    ctx.setSetting(`_zone_${zone}_manual`, zManualOn !== null ? (zManualOn ? '1' : '0') : '');
    setZoneStatus(ctx, zone, {
      status: storedState ? 'on' : 'off',
      source: evald.source,
      demand: evald.desiredActive ? '1' : '0',
      output_state: outputFinal ? '1' : '0',
      pump_state: pumpFinal ? '1' : '0',
      reason,
    });
  }

  const hasCentralPump = hasMapping(ctx, 'central_pump');
  if (hasCentralPump) {
    const current = ctx.isOn('central_pump');
    let desired = anyDemand;
    if (anyDemand) {
      centralPumpPostRun.set(instId, now + pumpPostRunMs);
    } else {
      const holdUntil = centralPumpPostRun.get(instId) || 0;
      if (holdUntil > now) desired = true;
      else centralPumpPostRun.delete(instId);
    }
    const rk = runtimeKey(instId, 'central_pump');
    const finalCentral = applyMinRunOff(current, desired, rk, minRunMs, minOffMs);
    if (finalCentral !== current) rememberTransition(rk, finalCentral);
    let centralReason = anyDemand
      ? 'At least one zone demands service'
      : (desired ? `Pump post-run active (${Math.ceil(((centralPumpPostRun.get(instId) || now) - now) / 1000)}s left)` : 'No zone demand');
    if (finalCentral !== desired) centralReason += finalCentral ? ' · held by min run' : ' · held by min off';
    send('central_pump', finalCentral ? 'ON' : 'OFF', `Central pump ${finalCentral ? 'ON' : 'OFF'} (${centralReason})`, { action: `Central_Pump_${finalCentral ? 'ON' : 'OFF'}` });
    setCentralStatus(ctx, {
      state: finalCentral ? '1' : '0',
      reason: centralReason,
      configured_zones: String(configuredZones),
      calling_zones: String(callingZones),
      di_calling: String(diCalling),
      temp_calling: String(tempCalling),
      post_run_until: String(centralPumpPostRun.get(instId) || 0),
    });
  } else {
    setCentralStatus(ctx, {
      state: '0',
      reason: anyDemand ? 'Demand present but no central pump mapped' : 'No central pump mapped',
      configured_zones: String(configuredZones),
      calling_zones: String(callingZones),
      di_calling: String(diCalling),
      temp_calling: String(tempCalling),
      post_run_until: '0',
    });
  }

  // Humidity control (optional — only if humidity sensor mapped)
  if (hasMapping(ctx, 'humidity')) {
    const humVal = ctx.value('humidity');
    if (humVal !== null && hasMapping(ctx, 'humidity_relay')) {
      const humSp   = ctx.setting('humidity_setpoint', 55);
      const humHyst = ctx.setting('humidity_hysteresis', 3);
      const humOn   = ctx.isOn('humidity_relay');
      let humDesired = humOn;
      if (humVal >= humSp + humHyst) humDesired = true;
      else if (humVal <= humSp - humHyst) humDesired = false;
      if (humDesired !== humOn) {
        send('humidity_relay', humDesired ? 'ON' : 'OFF',
          `Humidity ${humVal.toFixed(1)}% ${humDesired ? '>=' : '<='} ${humDesired ? humSp + humHyst : humSp - humHyst}%`, { action: `Thermostat_Humidity_${humDesired ? 'ON' : 'OFF'}` });
      }
      ctx.setSetting('_humidity', String(humVal.toFixed(1)));
      ctx.setSetting('_humidity_relay', humDesired ? '1' : '0');
    }
  }

  ctx.broadcastState({
    status: anyDemand ? 'on' : 'off',
    output_on: anyDemand,
    source: 'zones',
    manual_active: false,
    last_reason: anyDemand ? 'Zone demand active' : 'No zone demand',
    mode,
    calling_zones: callingZones,
    configured_zones: configuredZones,
    di_calling: diCalling,
    temp_calling: tempCalling,
  });
}

function legacySingleZoneHandler(ctx, send) {
  const mode      = ctx.settingStr("mode", "cooling");
  const isCooling = mode === "cooling";
  const defaults  = DEFAULTS[mode] || DEFAULTS.cooling;
  if (mode === 'off') {
    send('ac_relay', 'OFF', 'Thermostat OFF', { action: 'Thermostat_Legacy_Output_OFF' });
    ctx.broadcastState({ status: 'off', output_on: false, source: 'mode', manual_active: false, last_reason: 'Mode is OFF', mode });
    return;
  }
  const setpoint  = ctx.setting("setpoint",    defaults.setpoint);
  const hyst      = ctx.setting("hysteresis",  defaults.hysteresis);
  const minRun    = ctx.setting("min_run_time", defaults.min_run_time) * 1000;
  const minOff    = ctx.setting("min_off_time", defaults.min_off_time) * 1000;

  const tempRoom    = ctx.value("temp_room");
  if (tempRoom === null) {
    ctx.broadcastState({ status: 'off', output_on: false, source: 'sensor', manual_active: false, last_reason: 'No sensor reading', mode });
    return;
  }

  const isOn   = ctx.isOn("ac_relay");
  const now    = Date.now();
  const instId = ctx.instance.id;

  // Manual override
  const manual = manualState.get(instId);
  if (manual) {
    const reason = manual.on ? 'Manual ON' : 'Manual OFF';
    const legacyKey = runtimeKey(instId, 'legacy');
    const finalActive = applyMinRunOff(isOn, !!manual.on, legacyKey, minRun, minOff);
    if (finalActive !== isOn) {
      rememberTransition(legacyKey, finalActive);
      send("ac_relay", finalActive ? "ON" : "OFF", reason, { action: `Thermostat_Legacy_Output_${finalActive ? 'ON' : 'OFF'}` });
    }
    ctx.broadcastState({
      status: finalActive ? 'on' : 'off',
      output_on: finalActive,
      source: 'manual',
      manual_active: true,
      last_reason: reason,
      mode,
      temp: tempRoom != null ? Number(tempRoom).toFixed(1) : null,
      setpoint,
    });
    return;
  }

  const windowDetect = ctx.setting("window_detect", 1);
  const windowDrop   = ctx.setting("window_drop", 0.5);

  if (!tempHistory.has(instId)) tempHistory.set(instId, []);
  const hist = tempHistory.get(instId);
  hist.push({ v: tempRoom, ts: now });
  while (hist.length && hist[0].ts < now - WINDOW_WINDOW_MS) hist.shift();

  if (windowDetect && isOn && hist.length >= 2) {
    const oldest   = hist[0].v;
    const change   = tempRoom - oldest;
    const unexpectedChange = isCooling ? change : -change;
    if (unexpectedChange >= windowDrop) {
      windowLockout.set(instId, now + 10 * 60 * 1000);
      send("ac_relay", "OFF", `Open window: temp ${isCooling?"rose":"dropped"} ${Math.abs(change).toFixed(2)}°C in 2min — turning off`, { action: 'Thermostat_Legacy_Output_OFF' });
      lastOnTime.delete(runtimeKey(instId, 'legacy'));
      lastOffTime.set(runtimeKey(instId, 'legacy'), now);
      return;
    }
  }

  if (windowLockout.has(instId) && now > windowLockout.get(instId)) {
    windowLockout.delete(instId);
  }

  if (windowLockout.has(instId)) return;

  const preEnable  = ctx.setting("pre_enable", 0);
  const preTarget  = ctx.settingStr("pre_target_time", "07:00");
  const tempOutdoor= ctx.value("temp_outdoor");

  if (preEnable && tempOutdoor !== null && preTarget) {
    const [ph, pm] = preTarget.split(":").map(Number);
    const now_d    = new Date();
    const nowMin   = now_d.getHours() * 60 + now_d.getMinutes();
    const targetMin= ph * 60 + pm;

    const tempGap  = Math.abs(tempRoom - setpoint);
    const outdoorFactor = isCooling
      ? Math.max(1, (tempOutdoor - setpoint) / 5)
      : Math.max(1, (setpoint - tempOutdoor) / 5);
    const leadMins = Math.min(90, Math.ceil(tempGap * outdoorFactor * 2));
    preLead.set(instId, leadMins);

    const startMin = (targetMin - leadMins + 1440) % 1440;
    const inPreWindow = startMin <= targetMin
      ? (nowMin >= startMin && nowMin < targetMin)
      : (nowMin >= startMin || nowMin < targetMin);

    if (inPreWindow && !isOn) {
      const legacyKey = runtimeKey(instId, 'legacy');
      if (!lastOffTime.has(legacyKey) || (now - lastOffTime.get(legacyKey) >= minOff)) {
        send("ac_relay", "ON", `Pre-${mode}: starting ${leadMins}min early (outdoor: ${tempOutdoor}°C, gap: ${tempGap.toFixed(1)}°C)`, { action: 'Thermostat_Legacy_Output_ON' });
        lastOnTime.set(legacyKey, now);
        lastOffTime.delete(legacyKey);
        return;
      }
    }
  }

  const legacyKey = runtimeKey(instId, 'legacy');
  if (isOn && lastOnTime.has(legacyKey)) {
    if (now - lastOnTime.get(legacyKey) < minRun) return;
  }
  if (!isOn && lastOffTime.has(legacyKey)) {
    if (now - lastOffTime.get(legacyKey) < minOff) return;
  }

  let targetState = null;
  let reason      = null;

  if (isCooling) {
    if (!isOn && tempRoom >= setpoint + hyst) {
      targetState = "ON";
      reason = `Room ${tempRoom}°C >= ${setpoint + hyst}°C → cooling ON`;
    } else if (isOn && tempRoom <= setpoint - hyst) {
      targetState = "OFF";
      reason = `Room ${tempRoom}°C <= ${setpoint - hyst}°C → cooling OFF`;
    }
  } else {
    if (!isOn && tempRoom <= setpoint - hyst) {
      targetState = "ON";
      reason = `Room ${tempRoom}°C <= ${setpoint - hyst}°C → heating ON`;
    } else if (isOn && tempRoom >= setpoint + hyst) {
      targetState = "OFF";
      reason = `Room ${tempRoom}°C >= ${setpoint + hyst}°C → heating OFF`;
    }
  }

  if (targetState) {
    if (targetState === "ON") {
      lastOnTime.set(legacyKey, now);
      lastOffTime.delete(legacyKey);
    } else {
      lastOnTime.delete(legacyKey);
      lastOffTime.set(legacyKey, now);
    }
    send("ac_relay", targetState, reason, { action: `Thermostat_Legacy_Output_${targetState}` });
  }

  ctx.broadcastState({
    status: isOn ? 'on' : 'off',
    output_on: isOn,
    source: 'temp',
    manual_active: false,
    last_reason: reason || 'Within hysteresis band',
    mode,
    temp: tempRoom != null ? Number(tempRoom).toFixed(1) : null,
    setpoint,
  });
}

function thermostatHandler(ctx, send) {
  const hasZones = ctx.mappings.some(m => m && m.input_key && (String(m.input_key).startsWith('zone_') || String(m.input_key) === 'central_pump'));
  if (hasZones) return zonedThermostatHandler(ctx, send);
  return legacySingleZoneHandler(ctx, send);
}

const THERMOSTAT_MODULE = {
  id:          "advanced_thermostat",
  name:        "Advanced Thermostat",
  icon:        "🌡️",
  description: "Simple room thermostat with optional zones, zone outputs/pumps, and a shared central pump.",
  color:       "#00c8ff",
  category:    "climate",
  inputs: [
    { key: "temp_room",    label: "Room Temperature (Legacy Zone 1)",    type: "sensor", unit: "°C", required: false,
      description: "Legacy single-zone room temperature sensor. Keep this mapped for simple one-zone thermostat setups." },
    { key: "ac_relay",     label: "Heat / Cool Output (Legacy Zone 1)",   type: "relay", required: false,
      description: "Legacy single-zone output relay. Use this for classic one-output thermostat control." },
    { key: "temp_outdoor", label: "Outdoor Temperature", type: "sensor", unit: "°C", required: false,
      description: "Optional outdoor temperature sensor. Used only by legacy single-zone pre-heat / pre-cool logic." },
    { key: "central_pump", label: "Central Pump", type: "relay", required: false,
      description: "Optional shared circulation pump. Turns ON when any zone has active demand." },
    { key: "zone_1_temp", label: "Zone 1 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 1." },
    { key: "zone_1_call", label: "Zone 1 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 1 (ON = heat/cool demand)." },
    { key: "zone_1_output", label: "Zone 1 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 1." },
    { key: "zone_1_pump", label: "Zone 1 Pump", type: "relay", required: false, description: "Optional pump output for zone 1." },
    { key: "zone_2_temp", label: "Zone 2 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 2." },
    { key: "zone_2_call", label: "Zone 2 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 2." },
    { key: "zone_2_output", label: "Zone 2 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 2." },
    { key: "zone_2_pump", label: "Zone 2 Pump", type: "relay", required: false, description: "Optional pump output for zone 2." },
    { key: "zone_3_temp", label: "Zone 3 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 3." },
    { key: "zone_3_call", label: "Zone 3 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 3." },
    { key: "zone_3_output", label: "Zone 3 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 3." },
    { key: "zone_3_pump", label: "Zone 3 Pump", type: "relay", required: false, description: "Optional pump output for zone 3." },
    { key: "zone_4_temp", label: "Zone 4 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 4." },
    { key: "zone_4_call", label: "Zone 4 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 4." },
    { key: "zone_4_output", label: "Zone 4 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 4." },
    { key: "zone_4_pump", label: "Zone 4 Pump", type: "relay", required: false, description: "Optional pump output for zone 4." },
    { key: "zone_5_temp", label: "Zone 5 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 5." },
    { key: "zone_5_call", label: "Zone 5 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 5." },
    { key: "zone_5_output", label: "Zone 5 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 5." },
    { key: "zone_5_pump", label: "Zone 5 Pump", type: "relay", required: false, description: "Optional pump output for zone 5." },
    { key: "zone_6_temp", label: "Zone 6 Temperature", type: "sensor", unit: "°C", required: false, description: "Optional temperature sensor for zone 6." },
    { key: "zone_6_call", label: "Zone 6 Thermostat Call", type: "sensor", required: false, description: "Optional digital thermostat/contact for zone 6." },
    { key: "zone_6_output", label: "Zone 6 Output", type: "relay", required: false, description: "Optional valve/relay output for zone 6." },
    { key: "zone_6_pump", label: "Zone 6 Pump", type: "relay", required: false, description: "Optional pump output for zone 6." },
    { key: "humidity",       label: "Room Humidity",        type: "sensor", unit: "%", required: false,
      description: "Optional room humidity sensor. When mapped, enables dehumidifier control based on humidity setpoint." },
    { key: "humidity_relay", label: "Dehumidifier / Humidifier Relay", type: "relay", required: false,
      description: "Relay output for dehumidifier or humidifier. Activated when humidity exceeds the configured setpoint + hysteresis." },
  ],
  groups: [
    { id: "basic",    label: "⚙️ Basic",               open: true,  requires: null },
    { id: "zoning",   label: "🏠 Zones & Pumps",        open: true,  requires: null },
    { id: "window",   label: "🪟 Window Detection",     open: false, requires: null },
    { id: "pre",      label: "⏰ Pre-heat / Pre-cool",  open: false, requires: "temp_outdoor" },
    { id: "zone_1",   label: "🏠 Zone 1 Setpoints",     open: false, requires: null },
    { id: "zone_2",   label: "🏠 Zone 2 Setpoints",     open: false, requires: null },
    { id: "zone_3",   label: "🏠 Zone 3 Setpoints",     open: false, requires: null },
    { id: "zone_4",   label: "🏠 Zone 4 Setpoints",     open: false, requires: null },
    { id: "zone_5",   label: "🏠 Zone 5 Setpoints",     open: false, requires: null },
    { id: "zone_6",   label: "🏠 Zone 6 Setpoints",     open: false, requires: null },
    { id: "holiday",  label: "🏖️ Holiday Mode",         open: false, requires: null },
    { id: "humidity", label: "💧 Humidity Control",      open: false, requires: "humidity" },
  ],
  setpoints: [
    { group: "basic", key: "mode",             label: "Mode",              type: "select", options: ["cooling","heating","off"], default: "heating",
      help: "Common operating mode for the whole thermostat instance. All zones follow the same heating/cooling direction." },
    { group: "basic", key: "setpoint",         label: "Target Temp",       type: "number", unit: "°C",  step: 0.5, default: 21,
      help: "Common target temperature used by all temperature-based zones." },
    { group: "basic", key: "hysteresis",       label: "Hysteresis",        type: "number", unit: "°C",  step: 0.1, default: 0.5,
      help: "Common dead band around the target. Applies to every zone that uses a temperature sensor instead of a thermostat contact." },
    { group: "basic", key: "min_run_time",     label: "Min Run Time",      type: "number", unit: "sec", step: 30,  default: 120,
      help: "Minimum ON time per zone output / pump before it is allowed to switch OFF." },
    { group: "basic", key: "min_off_time",     label: "Min OFF Time",      type: "number", unit: "sec", step: 30,  default: 120,
      help: "Minimum OFF time before a zone output / pump may start again." },

    { group: "window", key: "window_detect",   label: "Open window detect",type: "select", options: ["1","0"], default: "1",
      help: "Legacy single-zone feature. Used only when no zone_* mappings are configured." },
    { group: "window", key: "window_drop",     label: "Temp change trigger", type: "number", unit: "°C",  step: 0.1, default: 0.5,
      help: "Legacy single-zone feature. Temperature change within 2 minutes that triggers window detection." },
    { group: "pre",    key: "pre_enable",      label: "Enable pre-heat/cool",type:"select", options: ["1","0"], default: "0",
      help: "Legacy single-zone feature. Starts heating/cooling early before the target ready time." },
    { group: "pre",    key: "pre_target_time", label: "Target ready time", type: "text", default: "07:00",
      help: "Legacy single-zone feature. Time (HH:MM) when the room should be ready." },

    // ── Zone 1 ────────────────────────────────────────────────────────
    { group: "zone_1", key: "zone_1_name", label: "Zone 1 Name", type: "text", default: "", help: "Custom display name for zone 1 (e.g. 'Living Room')." },
    { group: "zone_1", key: "zone_1_setpoint",   label: "Zone 1 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null,
      help: "Override the global setpoint for zone 1 only. Leave empty to use the global setpoint." },
    { group: "zone_1", key: "zone_1_hysteresis", label: "Zone 1 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null,
      help: "Override hysteresis for zone 1 only." },
    { group: "zone_1", key: "zone_1_schedule",   label: "Zone 1 Schedule (JSON)", type: "text", default: "",
      help: 'JSON array of time slots, e.g. [{"days":"weekday","start":"06:00","end":"22:00","setpoint":21},{"days":"all","start":"22:00","end":"06:00","setpoint":18}]' },

    // ── Zone 2 ────────────────────────────────────────────────────────
    { group: "zone_2", key: "zone_2_name", label: "Zone 2 Name", type: "text", default: "", help: "Custom display name for zone 2." },
    { group: "zone_2", key: "zone_2_setpoint",   label: "Zone 2 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 2 only." },
    { group: "zone_2", key: "zone_2_hysteresis", label: "Zone 2 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 2 only." },
    { group: "zone_2", key: "zone_2_schedule",   label: "Zone 2 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 2." },

    // ── Zone 3 ────────────────────────────────────────────────────────
    { group: "zone_3", key: "zone_3_name", label: "Zone 3 Name", type: "text", default: "", help: "Custom display name for zone 3." },
    { group: "zone_3", key: "zone_3_setpoint",   label: "Zone 3 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 3 only." },
    { group: "zone_3", key: "zone_3_hysteresis", label: "Zone 3 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 3 only." },
    { group: "zone_3", key: "zone_3_schedule",   label: "Zone 3 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 3." },

    // ── Zone 4 ────────────────────────────────────────────────────────
    { group: "zone_4", key: "zone_4_name", label: "Zone 4 Name", type: "text", default: "", help: "Custom display name for zone 4." },
    { group: "zone_4", key: "zone_4_setpoint",   label: "Zone 4 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 4 only." },
    { group: "zone_4", key: "zone_4_hysteresis", label: "Zone 4 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 4 only." },
    { group: "zone_4", key: "zone_4_schedule",   label: "Zone 4 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 4." },

    // ── Zone 5 ────────────────────────────────────────────────────────
    { group: "zone_5", key: "zone_5_name", label: "Zone 5 Name", type: "text", default: "", help: "Custom display name for zone 5." },
    { group: "zone_5", key: "zone_5_setpoint",   label: "Zone 5 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 5 only." },
    { group: "zone_5", key: "zone_5_hysteresis", label: "Zone 5 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 5 only." },
    { group: "zone_5", key: "zone_5_schedule",   label: "Zone 5 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 5." },

    // ── Zone 6 ────────────────────────────────────────────────────────
    { group: "zone_6", key: "zone_6_name", label: "Zone 6 Name", type: "text", default: "", help: "Custom display name for zone 6." },
    { group: "zone_6", key: "zone_6_setpoint",   label: "Zone 6 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 6 only." },
    { group: "zone_6", key: "zone_6_hysteresis", label: "Zone 6 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 6 only." },
    { group: "zone_6", key: "zone_6_schedule",   label: "Zone 6 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 6." },

    // ── Holiday Mode ──────────────────────────────────────────────────
    { group: "holiday", key: "holiday_mode",     label: "Holiday Mode",         type: "select", options: ["off","on"], default: "off",
      help: "When ON, overrides all zone setpoints with the frost/heat protection setpoint." },
    { group: "holiday", key: "holiday_setpoint", label: "Protection Setpoint",  type: "number", unit: "°C", step: 0.5, default: 7,
      help: "Setpoint used for all zones when Holiday Mode is active. Typically 7°C for heating (frost protection) or 32°C for cooling." },

    // ── Humidity ──────────────────────────────────────────────────────
    { group: "humidity", key: "humidity_setpoint",   label: "Humidity Setpoint",  type: "number", unit: "%", step: 1, default: 55,
      help: "Target relative humidity. Dehumidifier relay turns ON above setpoint + hysteresis." },
    { group: "humidity", key: "humidity_hysteresis", label: "Humidity Hysteresis", type: "number", unit: "%", step: 1, default: 3,
      help: "Dead band around the humidity setpoint." },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      help: 'When ON, thermostat logic runs normally but no real relay, valve, pump, or dehumidifier commands are sent.' },
  ],
};

module.exports = { thermostatHandler, THERMOSTAT_MODULE, setManual, clearManual, setZoneManual, clearZoneManual };

function setManual(instId, on) { manualState.set(instId, { on: !!on, ts: Date.now() }); }
function clearManual(instId)   { manualState.delete(instId); }
function setZoneManual(instId, zone, on) {
  if (!zoneManualState.has(instId)) zoneManualState.set(instId, new Map());
  zoneManualState.get(instId).set(zone, !!on);
}
function clearZoneManual(instId, zone) {
  if (zoneManualState.has(instId)) zoneManualState.get(instId).delete(zone);
}
