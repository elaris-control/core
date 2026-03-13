// src/automation/water_manager.js
// 💧 Water Manager — Leak detection & automatic valve shutoff
//
// Inputs:
//   leak_sensor_1..4  — leak/flood sensors (DI, ON = wet)
//   main_valve        — main water valve relay (DO, ON = open/flowing)
//   flow_sensor       — optional flow meter (AI, L/min)
//   pressure_sensor   — optional pressure sensor (AI, bar)
//
// Logic:
//   1. Any leak sensor → close main valve + alert (with user-defined location label)
//   2. Night ghost flow: sustained flow > threshold during quiet hours → alarm
//   3. Pressure drop: fast pressure loss → pipe burst alarm
//   4. Manual or auto re-arm after shutoff
//   5. Water meter: m³ tracking (total + daily) with gradual leak detection

'use strict';

const leakState   = new Map(); // instId → runtime state
const flowHistory = new Map(); // instId → [{ v, ts }]
const pressHist   = new Map(); // instId → [{ v, ts }]
const testModeLog = new Map(); // instId -> [{ts, io, value, reason}]
const FLOW_WINDOW  = 5 * 60 * 1000;  // 5 min
const PRESS_WINDOW = 2 * 60 * 1000;  // 2 min

function boolish(v) {
  return v === 'ON' || v === '1' || v === 'true' || v === 1 || v === true;
}

function parseClock(s, fallback) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return hh * 60 + mm;
}

