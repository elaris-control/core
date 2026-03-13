// src/automation/presence_simulator.js
// 🏠 Presence Simulator — "Someone is home" illusion
//
// When armed (away mode), simulates occupancy by:
//   - Randomly turning lights on/off within configured windows
//   - Moving awnings at realistic times
//   - TV relay on during evening window
//   - Radio/speaker relay on during configurable window
//
// Smart arming:
//   - presence_sensor DI: auto-arm when OFF (nobody home), auto-disarm when ON
//   - Vacation calendar: arm automatically for configured date range
//   - Both work as geofencing triggers when the external app publishes to MQTT
//
// Pattern randomization:
//   - Random initial stagger per light (0–5 min) when arming
//   - max_lights_on: never exceed N concurrent lights
//   - Each light runs an independent random ON/OFF timer

'use strict';

const simState   = new Map(); // instId → { armed, lastReason, lastEventTs, vacationActive }
const lightTimer = new Map(); // `${instId}_${key}` → timeout handle
const testModeLog = new Map(); // instId -> [{ts, io, value, reason}]

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function fmtDate(ts)    { return new Date(ts).toISOString().slice(0, 10); }

function parseHHMM(str) {
  if (!str || !str.includes(':')) return NaN;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function inWindow(nowMin, startMin, endMin) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
  return startMin <= endMin ? (nowMin >= startMin && nowMin < endMin)
                            : (nowMin >= startMin || nowMin < endMin);
}

function emitPresenceState(instId, ctx, extra = {}) {
  const state = simState.get(instId) || {};
  const lightKeys  = ['light_1','light_2','light_3','light_4'].filter(k => ctx.io(k));
  const nowMin     = new Date().getHours() * 60 + new Date().getMinutes();
  const evStart    = parseHHMM(ctx.settingStr('evening_start', '18:00'));
  const evEnd      = parseHHMM(ctx.settingStr('evening_end',   '23:00'));
  const _isTestMode = ctx.settingStr('test_mode', '0') === '1';
  ctx.broadcastState({
    status:          state.armed ? (state.vacationActive ? 'vacation' : 'armed') : 'disarmed',
    armed:           !!state.armed,
    vacation_active: !!state.vacationActive,
    active_lights:   lightKeys.filter(k => ctx.isOn(k)).length,
    mapped_lights:   lightKeys.length,
    tv_on:           !!(ctx.io('tv_relay')     && ctx.isOn('tv_relay')),
    radio_on:        !!(ctx.io('radio_relay')  && ctx.isOn('radio_relay')),
    awning_on:       !!(ctx.io('awning_relay') && ctx.isOn('awning_relay')),
    presence_detected: ctx.io('presence_sensor') ? ctx.isOn('presence_sensor') : null,
    in_evening:      inWindow(nowMin, evStart, evEnd),
    evening_start:   ctx.settingStr('evening_start', '18:00'),
    evening_end:     ctx.settingStr('evening_end',   '23:00'),
    last_reason:     state.lastReason  || 'Presence simulation idle',
    last_event_ts:   state.lastEventTs || 0,
    ...extra,
    test_mode: _isTestMode,
    test_log_count: _isTestMode ? (testModeLog.get(instId) || []).length : 0,
    test_log_recent: _isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
  });
}

function clearLightTimers(instId, lightKeys) {
  lightKeys.forEach(k => {
    const t = lightTimer.get(`${instId}_${k}`);
    if (t) clearTimeout(t);
    lightTimer.delete(`${instId}_${k}`);
  });
}

