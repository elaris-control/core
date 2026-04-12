// src/automation/dimming_lighting.js
// Dimming Lighting — Up/Down button dimmer with double-tap levels

const dimmingLevel  = new Map(); // instId → number 0–100
const doubleTapUpTs = new Map(); // instId → timestamp of last Up press
const doubleTapDnTs = new Map(); // instId → timestamp of last Down press
const diUpPrev      = new Map(); // "instId:key" → boolean
const diDnPrev      = new Map(); // "instId:key" → boolean
const diDebounce    = new Map(); // "instId:key" → timestamp
const dimmingLastReason = new Map(); // instId → last reason string for idle broadcast

const DOUBLE_TAP_WINDOW_MS = 500;
const DEBOUNCE_MS = 50;

function parseBinaryState(raw) {
  return raw === 'ON' || raw === '1' || raw === 'true';
}

function detectRisingEdge(instId, diKey, prevMap, ctx) {
  const raw = ctx.state(diKey);
  const isOn = parseBinaryState(raw);
  const prevKey = `${instId}:${diKey}`;
  const prevOn  = prevMap.get(prevKey) === true;
  const now     = Date.now();
  const lastChange = diDebounce.get(prevKey) || 0;
  if (now - lastChange < DEBOUNCE_MS) return false;
  if (isOn !== prevOn) {
    diDebounce.set(prevKey, now);
    prevMap.set(prevKey, isOn);
  }
  return isOn && !prevOn;
}

function applyLevel(instId, newLevel, ctx, send, reason) {
  const clamped = Math.max(0, Math.min(100, newLevel));
  dimmingLevel.set(instId, clamped);
  dimmingLastReason.set(instId, reason);
  ctx.setSetting('_level', String(clamped));
  if (ctx.io('ao')) send('ao', clamped, reason);
  if (ctx.io('do')) send('do', clamped > 0 ? 'ON' : 'OFF', reason);
  ctx.broadcastState?.({
    status:      clamped > 0 ? 'active' : 'idle',
    output_on:   clamped > 0,
    level:       clamped,
    last_reason: reason,
  });
}

function dimmingLightingHandler(ctx, send) {
  const instId = ctx.instance.id;
  if (!dimmingLevel.has(instId)) {
    const saved = parseInt(ctx.settingStr('_level', '0'), 10);
    dimmingLevel.set(instId, isNaN(saved) ? 0 : saved);
  }
  const level = dimmingLevel.get(instId);
  const step     = Math.max(1, Math.min(100, ctx.setting('step', 10)));
  const dtUpLv   = Math.max(0, Math.min(100, ctx.setting('double_tap_up_level', 100)));
  const dtDnLv   = Math.max(0, Math.min(100, ctx.setting('double_tap_down_level', 0)));
  const testMode = ctx.settingStr('test_mode', '0') === '1';

  const upPressed = ctx.io('di_up')   ? detectRisingEdge(instId, 'di_up',   diUpPrev, ctx) : false;
  const dnPressed = ctx.io('di_down') ? detectRisingEdge(instId, 'di_down', diDnPrev, ctx) : false;

  if (upPressed) {
    const now    = Date.now();
    const lastUp = doubleTapUpTs.get(instId) || 0;
    if (now - lastUp < DOUBLE_TAP_WINDOW_MS) {
      doubleTapUpTs.delete(instId);
      const reason = `Double-tap Up — ${dtUpLv}%`;
      if (!testMode) applyLevel(instId, dtUpLv, ctx, send, reason);
      else ctx.broadcastState?.({ status: dtUpLv > 0 ? 'active' : 'idle', output_on: false, level: dtUpLv, last_reason: '[TEST] ' + reason });
    } else {
      doubleTapUpTs.set(instId, now);
      const next   = Math.min(100, level + step);
      const reason = `Up — ${next}%`;
      if (!testMode) applyLevel(instId, next, ctx, send, reason);
      else ctx.broadcastState?.({ status: next > 0 ? 'active' : 'idle', output_on: false, level: next, last_reason: '[TEST] ' + reason });
    }
    return;
  }

  if (dnPressed) {
    const now    = Date.now();
    const lastDn = doubleTapDnTs.get(instId) || 0;
    if (now - lastDn < DOUBLE_TAP_WINDOW_MS) {
      doubleTapDnTs.delete(instId);
      const reason = `Double-tap Down — ${dtDnLv}%`;
      if (!testMode) applyLevel(instId, dtDnLv, ctx, send, reason);
      else ctx.broadcastState?.({ status: dtDnLv > 0 ? 'active' : 'idle', output_on: false, level: dtDnLv, last_reason: '[TEST] ' + reason });
    } else {
      doubleTapDnTs.set(instId, now);
      const next   = Math.max(0, level - step);
      const reason = `Down — ${next}%`;
      if (!testMode) applyLevel(instId, next, ctx, send, reason);
      else ctx.broadcastState?.({ status: next > 0 ? 'active' : 'idle', output_on: false, level: next, last_reason: '[TEST] ' + reason });
    }
    return;
  }

  // No button press — broadcast current state only
  ctx.broadcastState?.({
    status:      level > 0 ? 'active' : 'idle',
    output_on:   level > 0,
    level,
    last_reason: dimmingLastReason.get(instId) || null,
  });
}

// — Module definition —————————————————————————————————————————————

const DIMMING_LIGHTING_MODULE = {
  id:          'dimming_lighting',
  name:        'Dimming Lighting',
  icon:        '💡',
  description: 'Up/Down button dimmer with configurable step and double-tap levels. Optional relay follows AO.',
  color:       '#f5c842',
  category:    'lighting',
  inputs: [
    { key: 'di_up',   label: 'Up Button (DI)',    type: 'sensor', required: false, description: 'Press → level + step%' },
    { key: 'di_down', label: 'Down Button (DI)',   type: 'sensor', required: false, description: 'Press → level - step%' },
    { key: 'ao',      label: 'Dimmer Output (AO)', type: 'analog', required: true,  description: '0–100% dimmer output' }, // handler guards ctx.io('ao') defensively; required here blocks UI from saving without AO
    { key: 'do',      label: 'Relay (DO)',          type: 'relay',  required: false, description: 'Optional — follows AO (>0 = ON)' },
  ],
  setpoints: [
    { key: 'step',                  label: 'Step',                  type: 'number', default: 10,  min: 1, max: 100, step: 1, unit: '%', help: 'Level change per Up/Down press.' },
    { key: 'double_tap_up_level',   label: 'Double-tap Up level',   type: 'number', default: 100, min: 0, max: 100, step: 5, unit: '%', help: 'Level set when Up button is double-tapped (< 500ms).' },
    { key: 'double_tap_down_level', label: 'Double-tap Down level', type: 'number', default: 0,   min: 0, max: 100, step: 5, unit: '%', help: 'Level set when Down button is double-tapped (< 500ms).' },
    { key: 'test_mode',             label: 'Test mode (dry run)',   type: 'select', options: ['0', '1'], default: '0', help: 'Logic runs but no real outputs are sent.' },
  ],
};

module.exports = {
  dimmingLightingHandler,
  DIMMING_LIGHTING_MODULE,
  dimmingLevel,
  dimmingLastReason,
  doubleTapUpTs,
  doubleTapDnTs,
  diUpPrev,
  diDnPrev,
  diDebounce,
};