function inRange(nowMin, startMin, endMin) {
  return startMin > endMin
    ? (nowMin >= startMin || nowMin < endMin)
    : (nowMin >= startMin && nowMin < endMin);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadRuntime(ctx) {
  try {
    const raw = ctx.settingStr('_runtime_json', '');
    if (!raw) return null;
    const x = JSON.parse(raw);
    return (x && typeof x === 'object') ? x : null;
  } catch (e) {
    return null;
  }
}

function saveRuntime(ctx, st) {
  try {
    ctx.setSetting('_runtime_json', JSON.stringify({
      ts:           Date.now(),
      shutoff:      !!st.shutoff,
      reason:       st.reason || null,
      lastAlertTs:  Number(st.lastAlertTs  || 0),
      lastTripTs:   Number(st.lastTripTs   || 0),
      autoRearmTs:  Number(st.autoRearmTs  || 0),
      totalLitres:  Number(st.totalLitres  || 0),
      dailyLitres:  Number(st.dailyLitres  || 0),
      dailyKey:     st.dailyKey  || '',
      lastFlowTs:   Number(st.lastFlowTs   || 0),
      weeklyUsage:  st.weeklyUsage || [],
    }));
  } catch (e) {}
}

function getState(ctx, instId) {
  if (!leakState.has(instId)) {
    leakState.set(instId, {
      shutoff:       false,
      reason:        null,
      lastAlertTs:   0,
      lastTripTs:    0,
      autoRearmTs:   0,
      totalLitres:   0,
      dailyLitres:   0,
      dailyKey:      '',
      lastFlowTs:    0,
      weeklyUsage:   [],
      _runtimeLoaded: false,
    });
  }
  const st = leakState.get(instId);
  if (!st._runtimeLoaded) {
    const rt = loadRuntime(ctx);
    if (rt) {
      st.shutoff      = !!rt.shutoff;
      st.reason       = rt.reason       || null;
      st.lastAlertTs  = Number(rt.lastAlertTs  || 0);
      st.lastTripTs   = Number(rt.lastTripTs   || 0);
      st.autoRearmTs  = Number(rt.autoRearmTs  || 0);
      st.totalLitres  = Number(rt.totalLitres  || 0);
      st.dailyLitres  = Number(rt.dailyLitres  || 0);
      st.dailyKey     = rt.dailyKey     || '';
      st.lastFlowTs   = Number(rt.lastFlowTs   || 0);
      st.weeklyUsage  = Array.isArray(rt.weeklyUsage) ? rt.weeklyUsage : [];
    }
    st._runtimeLoaded = true;
  }
  return st;
}

function waterManagerHandler(ctx, send) {
  const instId = ctx.instance.id;
  const now    = Date.now();

  const isTestMode = ctx.settingStr('test_mode', '0') === '1';
  if (isTestMode) {
    const tmLog = testModeLog.get(instId) || [];
    const _realSend = send;
    send = (io, value, reason) => {
      tmLog.push({ ts: now, io, value, reason: reason || '' });
      if (tmLog.length > 200) tmLog.shift();
      console.log(`[TEST MODE] ${io} = ${value}${reason ? ' // ' + reason : ''}`);
    };
    testModeLog.set(instId, tmLog);
  }

  const flowLeakThresh  = Number(ctx.setting('flow_leak_threshold', 2));
  const pressDropThresh = Number(ctx.setting('pressure_drop_thresh', 0.5));
  const nightFlowEnable = Number(ctx.setting('night_flow_enable', 1)) >= 1;
  const nightStart      = ctx.settingStr('night_start', '23:00');
  const nightEnd        = ctx.settingStr('night_end', '06:00');
  const alertCooldownMs = Math.max(0, Number(ctx.setting('alert_cooldown_s', 300))) * 1000;
  const autoRearmEnable = Number(ctx.setting('auto_rearm_enable', 0)) >= 1;
  const autoRearmMin    = Math.max(1, Number(ctx.setting('auto_rearm_min', 60)));
  const meterEnable     = Number(ctx.setting('meter_enable', 0)) >= 1;
  const gradualEnable   = Number(ctx.setting('gradual_enable', 0)) >= 1;
  const gradualAlertPct = Math.max(10, Number(ctx.setting('gradual_alert_pct', 50)));

  const st = getState(ctx, instId);

  const notifyOnce = (title, body, level, tag) => {
    if (now - Number(st.lastAlertTs || 0) < alertCooldownMs) return false;
    ctx._engine?.notify?.({ title, body, level, tag, cooldown_s: Math.floor(alertCooldownMs / 1000) });
    st.lastAlertTs = now;
    return true;
  };

  const trip = (reason, detail) => {
    st.shutoff    = true;
    st.reason     = reason;
    st.lastTripTs = now;
    if (autoRearmEnable) st.autoRearmTs = now + autoRearmMin * 60000;
    send('main_valve', 'OFF', `Water alarm: ${reason}${detail ? ' — ' + detail : ''}`);
    notifyOnce('💧 Water Alarm', `Valve closed: ${detail || reason}`, 'critical', `water_${instId}_${reason}`);
    saveRuntime(ctx, st);
  };

  // ── Manual re-arm ─────────────────────────────────────────────────────
  const rearmReq = ctx.settingStr('_rearm_request', '') === '1' || ctx.settingStr('_reset_alarm', '') === '1';
  if (rearmReq) {
    st.shutoff     = false;
    st.reason      = null;
    st.autoRearmTs = 0;
    ctx.setSetting?.('_rearm_request', '0');
    ctx.setSetting?.('_reset_alarm',   '0');
    send('main_valve', 'ON', 'Rearm: valve reopened by operator');
    saveRuntime(ctx, st);
  }

  // ── Meter reset ───────────────────────────────────────────────────────
  const meterResetReq = ctx.settingStr('_meter_reset', '') === '1';
  if (meterResetReq) {
    const offsetM3    = Number(ctx.setting('meter_offset_m3', 0) || 0);
    st.totalLitres    = offsetM3 * 1000;
    st.dailyLitres    = 0;
    st.weeklyUsage    = [];
    ctx.setSetting?.('_meter_reset', '0');
    saveRuntime(ctx, st);
  }

  // ── Latched alarm (keep valve closed or auto re-arm) ──────────────────
  if (st.shutoff) {
    if (autoRearmEnable && st.autoRearmTs > 0 && now >= st.autoRearmTs) {
      // Auto re-arm time reached
      st.shutoff     = false;
      st.reason      = null;
      st.autoRearmTs = 0;
      send('main_valve', 'ON', `Auto re-arm: valve reopened after ${autoRearmMin} min`);
      ctx._engine?.notify?.({
        title:      '💧 Water Manager: Auto Re-armed',
        body:       `Valve automatically reopened after ${autoRearmMin} min. Monitor for recurring alarms.`,
        level:      'info',
        tag:        `water_${instId}_rearm`,
        cooldown_s: 60,
      });
      saveRuntime(ctx, st);
      // Fall through to normal monitoring
    } else {
      send('main_valve', 'OFF', `Latched water alarm: ${st.reason || 'alarm'}`);
      saveRuntime(ctx, st);
      ctx.broadcastState?.({
        status:         'alarm',
        alarm:          true,
        lockout_reason: st.reason || 'alarm',
        shutoff_closed: true,
        last_alert_ts:  st.lastAlertTs || 0,
        last_trip_ts:   st.lastTripTs  || 0,
        auto_rearm_at:  st.autoRearmTs || 0,
        total_m3:       Math.round(st.totalLitres) / 1000,
        daily_m3:       Math.round(st.dailyLitres) / 1000,
        test_mode: isTestMode,
        test_log_count: isTestMode ? (testModeLog.get(instId) || []).length : 0,
        test_log_recent: isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
      });
      return;
    }
  }

  // ── Check leak sensors (DI) ───────────────────────────────────────────
  const leakInputs = ['leak_sensor_1', 'leak_sensor_2', 'leak_sensor_3', 'leak_sensor_4'];
  let leakDetected = false;
  let leakSource   = null;
  let leakLabel    = null;

  for (const key of leakInputs) {
    if (!ctx.io(key)) continue;
    if (boolish(ctx.state(key))) {
      leakDetected = true;
      leakSource   = key;
      // Use user-defined location label if set, e.g. "Under Boiler"
      const userLabel = ctx.settingStr(`${key}_label`, '').trim();
      leakLabel = userLabel || key.replace(/_/g, ' ');
      break;
    }
  }

  // ── Flow sensor ───────────────────────────────────────────────────────
  const flow = ctx.value('flow_sensor');

  if (flow !== null) {
    // Rolling history for analysis
    if (!flowHistory.has(instId)) flowHistory.set(instId, []);
    const fh = flowHistory.get(instId);
    fh.push({ v: flow, ts: now });
    while (fh.length && fh[0].ts < now - FLOW_WINDOW) fh.shift();

    // Ghost flow detection
    if (!leakDetected && nightFlowEnable && flow > flowLeakThresh) {
      const startMin = parseClock(nightStart, 23 * 60);
      const endMin   = parseClock(nightEnd,    6 * 60);
      const d        = new Date();
      const nowMin   = d.getHours() * 60 + d.getMinutes();
      if (inRange(nowMin, startMin, endMin)) {
        leakDetected = true;
        leakSource   = 'night_flow';
        leakLabel    = `Night ghost flow (${flow.toFixed(1)} L/min)`;
      }
    }

    // ── Water meter integration ─────────────────────────────────────
    if (meterEnable) {
      const today = todayKey();

      // Day rollover: archive yesterday to weekly history
      if (st.dailyKey && st.dailyKey !== today) {
        st.weeklyUsage.push({ key: st.dailyKey, litres: Math.round(st.dailyLitres) });
        if (st.weeklyUsage.length > 7) st.weeklyUsage.shift();
        st.dailyLitres = 0;
      }
      if (st.dailyKey !== today) st.dailyKey = today;

      // Accumulate volume: flow (L/min) × elapsed (min)
      if (st.lastFlowTs > 0) {
        const elapsedMin = (now - st.lastFlowTs) / 60000;
        if (elapsedMin > 0 && elapsedMin < 10) { // ignore stale gaps
          const added     = flow * elapsedMin;
          st.totalLitres += added;
          st.dailyLitres += added;
        }
      }
      st.lastFlowTs = now;

      // ── Gradual leak detection ────────────────────────────────────
      if (gradualEnable && st.weeklyUsage.length >= 3) {
        const baseline = st.weeklyUsage.reduce((s, d) => s + (d.litres || 0), 0) / st.weeklyUsage.length;
        if (baseline > 0 && st.dailyLitres > baseline * (1 + gradualAlertPct / 100)) {
          const todayM3 = (st.dailyLitres / 1000).toFixed(2);
          const baseM3  = (baseline       / 1000).toFixed(2);
          const overPct = Math.round((st.dailyLitres / baseline - 1) * 100);
          notifyOnce(
            '💧 Water Usage Alert',
            `Today: ${todayM3} m³ (+${overPct}% above ${baseM3} m³ avg). Possible slow leak.`,
            'warning',
            `water_${instId}_gradual`,
          );
        }
      }
    }
  } else {
    // No flow reading — reset integration anchor to avoid a false burst on reconnect
    st.lastFlowTs = 0;
  }

  // ── Pressure sensor — burst detection ─────────────────────────────────
  const pressure = ctx.value('pressure_sensor');
  if (pressure !== null) {
    if (!pressHist.has(instId)) pressHist.set(instId, []);
    const ph = pressHist.get(instId);
    ph.push({ v: pressure, ts: now });
    while (ph.length && ph[0].ts < now - PRESS_WINDOW) ph.shift();

    if (!leakDetected && ph.length >= 2) {
      const oldest   = ph[0].v;
      const drop     = oldest - pressure;
      const minutes  = (now - ph[0].ts) / 60000;
      const dropRate = drop / Math.max(minutes, 0.1);
      if (dropRate >= pressDropThresh) {
        leakDetected = true;
        leakSource   = 'pressure_drop';
        leakLabel    = `Pressure drop ${drop.toFixed(2)} bar in ${minutes.toFixed(1)} min`;
      }
    }
  }

  // ── Act on leak ────────────────────────────────────────────────────────
  if (leakDetected) {
    trip('water_leak', leakLabel || leakSource);
    ctx.broadcastState?.({
      status:         'alarm',
      alarm:          true,
      lockout_reason: leakLabel || leakSource || 'water_leak',
      leak_detected:  true,
      leak_source:    leakSource,
      leak_label:     leakLabel,
      shutoff_closed: true,
      last_alert_ts:  st.lastAlertTs || 0,
      last_trip_ts:   st.lastTripTs  || 0,
      auto_rearm_at:  st.autoRearmTs || 0,
      flow:           flow     ?? null,
      pressure:       pressure ?? null,
      total_m3:       Math.round(st.totalLitres) / 1000,
      daily_m3:       Math.round(st.dailyLitres) / 1000,
      test_mode: isTestMode,
      test_log_count: isTestMode ? (testModeLog.get(instId) || []).length : 0,
      test_log_recent: isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
    });
    return;
  }

  // ── Normal idle ────────────────────────────────────────────────────────
  saveRuntime(ctx, st);
  ctx.broadcastState?.({
    status:         'idle',
    alarm:          false,
    lockout_reason: null,
    leak_detected:  false,
    shutoff_closed: false,
    last_alert_ts:  st.lastAlertTs || 0,
    last_trip_ts:   st.lastTripTs  || 0,
    auto_rearm_at:  0,
    flow:           flow     ?? null,
    pressure:       pressure ?? null,
    total_m3:       Math.round(st.totalLitres) / 1000,
    daily_m3:       Math.round(st.dailyLitres) / 1000,
    test_mode: isTestMode,
    test_log_count: isTestMode ? (testModeLog.get(instId) || []).length : 0,
    test_log_recent: isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
  });
}

// ── Module definition ──────────────────────────────────────────────────────
const WATER_MANAGER_MODULE = {
  id:          'water_manager',
  name:        'Water Manager',
  icon:        '💧',
  description: 'Leak detection and automatic main valve shutoff. Flood sensors, night ghost-flow detection, pressure burst detection, per-sensor location labels, auto re-arm, and water meter with gradual leak tracking.',
  color:       '#3ab8ff',
  category:    'water',

  inputs: [
    { key: 'main_valve',      label: 'Main Water Valve',    type: 'relay',               required: true,
      description: "Motorized valve on the main water supply. Closes immediately when a leak is detected. Requires manual or auto re-arm to reopen." },
    { key: 'leak_sensor_1',   label: 'Leak Sensor 1',       type: 'sensor',              required: true,
      description: "Flood/moisture sensor. ON = wet. Set a location label in settings so notifications show exactly where the leak is." },
    { key: 'leak_sensor_2',   label: 'Leak Sensor 2',       type: 'sensor',              required: false,
      description: "Additional flood sensor." },
    { key: 'leak_sensor_3',   label: 'Leak Sensor 3',       type: 'sensor',              required: false,
      description: "Additional flood sensor." },
    { key: 'leak_sensor_4',   label: 'Leak Sensor 4',       type: 'sensor',              required: false,
      description: "Additional flood sensor." },
    { key: 'flow_sensor',     label: 'Flow Meter (L/min)',   type: 'sensor', unit: 'L/min', required: false,
      description: "Inline flow meter. Used for night ghost-flow detection, water meter accumulation, and gradual leak trend analysis." },
    { key: 'pressure_sensor', label: 'Pressure Sensor (bar)',type: 'sensor', unit: 'bar',   required: false,
      description: "Water pressure sensor. A sudden pressure drop indicates a pipe burst or major leak." },
  ],

  groups: [
    { id: 'basic',    label: '⚙️ Basic',            open: true,  requires: null },
    { id: 'sensors',  label: '📍 Sensor Labels',   open: false, requires: null },
    { id: 'flow',     label: '🌊 Ghost Flow',       open: false, requires: 'flow_sensor' },
    { id: 'pressure', label: '📉 Pressure',         open: false, requires: 'pressure_sensor' },
    { id: 'rearm',    label: '🔄 Auto Re-arm',      open: false, requires: null },
    { id: 'meter',    label: '🪣 Water Meter',      open: false, requires: 'flow_sensor' },
    { id: 'gradual',  label: '📈 Gradual Leak',     open: false, requires: 'flow_sensor' },
    { id: 'safety',   label: '🛡️ Safety',           open: false, requires: null },
  ],

  setpoints: [
    { group: 'basic',    key: 'alert_cooldown_s',      label: 'Alert cooldown',          type: 'number', unit: 's',      step: 60,  default: 300,
      help: "Minimum seconds between repeated alerts for the same condition." },

    { group: 'sensors',  key: 'leak_sensor_1_label',   label: 'Sensor 1 location',       type: 'text',   default: '',
      help: "Location name shown in alarm notifications, e.g. 'Under Boiler' or 'Washing Machine'. Leave empty to use the sensor key name." },
    { group: 'sensors',  key: 'leak_sensor_2_label',   label: 'Sensor 2 location',       type: 'text',   default: '',    help: "Location label for sensor 2." },
    { group: 'sensors',  key: 'leak_sensor_3_label',   label: 'Sensor 3 location',       type: 'text',   default: '',    help: "Location label for sensor 3." },
    { group: 'sensors',  key: 'leak_sensor_4_label',   label: 'Sensor 4 location',       type: 'text',   default: '',    help: "Location label for sensor 4." },

    { group: 'flow',     key: 'night_flow_enable',     label: 'Night ghost-flow detect', type: 'select', options: ['1','0'], default: '1',
      help: "Any flow above the threshold during the quiet night window triggers an alarm." },
    { group: 'flow',     key: 'flow_leak_threshold',   label: 'Flow alarm above',        type: 'number', unit: 'L/min', step: 0.5, default: 2,
      help: "Flow rate threshold for ghost-flow detection during night hours." },
    { group: 'flow',     key: 'night_start',           label: 'Night starts',            type: 'text',   default: '23:00',
      help: "Start of the quiet period for ghost-flow detection (HH:MM)." },
    { group: 'flow',     key: 'night_end',             label: 'Night ends',              type: 'text',   default: '06:00',
      help: "End of the quiet period (HH:MM)." },

    { group: 'pressure', key: 'pressure_drop_thresh',  label: 'Pressure drop alarm',     type: 'number', unit: 'bar/min', step: 0.1, default: 0.5,
      help: "Rate of pressure drop (bar/min) that triggers a pipe burst alarm." },

    { group: 'rearm',    key: 'auto_rearm_enable',     label: 'Enable auto re-arm',      type: 'select', options: ['0','1'], default: '0',
      help: "Automatically reopen the valve after the configured time. Use only when false alarms are common and the risk of a real undetected leak is low." },
    { group: 'rearm',    key: 'auto_rearm_min',        label: 'Re-arm after',            type: 'number', unit: 'min',   step: 5,   default: 60,
      help: "Minutes after a shutoff before the valve automatically reopens. Min 1 min." },

    { group: 'meter',    key: 'meter_enable',          label: 'Enable water meter',      type: 'select', options: ['0','1'], default: '0',
      help: "Accumulate flow sensor readings into total and daily m³ counters." },
    { group: 'meter',    key: 'meter_offset_m3',       label: 'Starting value',          type: 'number', unit: 'm³',    step: 0.1, default: 0,
      help: "Set total counter to this value on next meter reset (e.g. to match a physical meter)." },

    { group: 'gradual',  key: 'gradual_enable',        label: 'Gradual leak detection',  type: 'select', options: ['0','1'], default: '0',
      help: "Alert when today's water consumption is significantly higher than the rolling 7-day average. Requires meter_enable = 1." },
    { group: 'gradual',  key: 'gradual_alert_pct',     label: 'Alert if today >',        type: 'number', unit: '% above avg', step: 10, default: 50,
      help: "Trigger alert when daily usage exceeds the 7-day average by this percentage. E.g. 50 = alert at 1.5× baseline." },

    { group: 'safety',   key: '_reset_alarm',          label: 'Reset Alarm',             type: 'select', options: ['0','1'], default: '0',
      help: "Set to 1 to manually re-arm after a shutoff. Returns to 0 automatically." },
    { group: 'safety',   key: '_meter_reset',          label: 'Reset Water Meter',       type: 'select', options: ['0','1'], default: '0',
      help: "Set to 1 to reset counters to the starting value. Returns to 0 automatically." },
    { group: 'safety',   key: '_runtime_json',         label: 'Runtime State',           type: 'hidden', default: '' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      description: 'When ON, no commands are sent to IOs. All actions are logged only.' },
  ],

  validateSettings(settings) {
    const errors   = [];
    const warnings = [];
    const num = (k, d = 0) => {
      const v = settings?.[k];
      const n = Number(v ?? d);
      return Number.isFinite(n) ? n : d;
    };
    const hhmm = v => /^\d{2}:\d{2}$/.test(String(v || ''));

    if (num('alert_cooldown_s', 300) < 0)  errors.push('alert_cooldown_s must be 0 or greater.');
    if (num('flow_leak_threshold', 2) < 0) errors.push('flow_leak_threshold must be 0 or greater.');
    if (num('pressure_drop_thresh', 0.5) < 0) errors.push('pressure_drop_thresh must be 0 or greater.');
    if (!hhmm(settings?.night_start || '23:00')) warnings.push('night_start should be in HH:MM format.');
    if (!hhmm(settings?.night_end   || '06:00')) warnings.push('night_end should be in HH:MM format.');
    if (num('auto_rearm_min', 60) < 1)     warnings.push('auto_rearm_min should be at least 1 minute.');
    if (num('gradual_alert_pct', 50) < 10) warnings.push('gradual_alert_pct should be at least 10%.');

    return { errors, warnings };
  },

  commands: {
    reset_alarm: (ctx) => {
      ctx.setSetting('_reset_alarm', '1');
      return { success: true };
    },
    reset_meter: (ctx) => {
      ctx.setSetting('_meter_reset', '1');
      return { success: true };
    },
    get_test_log:   (ctx, { instId } = {}) => { return { log: testModeLog.get(instId) || [] }; },
    clear_test_log: (ctx, { instId } = {}) => { testModeLog.set(instId, []); return { ok: true }; },
  },
};

module.exports = { waterManagerHandler, WATER_MANAGER_MODULE };