function scheduleNextEvent(instId, key, send, ctx, overrideDelayMs) {
  const lightKeys   = ['light_1','light_2','light_3','light_4'].filter(k => ctx.io(k));
  const minOnMs     = ctx.setting('light_min_on_min',  20) * 60000;
  const maxOnMs     = ctx.setting('light_max_on_min',  90) * 60000;
  const minOffMs    = ctx.setting('light_min_off_min', 10) * 60000;
  const maxOffMs    = ctx.setting('light_max_off_min', 45) * 60000;
  const maxLightsOn = parseInt(ctx.setting('max_lights_on', 0)) || 0;

  const isOn    = ctx.isOn(key);
  const wantOn  = !isOn;
  const onCount = lightKeys.filter(k => ctx.isOn(k)).length;
  const blocked = wantOn && maxLightsOn > 0 && onCount >= maxLightsOn;

  const nextAction = blocked ? null : (wantOn ? 'ON' : 'OFF');
  const delay = overrideDelayMs != null ? overrideDelayMs
              : blocked ? rand(minOffMs, maxOffMs)   // retry when another light frees up
              : isOn    ? rand(minOnMs, maxOnMs)
              :            rand(minOffMs, maxOffMs);

  const timerKey = `${instId}_${key}`;
  if (lightTimer.has(timerKey)) clearTimeout(lightTimer.get(timerKey));

  lightTimer.set(timerKey, setTimeout(() => {
    const st = simState.get(instId);
    if (!st?.armed) return;
    if (nextAction) {
      st.lastReason  = `Light ${key} → ${nextAction}`;
      st.lastEventTs = Date.now();
      send(key, nextAction, `Presence sim: ${key} → ${nextAction}`);
      emitPresenceState(instId, ctx, { active_key: key, action: nextAction });
    }
    scheduleNextEvent(instId, key, send, ctx);
  }, delay));
}

function armSimulator(instId, send, ctx, lightKeys, reason) {
  const state = simState.get(instId);
  state.armed = true;
  state.lastReason  = reason;
  state.lastEventTs = Date.now();
  // Pattern randomization: stagger each light's first event by 0–5 min
  lightKeys.forEach(k => {
    const stagger = rand(0, 5) * 60000;
    scheduleNextEvent(instId, k, send, ctx, stagger);
  });
  console.log(`[PRESENCE] Armed: "${reason}" — ${lightKeys.length} light(s), staggered start`);
}

function disarmSimulator(instId, send, ctx, lightKeys, reason) {
  const state = simState.get(instId);
  state.armed = false;
  state.vacationActive = false;
  state.lastReason  = reason;
  state.lastEventTs = Date.now();
  clearLightTimers(instId, lightKeys);
  lightKeys.forEach(k => send(k, 'OFF', 'Presence sim disarmed'));
  if (ctx.io('tv_relay'))     send('tv_relay',     'OFF', 'Presence sim disarmed');
  if (ctx.io('radio_relay'))  send('radio_relay',  'OFF', 'Presence sim disarmed');
  if (ctx.io('awning_relay')) send('awning_relay', 'OFF', 'Presence sim disarmed');
  console.log(`[PRESENCE] Disarmed: "${reason}"`);
}

