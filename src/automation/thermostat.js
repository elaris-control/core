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

function sendIfMapped(send, key, value, reason) {
  if (!key) return;
  send(key, value, reason);
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
      ctx.setSetting(`_zone_${zone}_state`, '0');
      setZoneStatus(ctx, zone, {
        source: keys.call ? 'call' : (keys.temp ? 'temp' : 'none'),
        demand: '0',
        output_state: '0',
        pump_state: '0',
        reason: 'Thermostat mode OFF',
      });
      if (keys.output) sendIfMapped(send, keys.output, 'OFF', `Zone ${zone} thermostat OFF`);
      if (keys.pump) sendIfMapped(send, keys.pump, 'OFF', `Zone ${zone} pump OFF`);
    }
    if (hasMapping(ctx, 'central_pump')) send('central_pump', 'OFF', 'Central pump OFF (thermostat mode OFF)');
    setCentralStatus(ctx, {
      state: '0',
      reason: 'Thermostat mode OFF',
      configured_zones: String(configuredZones),
      calling_zones: '0',
    });
    return;
  }

  let anyDemand = false;
  let configuredZones = 0;
  let callingZones = 0;

  for (let zone = 1; zone <= MAX_ZONES; zone++) {
    if (!zoneConfigured(ctx, zone)) continue;
    configuredZones++;
    const keys = zoneKeys(ctx, zone);
    const zoneResolved = resolveZoneSetpoint(ctx, zone, holidayMode ? holidaySetpoint : setpoint, hyst);
    const evald = evaluateZoneDemand({ ctx, zone, keys, mode, setpoint: zoneResolved.setpoint, hyst: zoneResolved.hyst });

    const outputCurrent = keys.output ? ctx.isOn(keys.output) : false;
    const pumpCurrent = keys.pump ? ctx.isOn(keys.pump) : false;
    let outputFinal = false;
    let pumpFinal = false;
    let reason = evald.reason;

    if (evald.tempVal !== null) setZoneStatus(ctx, zone, { last_temp: Number(evald.tempVal).toFixed(1) });
    if (evald.callDemand !== null) setZoneStatus(ctx, zone, { last_call: evald.callDemand ? '1' : '0' });

    if (!evald.configured) {
      ctx.setSetting(`_zone_${zone}_state`, '0');
      setZoneStatus(ctx, zone, {
        source: evald.source,
        demand: '0',
        output_state: '0',
        pump_state: '0',
        reason: reason,
      });
      if (keys.output) sendIfMapped(send, keys.output, 'OFF', `Zone ${zone} idle (no valid demand source)`);
      if (keys.pump) sendIfMapped(send, keys.pump, 'OFF', `Zone ${zone} pump OFF (no valid demand source)`);
      continue;
    }

    if (evald.desiredActive) {
      anyDemand = true;
      callingZones++;
    }

    if (keys.output) {
      const outKey = runtimeKey(instId, `zone_${zone}_output`);
      outputFinal = applyMinRunOff(outputCurrent, evald.desiredActive, outKey, minRunMs, minOffMs);
      if (outputFinal !== outputCurrent) rememberTransition(outKey, outputFinal);
      sendIfMapped(send, keys.output, outputFinal ? 'ON' : 'OFF', `Zone ${zone} ${stateReasonPrefix(mode)} output ${outputFinal ? 'ON' : 'OFF'} (${reason})`);
      if (outputFinal !== evald.desiredActive) reason += outputFinal ? ' · held by min run' : ' · held by min off';
    }

    if (keys.pump) {
      const pumpKey = runtimeKey(instId, `zone_${zone}_pump`);
      pumpFinal = applyMinRunOff(pumpCurrent, evald.desiredActive, pumpKey, minRunMs, minOffMs);
      if (pumpFinal !== pumpCurrent) rememberTransition(pumpKey, pumpFinal);
      sendIfMapped(send, keys.pump, pumpFinal ? 'ON' : 'OFF', `Zone ${zone} pump ${pumpFinal ? 'ON' : 'OFF'} (${reason})`);
      if (!keys.output && pumpFinal !== evald.desiredActive) reason += pumpFinal ? ' · pump held by min run' : ' · pump held by min off';
    }

    const storedState = outputFinal || pumpFinal || evald.desiredActive;
    ctx.setSetting(`_zone_${zone}_state`, storedState ? '1' : '0');
    setZoneStatus(ctx, zone, {
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
    send('central_pump', finalCentral ? 'ON' : 'OFF', `Central pump ${finalCentral ? 'ON' : 'OFF'} (${centralReason})`);
    setCentralStatus(ctx, {
      state: finalCentral ? '1' : '0',
      reason: centralReason,
      configured_zones: String(configuredZones),
      calling_zones: String(callingZones),
      post_run_until: String(centralPumpPostRun.get(instId) || 0),
    });
  } else {
    setCentralStatus(ctx, {
      state: '0',
      reason: anyDemand ? 'Demand present but no central pump mapped' : 'No central pump mapped',
      configured_zones: String(configuredZones),
      calling_zones: String(callingZones),
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
          `Humidity ${humVal.toFixed(1)}% ${humDesired ? '>=' : '<='} ${humDesired ? humSp + humHyst : humSp - humHyst}%`);
      }
      ctx.setSetting('_humidity', String(humVal.toFixed(1)));
      ctx.setSetting('_humidity_relay', humDesired ? '1' : '0');
    }
  }
}

