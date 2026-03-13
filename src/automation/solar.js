// src/automation/solar.js
// Solar differential thermostat — runs server-side on every MQTT update
// Logic: if (temp_solar - temp_boiler) >= dt_on  → pump ON
//        if (temp_solar - temp_boiler) <= dt_off → pump OFF

const DEFAULT_DT_ON  = 8;   // °C — turn pump ON
const DEFAULT_DT_OFF = 3;   // °C — turn pump OFF
const MAX_BOILER_TEMP   = 85; // °C — safety cutoff, never exceed
const MIN_SOLAR_TEMP  = 40; // °C — minimum collector temp to run pump

// Per-instance runtime state for Legionella + Anti-Freeze
const legionellaState  = new Map(); // instId → { lastAbove60: ts, lastCycleTs: ts }
const antiFreezeTimer  = new Map(); // instId → timeout handle

function createSolarAutomation({ db, mqttApi: _mqttApi, broadcast }) {
  let mqttApi = _mqttApi;

  // ── Init tables ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS module_settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       TEXT,
      updated_ts  INTEGER NOT NULL,
      UNIQUE(instance_id, key)
    );

    CREATE TABLE IF NOT EXISTS automation_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      action      TEXT NOT NULL,
      reason      TEXT,
      ts          INTEGER NOT NULL
    );
  `);

  // ── Prepared statements ─────────────────────────────────────────────
  const getInstanceSettings = db.prepare(`
    SELECT mi.id, mi.name,
           mm_solar.io_id  AS solar_io_id,
           mm_boiler.io_id AS boiler_io_id,
           mm_pump.io_id   AS pump_io_id
    FROM module_instances mi
    JOIN module_mappings mm_solar  ON mm_solar.instance_id  = mi.id AND mm_solar.input_key  = 'temp_solar'
    JOIN module_mappings mm_boiler ON mm_boiler.instance_id = mi.id AND mm_boiler.input_key = 'temp_boiler'
    JOIN module_mappings mm_pump   ON mm_pump.instance_id   = mi.id AND mm_pump.input_key   = 'pump'
    WHERE mi.module_id = 'solar' AND mi.active = 1
  `);

  const getIOById = db.prepare(`SELECT * FROM io WHERE id = ?`);

  const getLatestState = db.prepare(`
    SELECT value FROM device_state
    WHERE device_id = ? AND key = ?
    ORDER BY ts DESC LIMIT 1
  `);

  const getSetpoints = db.prepare(`
    SELECT value FROM module_settings
    WHERE instance_id = ? AND key = ?
  `);

  const upsertSetting = db.prepare(`
    INSERT INTO module_settings(instance_id, key, value, updated_ts)
    VALUES(@instance_id, @key, @value, @ts)
    ON CONFLICT(instance_id, key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
  `);

  const logAutomation = db.prepare(`
    INSERT INTO automation_log(instance_id, action, reason, ts)
    VALUES(@instance_id, @action, @reason, @ts)
  `);

  const getHeaterMapping = db.prepare(`
    SELECT io_id FROM module_mappings WHERE instance_id = ? AND input_key = 'heater' LIMIT 1
  `);


  // ── Helpers ──────────────────────────────────────────────────────────
  function getSetting(instance_id, key, defaultVal) {
    try {
      const row = getSetpoints.get(instance_id, key);
      return row ? parseFloat(row.value) : defaultVal;
    } catch { return defaultVal; }
  }

  function saveSetting(instance_id, key, value) {
    upsertSetting.run({ instance_id, key, value: String(value), ts: Date.now() });
  }

  function getLatestValue(deviceId, key) {
    const row = getLatestState.get(deviceId, key);
    if (!row) return null;
    const v = parseFloat(row.value);
    return isNaN(v) ? null : v;
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // ── Core evaluation ──────────────────────────────────────────────────
  function evaluate(instance) {
    // Skip if automation is paused for this instance
    if (overrides.get(instance.id)?.paused === true) return null;
    const solarIO  = getIOById.get(instance.solar_io_id);
    const boilerIO = getIOById.get(instance.boiler_io_id);
    const pumpIO   = getIOById.get(instance.pump_io_id);

    if (!solarIO || !boilerIO || !pumpIO) return null;

    const tempSolar  = getLatestValue(solarIO.device_id,  solarIO.key);
    const tempBoiler = getLatestValue(boilerIO.device_id, boilerIO.key);

    if (tempSolar === null || tempBoiler === null) return null;

    let dtOn  = clamp(getSetting(instance.id, "dt_on",  DEFAULT_DT_ON), 1, 40);
    let dtOff = clamp(getSetting(instance.id, "dt_off", DEFAULT_DT_OFF), 0, 30);
    const maxTemp = clamp(getSetting(instance.id, "max_boiler_temp", MAX_BOILER_TEMP), 40, 95);

    if (dtOff >= dtOn) {
      dtOff = Math.max(0, dtOn - 1);
    }

    const diff = tempSolar - tempBoiler;

    // Current pump state
    const pumpState = getLatestState.get(pumpIO.device_id, pumpIO.key);
    const isOn = pumpState?.value === "ON";

    let targetState = null;
    let reason      = null;

    const minSolar = clamp(getSetting(instance.id, "min_solar_temp", MIN_SOLAR_TEMP), -20, 120);

    // Safety cutoff — boiler overheating
    if (tempBoiler >= maxTemp) {
      targetState = "OFF";
      reason = `Safety cutoff: boiler ${tempBoiler}°C >= max ${maxTemp}°C`;
    }
    // Collector too cold — no point running pump
    else if (isOn && tempSolar < minSolar) {
      targetState = "OFF";
      reason = `Collector too cold: ${tempSolar}°C < min ${minSolar}°C`;
    }
    // Turn ON: differential large enough AND collector warm enough
    else if (!isOn && diff >= dtOn && tempSolar >= minSolar) {
      targetState = "ON";
      reason = `ΔT=${diff.toFixed(1)}°C >= ${dtOn}°C (ON threshold)`;
    }
    // Turn OFF: differential too small
    else if (isOn && diff <= dtOff) {
      targetState = "OFF";
      reason = `ΔT=${diff.toFixed(1)}°C <= ${dtOff}°C (OFF threshold)`;
    }

    if (targetState && targetState !== (isOn ? "ON" : "OFF")) {
      // Send MQTT command
      mqttApi.publish(pumpIO.device_id, pumpIO.key, targetState);

      // Log it
      logAutomation.run({
        instance_id: instance.id,
        action: `pump_${targetState}`,
        reason,
        ts: Date.now(),
      });

      console.log(`[SOLAR AUTO] ${instance.name}: ${reason} → pump ${targetState}`);

      // Broadcast to dashboard
      broadcast({
        type:       "automation",
        module:     "solar",
        instance:   instance.id,
        action:     `pump_${targetState}`,
        reason,
        deviceId:   pumpIO.device_id,
        key:        pumpIO.key,
        ts:         Date.now(),
      });
      broadcastStatus(instance.id);

      return { action: `pump_${targetState}`, reason, tempSolar, tempBoiler, diff };
    }

    // ── Anti-Freeze Protection ─────────────────────────────────────────
    const antiFreezeEnable = getSetting(instance.id, "anti_freeze_enable", 0);
    const antiFreezeTemp   = getSetting(instance.id, "anti_freeze_temp",   4);  // °C
    const antiFreezeRunS   = getSetting(instance.id, "anti_freeze_run_s",  30); // sec
    if (antiFreezeEnable && tempSolar !== null && tempSolar < antiFreezeTemp) {
      if (!antiFreezeTimer.has(instance.id)) {
        mqttApi.publish(pumpIO.device_id, pumpIO.key, "ON");
        logAutomation.run({ instance_id: instance.id, action: "pump_ON", reason: `Anti-freeze: solar ${tempSolar}°C < ${antiFreezeTemp}°C — running pump briefly`, ts: Date.now() });
        console.log(`[SOLAR AUTO] Anti-freeze triggered at ${tempSolar}°C`);
        const t = setTimeout(() => {
          antiFreezeTimer.delete(instance.id);
        }, antiFreezeRunS * 1000);
        antiFreezeTimer.set(instance.id, t);
      }
      return null;
    }

    // ── Legionella Protection Cycle ────────────────────────────────────
    const legEnable  = getSetting(instance.id, "legionella_enable", 0);
    const legTemp    = getSetting(instance.id, "legionella_temp",   60); // °C
    const legDays    = getSetting(instance.id, "legionella_days",    7); // days between cycles
    const legMaxDays = getSetting(instance.id, "legionella_max_days",3); // force if not above temp for X days

    if (legEnable) {
      if (!legionellaState.has(instance.id)) {
        legionellaState.set(instance.id, { lastAbove60: null, lastCycleTs: null });
      }
      const ls = legionellaState.get(instance.id);
      const nowTs = Date.now();

      // Track when boiler was last above legionella temp
      if (tempBoiler >= legTemp) {
        ls.lastAbove60 = nowTs;
      }

      const daysSinceAbove = ls.lastAbove60 ? (nowTs - ls.lastAbove60) / 86400000 : 999;
      const daysSinceCycle = ls.lastCycleTs ? (nowTs - ls.lastCycleTs) / 86400000 : 999;

      const needsCycle = daysSinceCycle >= legDays || daysSinceAbove >= legMaxDays;

      if (needsCycle) {
        const mapping = getHeaterMapping.get(instance.id);
        const hIO = mapping ? getIOById.get(mapping.io_id) : null;
        if (hIO && tempBoiler < legTemp) {
          mqttApi.publish(hIO.device_id, hIO.key, "ON");
          logAutomation.run({ instance_id: instance.id, action: "heater_ON", reason: `Legionella cycle: boiler ${tempBoiler}°C < ${legTemp}°C, ${daysSinceAbove.toFixed(1)}d since last high temp`, ts: Date.now() });
          console.log(`[SOLAR AUTO] Legionella cycle: heater ON`);
        } else if (hIO && tempBoiler >= legTemp) {
          mqttApi.publish(hIO.device_id, hIO.key, "OFF");
          ls.lastCycleTs = nowTs;
          ls.lastAbove60 = nowTs;
          logAutomation.run({ instance_id: instance.id, action: "heater_OFF", reason: `Legionella cycle complete: boiler reached ${tempBoiler}°C`, ts: Date.now() });
        }
      }
    }

    broadcastStatus(instance.id);
    return null; // no change needed
  }

  function broadcastStatus(instance_id) {
    try {
      const live = getLiveStatus(instance_id);
      if (!live?.found) return;
      broadcast({
        type: "automation_status",
        module: "solar",
        instance: instance_id,
        status: live,
        ts: Date.now(),
      });
    } catch (e) {}
  }

  // ── Public API ───────────────────────────────────────────────────────

  // Called on every MQTT state/tele update
  function onSensorUpdate(deviceId, key) {
    try {
      const instances = getInstanceSettings.all();
      for (const inst of instances) {
        const solarIO  = getIOById.get(inst.solar_io_id);
        const boilerIO = getIOById.get(inst.boiler_io_id);
        // Only evaluate if the updated sensor belongs to this instance
        const relevant = (solarIO?.device_id === deviceId && solarIO?.key === key)
                      || (boilerIO?.device_id === deviceId && boilerIO?.key === key);
        if (relevant) evaluate(inst);
      }
    } catch (e) {
      console.error("[SOLAR AUTO] Error:", e.message);
    }
  }

  // Force re-evaluate all solar instances (on startup, setpoint change)
  function evaluateAll() {
    try {
      const instances = getInstanceSettings.all();
      instances.forEach(evaluate);
    } catch (e) {
      console.error("[SOLAR AUTO] evaluateAll error:", e.message);
    }
  }

  // Update setpoint + re-evaluate
  function setSetpoint(instance_id, key, value) {
    if (!["dt_on", "dt_off", "max_boiler_temp", "min_solar_temp"].includes(key)) throw new Error("invalid_key");
    const v = parseFloat(value);
    if (isNaN(v)) throw new Error("invalid_value");
    saveSetting(instance_id, key, v);
    // Re-evaluate immediately
    const instances = getInstanceSettings.all().filter(i => i.id === instance_id);
    instances.forEach(evaluate);
    return v;
  }

  function getSetpointsForInstance(instance_id) {
    return {
      dt_on:           getSetting(instance_id, "dt_on",           DEFAULT_DT_ON),
      dt_off:          getSetting(instance_id, "dt_off",          DEFAULT_DT_OFF),
      max_boiler_temp: getSetting(instance_id, "max_boiler_temp", MAX_BOILER_TEMP),
      min_solar_temp:  getSetting(instance_id, "min_solar_temp",  MIN_SOLAR_TEMP),
    };
  }

  function getLog(instance_id, limit = 50) {
    return db.prepare(`
      SELECT * FROM automation_log
      WHERE instance_id = ?
      ORDER BY ts DESC LIMIT ?
    `).all(instance_id, limit);
  }

  function setMqttApi(api) { mqttApi = api; }

  // ── Override (pause automation) ──────────────────────────────────────
  const overrides = new Map(); // instance_id → { paused, ts }

  function setOverride(instance_id, paused) {
    overrides.set(instance_id, { paused, ts: Date.now() });
    if (!paused) {
      // Resume — re-evaluate immediately
      const instances = getInstanceSettings.all().filter(i => i.id === instance_id);
      instances.forEach(evaluate);
    }
    console.log(`[SOLAR AUTO] instance ${instance_id}: automation ${paused ? "PAUSED" : "RESUMED"}`);
  }

  function isPaused(instance_id) {
    return overrides.get(instance_id)?.paused === true;
  }

  // ── History for sparkline ────────────────────────────────────────────
  function getHistory(instance_id, since) {
    const inst    = getInstanceSettings.get ? null : null;
    // Get all solar instances to find this one
    const all     = getInstanceSettings.all();
    const inst2   = all.find(i => i.id === instance_id);
    if (!inst2) return { solar: [], boiler: [] };

    const solarIO  = getIOById.get(inst2.solar_io_id);
    const boilerIO = getIOById.get(inst2.boiler_io_id);
    if (!solarIO || !boilerIO) return { solar: [], boiler: [] };

    const getEvents = db.prepare(`
      SELECT payload as value, ts FROM events
      WHERE device_id = ? AND topic LIKE ?
        AND ts >= ?
      ORDER BY ts ASC
      LIMIT 500
    `);

    const solarRows  = getEvents.all(solarIO.device_id,  `%/${solarIO.key}`,  since);
    const boilerRows = getEvents.all(boilerIO.device_id, `%/${boilerIO.key}`, since);

    return {
      solar:  solarRows.map(r  => ({ ts: r.ts,  v: parseFloat(r.value) })).filter(r => !isNaN(r.v)),
      boiler: boilerRows.map(r => ({ ts: r.ts,  v: parseFloat(r.value) })).filter(r => !isNaN(r.v)),
    };
  }

  // ── Live status for dashboard widget ─────────────────────────────────
  function getLiveStatus(instance_id) {
    const all  = getInstanceSettings.all();
    const inst = all.find(i => i.id === instance_id);
    if (!inst) return { found: false };

    const solarIO  = getIOById.get(inst.solar_io_id);
    const boilerIO = getIOById.get(inst.boiler_io_id);
    const pumpIO   = getIOById.get(inst.pump_io_id);

    const tempSolar  = solarIO  ? getLatestValue(solarIO.device_id,  solarIO.key)  : null;
    const tempBoiler = boilerIO ? getLatestValue(boilerIO.device_id, boilerIO.key) : null;
    const pumpState  = pumpIO   ? getLatestState.get(pumpIO.device_id, pumpIO.key) : null;

    const diff = (tempSolar !== null && tempBoiler !== null) ? tempSolar - tempBoiler : null;
    const sp   = getSetpointsForInstance(instance_id);
    const paused = isPaused(instance_id);

    const overheat = tempBoiler !== null && tempBoiler >= sp.max_boiler_temp;
    const collectorCold = tempSolar !== null && tempSolar < sp.min_solar_temp;
    let reason = null;
    if (paused) reason = 'paused';
    else if (overheat) reason = 'overheat';
    else if (collectorCold && (pumpState?.value === "ON")) reason = 'collector_too_cold';

    return {
      found:       true,
      paused,
      status:      paused ? 'paused' : ((pumpState?.value === "ON") ? 'running' : 'idle'),
      tempSolar,
      tempBoiler,
      diff:        diff !== null ? Math.round(diff * 10) / 10 : null,
      pumpOn:      pumpState?.value === "ON",
      overheat,
      collectorCold,
      lockout_reason: reason,
      setpoints:   sp,
      lastLog:     getLog(instance_id, 3),
    };
  }

  return { onSensorUpdate, evaluateAll, setSetpoint, getSetpointsForInstance, getLog, setMqttApi, setOverride, isPaused, getHistory, getLiveStatus };
}

// ── Engine-compatible handler (used by generic engine) ───────────────────
const { solarEngineHandler } = require("./solar_v2");

module.exports = { createSolarAutomation, DEFAULT_DT_ON, DEFAULT_DT_OFF, solarEngineHandler };