function presenceSimulatorHandler(ctx, send) {
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

  if (!simState.has(instId)) {
    simState.set(instId, { armed: false, vacationActive: false, lastReason: 'Idle', lastEventTs: 0 });
  }
  const state = simState.get(instId);

  const lightKeys    = ['light_1','light_2','light_3','light_4'].filter(k => ctx.io(k));
  const manualArmed  = ctx.settingStr('armed', '0') === '1';
  const tvEnable     = ctx.setting('tv_enable',    0);
  const radioEnable  = ctx.setting('radio_enable', 0);
  const awningEnable = ctx.setting('awning_enable', 0);

  // ── Vacation calendar ─────────────────────────────────────────────────────
  const vacStart = ctx.settingStr('vacation_start', '').trim();
  const vacEnd   = ctx.settingStr('vacation_end',   '').trim();
  const today    = fmtDate(now);
  const inVacation = !!(vacStart && vacEnd && today >= vacStart && today <= vacEnd);

  // ── Presence sensor (smart arming / geofencing) ───────────────────────────
  let presenceTriggeredArm   = false;
  let presenceTriggeredDisarm = false;
  if (ctx.io('presence_sensor') && ctx.setting('smart_arm_enable', 0)) {
    const presenceOn = ctx.isOn('presence_sensor');
    if (!presenceOn && !state.armed) presenceTriggeredArm   = true;
    if (presenceOn  &&  state.armed && !inVacation && !manualArmed) presenceTriggeredDisarm = true;
  }

  // Effective armed state
  const shouldBeArmed = manualArmed || inVacation || presenceTriggeredArm;

  // ── Arm / Disarm transitions ──────────────────────────────────────────────
  if (!state.armed && shouldBeArmed) {
    state.vacationActive = inVacation && !manualArmed && !presenceTriggeredArm;
    const reason = inVacation ? `Vacation mode (${vacStart} – ${vacEnd})`
                 : presenceTriggeredArm ? 'Smart arm: presence sensor — nobody home'
                 : `Armed with ${lightKeys.length} light(s)`;
    armSimulator(instId, send, ctx, lightKeys, reason);
    emitPresenceState(instId, ctx);
    return;
  }

  if (state.armed && (!shouldBeArmed || presenceTriggeredDisarm)) {
    const reason = presenceTriggeredDisarm ? 'Smart disarm: presence detected'
                 : 'Disarmed';
    disarmSimulator(instId, send, ctx, lightKeys, reason);
    emitPresenceState(instId, ctx);
    return;
  }

  if (!state.armed) { emitPresenceState(instId, ctx); return; }

  // ── Evening / time window ─────────────────────────────────────────────────
  const nowMin  = new Date().getHours() * 60 + new Date().getMinutes();
  const evStart = parseHHMM(ctx.settingStr('evening_start', '18:00'));
  const evEnd   = parseHHMM(ctx.settingStr('evening_end',   '23:00'));
  const inEvening = inWindow(nowMin, evStart, evEnd);

  // ── TV ────────────────────────────────────────────────────────────────────
  if (tvEnable && ctx.io('tv_relay')) {
    const tvOn = ctx.isOn('tv_relay');
    if (inEvening && !tvOn) {
      state.lastReason = 'Evening TV on'; state.lastEventTs = now;
      send('tv_relay', 'ON', 'Presence sim: evening TV on');
    } else if (!inEvening && tvOn) {
      state.lastReason = 'Evening TV off'; state.lastEventTs = now;
      send('tv_relay', 'OFF', 'Presence sim: evening TV off');
    }
  }

  // ── Radio / speaker relay ─────────────────────────────────────────────────
  if (radioEnable && ctx.io('radio_relay')) {
    const radioStart = parseHHMM(ctx.settingStr('radio_start', '09:00'));
    const radioEnd   = parseHHMM(ctx.settingStr('radio_end',   '13:00'));
    const inRadio    = inWindow(nowMin, radioStart, radioEnd);
    const radioOn    = ctx.isOn('radio_relay');
    if (inRadio && !radioOn) {
      state.lastReason = 'Morning radio on'; state.lastEventTs = now;
      send('radio_relay', 'ON', 'Presence sim: morning radio on');
    } else if (!inRadio && radioOn) {
      state.lastReason = 'Radio off'; state.lastEventTs = now;
      send('radio_relay', 'OFF', 'Presence sim: radio off');
    }
  }

  // ── Awning ────────────────────────────────────────────────────────────────
  if (awningEnable && ctx.io('awning_relay')) {
    const awningOpenMin  = parseHHMM(ctx.settingStr('awning_open_time',  '08:00'));
    const awningCloseMin = parseHHMM(ctx.settingStr('awning_close_time', '20:00'));
    const awningOn = ctx.isOn('awning_relay');
    const shouldBeOpen = inWindow(nowMin, awningOpenMin, awningCloseMin);
    if (shouldBeOpen && !awningOn) {
      state.lastReason = 'Morning awning open'; state.lastEventTs = now;
      send('awning_relay', 'ON', 'Presence sim: morning awning open');
    } else if (!shouldBeOpen && awningOn) {
      state.lastReason = 'Evening awning close'; state.lastEventTs = now;
      send('awning_relay', 'OFF', 'Presence sim: evening awning close');
    }
  }

  emitPresenceState(instId, ctx);
}