function legacySingleZoneHandler(ctx, send) {
  const mode      = ctx.settingStr("mode", "cooling");
  const isCooling = mode === "cooling";
  const defaults  = DEFAULTS[mode] || DEFAULTS.cooling;
  if (mode === 'off') {
    send('ac_relay', 'OFF', 'Thermostat OFF');
    return;
  }
  const setpoint  = ctx.setting("setpoint",    defaults.setpoint);
  const hyst      = ctx.setting("hysteresis",  defaults.hysteresis);
  const minRun    = ctx.setting("min_run_time", defaults.min_run_time) * 1000;
  const minOff    = ctx.setting("min_off_time", defaults.min_off_time) * 1000;

  const tempRoom    = ctx.value("temp_room");
  if (tempRoom === null) return;

  const isOn   = ctx.isOn("ac_relay");
  const now    = Date.now();
  const instId = ctx.instance.id;

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
      send("ac_relay", "OFF", `Open window: temp ${isCooling?"rose":"dropped"} ${Math.abs(change).toFixed(2)}°C in 2min — turning off`);
      lastOnTime.delete(runtimeKey(instId, 'legacy'));
      lastOffTime.set(runtimeKey(instId, 'legacy'), now);
      return;
    }
  }

  if (windowLockout.has(instId) && now > windowLockout.get(instId)) {
    windowLockout.delete(instId);
  }

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
      send("ac_relay", "ON", `Pre-${mode}: starting ${leadMins}min early (outdoor: ${tempOutdoor}°C, gap: ${tempGap.toFixed(1)}°C)`);
      lastOnTime.set(runtimeKey(instId, 'legacy'), now);
      return;
    }
  }

  if (windowLockout.has(instId)) return;

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
    send("ac_relay", targetState, reason);
  }
}

function thermostatHandler(ctx, send) {
  const isTestMode = ctx.settingStr('test_mode', '0') === '1';
  if (isTestMode) {
    const _realSend = send;
    send = (key, value, reason) => {
      console.log(`[THERMOSTAT TEST MODE] would send: ${key} = ${value}${reason ? ' // ' + reason : ''}`);
    };
  }
  const hasZones = ctx.mappings.some(m => m && m.input_key && (String(m.input_key).startsWith('zone_') || String(m.input_key) === 'central_pump'));
  if (hasZones) return zonedThermostatHandler(ctx, send);
  return legacySingleZoneHandler(ctx, send);
}

const THERMOSTAT_MODULE = {
  id:          "thermostat",
  name:        "Thermostat",
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
    { id: "per_zone", label: "🏠 Per-Zone Setpoints",   open: false, requires: null },
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

    // ── Per-Zone Setpoints ────────────────────────────────────────────
    { group: "per_zone", key: "zone_1_setpoint",   label: "Zone 1 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null,
      help: "Override the global setpoint for zone 1 only. Leave empty to use the global setpoint." },
    { group: "per_zone", key: "zone_1_hysteresis", label: "Zone 1 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null,
      help: "Override hysteresis for zone 1 only." },
    { group: "per_zone", key: "zone_1_schedule",   label: "Zone 1 Schedule (JSON)", type: "text", default: "",
      help: 'JSON array of time slots, e.g. [{"days":"weekday","start":"06:00","end":"22:00","setpoint":21},{"days":"all","start":"22:00","end":"06:00","setpoint":18}]' },
    { group: "per_zone", key: "zone_2_setpoint",   label: "Zone 2 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 2 only." },
    { group: "per_zone", key: "zone_2_hysteresis", label: "Zone 2 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 2 only." },
    { group: "per_zone", key: "zone_2_schedule",   label: "Zone 2 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 2." },
    { group: "per_zone", key: "zone_3_setpoint",   label: "Zone 3 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 3 only." },
    { group: "per_zone", key: "zone_3_hysteresis", label: "Zone 3 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 3 only." },
    { group: "per_zone", key: "zone_3_schedule",   label: "Zone 3 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 3." },
    { group: "per_zone", key: "zone_4_setpoint",   label: "Zone 4 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 4 only." },
    { group: "per_zone", key: "zone_4_hysteresis", label: "Zone 4 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 4 only." },
    { group: "per_zone", key: "zone_4_schedule",   label: "Zone 4 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 4." },
    { group: "per_zone", key: "zone_5_setpoint",   label: "Zone 5 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 5 only." },
    { group: "per_zone", key: "zone_5_hysteresis", label: "Zone 5 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 5 only." },
    { group: "per_zone", key: "zone_5_schedule",   label: "Zone 5 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 5." },
    { group: "per_zone", key: "zone_6_setpoint",   label: "Zone 6 Setpoint",   type: "number", unit: "°C", step: 0.5, default: null, help: "Override the global setpoint for zone 6 only." },
    { group: "per_zone", key: "zone_6_hysteresis", label: "Zone 6 Hysteresis", type: "number", unit: "°C", step: 0.1, default: null, help: "Override hysteresis for zone 6 only." },
    { group: "per_zone", key: "zone_6_schedule",   label: "Zone 6 Schedule (JSON)", type: "text", default: "", help: "JSON schedule for zone 6." },

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

module.exports = { thermostatHandler, THERMOSTAT_MODULE };