const PRESENCE_SIMULATOR_MODULE = {
  id:          'presence_simulator',
  name:        'Presence Simulator',
  icon:        '🏠',
  description: 'Simulates occupancy when away: randomized lights with stagger and concurrent limit, TV, radio, and awning. Auto-arms via presence sensor (geofencing) or vacation date range.',
  color:       '#a855f7',
  category:    'smart',

  inputs: [
    { key: 'light_1',       label: 'Light 1',              type: 'relay',  required: true,
      description: 'First light relay. Switches randomly within configured ON/OFF duration range.' },
    { key: 'light_2',       label: 'Light 2',              type: 'relay',  required: false },
    { key: 'light_3',       label: 'Light 3',              type: 'relay',  required: false },
    { key: 'light_4',       label: 'Light 4',              type: 'relay',  required: false },
    { key: 'tv_relay',      label: 'TV Relay',             type: 'relay',  required: false,
      description: 'Turned ON during the evening window to simulate TV viewing.' },
    { key: 'radio_relay',   label: 'Radio / Speaker Relay', type: 'relay', required: false,
      description: 'Turned ON during the configured radio window (e.g. morning music).' },
    { key: 'awning_relay',  label: 'Awning Relay',         type: 'relay',  required: false,
      description: 'Opens at configured morning time and closes at evening time.' },
    { key: 'presence_sensor', label: 'Presence Sensor (DI)', type: 'sensor', required: false,
      description: 'ON = someone home, OFF = nobody home. Used for smart auto-arm and geofencing. Publish from phone app or geofence service to MQTT.' },
  ],

  groups: [
    { id: 'basic',    label: '⚙️ Basic',              open: true,  requires: null },
    { id: 'lights',   label: '💡 Light Timing',       open: false, requires: null },
    { id: 'evening',  label: '🌙 Evening & TV',        open: false, requires: null },
    { id: 'radio',    label: '📻 Radio',               open: false, requires: 'radio_relay' },
    { id: 'awning',   label: '🪟 Awning',              open: false, requires: 'awning_relay' },
    { id: 'smart',    label: '📍 Smart Arming',        open: false, requires: null },
    { id: 'vacation', label: '🏖️ Vacation Calendar',  open: false, requires: null },
  ],

  setpoints: [
    { group: 'basic',   key: 'armed',               label: 'Armed (away)',         type: 'select', options: ['0','1'],  default: '0' },
    { group: 'lights',  key: 'light_min_on_min',    label: 'Min ON time',          type: 'number', unit: 'min', step: 5,  default: 20 },
    { group: 'lights',  key: 'light_max_on_min',    label: 'Max ON time',          type: 'number', unit: 'min', step: 5,  default: 90 },
    { group: 'lights',  key: 'light_min_off_min',   label: 'Min OFF time',         type: 'number', unit: 'min', step: 5,  default: 10 },
    { group: 'lights',  key: 'light_max_off_min',   label: 'Max OFF time',         type: 'number', unit: 'min', step: 5,  default: 45 },
    { group: 'lights',  key: 'max_lights_on',       label: 'Max concurrent lights', type: 'number', step: 1,             default: 0,
      description: 'Max lights ON at the same time. 0 = no limit. Prevents the "all lights on" look.' },
    { group: 'evening', key: 'evening_start',       label: 'Evening start',        type: 'text',                        default: '18:00' },
    { group: 'evening', key: 'evening_end',         label: 'Evening end',          type: 'text',                        default: '23:00' },
    { group: 'evening', key: 'tv_enable',           label: 'TV simulation',        type: 'select', options: ['0','1'],  default: '0' },
    { group: 'radio',   key: 'radio_enable',        label: 'Radio simulation',     type: 'select', options: ['0','1'],  default: '0' },
    { group: 'radio',   key: 'radio_start',         label: 'Radio ON time',        type: 'text',                        default: '09:00' },
    { group: 'radio',   key: 'radio_end',           label: 'Radio OFF time',       type: 'text',                        default: '13:00' },
    { group: 'awning',  key: 'awning_enable',       label: 'Awning simulation',    type: 'select', options: ['0','1'],  default: '0' },
    { group: 'awning',  key: 'awning_open_time',    label: 'Awning open time',     type: 'text',                        default: '08:00' },
    { group: 'awning',  key: 'awning_close_time',   label: 'Awning close time',    type: 'text',                        default: '20:00' },
    { group: 'smart',   key: 'smart_arm_enable',    label: 'Enable smart arming',  type: 'select', options: ['0','1'],  default: '0',
      description: 'Auto-arm when presence_sensor goes OFF, auto-disarm when it comes back ON.' },
    { group: 'vacation',key: 'vacation_start',      label: 'Vacation start date',  type: 'text',                        default: '',
      description: 'YYYY-MM-DD. Module arms automatically on this date.' },
    { group: 'vacation',key: 'vacation_end',        label: 'Vacation end date',    type: 'text',                        default: '',
      description: 'YYYY-MM-DD. Module disarms automatically after this date.' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      description: 'When ON, no commands are sent to IOs. All actions are logged only.' },
  ],
};

module.exports = { presenceSimulatorHandler, PRESENCE_SIMULATOR_MODULE };
