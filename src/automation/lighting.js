// src/automation/lighting.js  v2
// 💡 Full-featured lighting automation
//
// Inputs:
//   light_relay     DO  relay output            (required if no dimmer)
//   dimmer_output   AO  0-100% analog dimmer    (optional)
//   switch_di       DI  physical wall switch     (optional)
//   pir_sensor      DI  classic PIR ON/OFF       (optional)
//   motion_ai       AI  presence value 0-100     (optional)
//   lux_sensor      AI  ambient lux              (optional)
//
// Modes: auto | pir | lux | schedule | combined | manual
//
// Schedule format: "HH:MM" | "sunrise+30" | "sunset-15" | "sunrise" | "sunset"

const { getSun, calcSun, parseSunTime, sunCache: _sunCache } = require('./helpers/sun');
const { localMinutes } = require('./time_utils');

const lastMotionTime = new Map();
const switchState    = new Map();
const manualState    = new Map();
const sunCache       = new Map();
const switchTapTime  = new Map();
const lastModeSeen   = new Map();
const pirSeenState   = new Map();
const switchFastLock = new Map();

function parseTime(str, sun) {
  if (!str || !str.trim()) return null;
  str = str.trim();
  if (/^\d{1,2}:\d{2}$/.test(str)) { const [h,m]=str.split(':').map(Number); return h*60+m; }
  const base = str.startsWith('sunrise') ? sun?.sunrise : str.startsWith('sunset') ? sun?.sunset : null;
  if (base == null) return null;
  const m = str.match(/([+-]\d+)/);
  return base + (m ? parseInt(m[1]) : 0);
}

function inRange(now, on, off) {
  if (on==null||off==null) return false;
  return on<off ? now>=on&&now<off : now>=on||now<off;
}

function slugifyActionPart(input, fallback = 'Lighting') {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const slug = raw
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function lightingActionName(ctx, source, on) {
  const relayKeys = ['light_relay', 'light_relay_2', 'light_relay_3', 'light_relay_4'];
  const mapped = relayKeys.filter((k) => !!ctx?.io?.(k));
  const primaryRelayName = ctx?.io?.('light_relay')?.name || '';
  const base = mapped.length <= 1 && primaryRelayName
    ? slugifyActionPart(primaryRelayName, 'Lighting')
    : slugifyActionPart(ctx?.instance?.name || 'Lighting', 'Lighting');
  const src = slugifyActionPart(source || 'Auto', 'Auto');
  return `${base}_${src}_Calling_${on ? 'ON' : 'OFF'}`;
}

function sendRelayOutputs(send, ctx, on, reason, action) {
  for (let i = 1; i <= 4; i++) {
    const key = i === 1 ? 'light_relay' : `light_relay_${i}`;
    if (!ctx.io(key)) continue;
    send(key, on ? 'ON' : 'OFF', reason, { action, skipLog: true });
  }
}

function setOut(send, ctx, hasDimmer, on, dimOn, dimOff, reason, source = 'Auto') {
  const action = lightingActionName(ctx, source, !!on);
  if (hasDimmer) {
    if (on) {
      // Turn ON: relay first (power-enable), then AO to target level
      sendRelayOutputs(send, ctx, true, reason, action);
      send('dimmer_output', dimOn, reason, { action });
    } else {
      // Turn OFF: AO to off-level first, then relay (safe dim-down before power cut)
      send('dimmer_output', dimOff, reason, { action });
      sendRelayOutputs(send, ctx, false, reason, action);
    }
  } else {
    let loggedPrimary = false;
    for (let i = 1; i <= 4; i++) {
      const key = i === 1 ? 'light_relay' : `light_relay_${i}`;
      if (!ctx.io(key)) continue;
      if (!loggedPrimary) {
        send(key, on ? 'ON' : 'OFF', reason, { action });
        loggedPrimary = true;
      } else {
        send(key, on ? 'ON' : 'OFF', reason, { skipLog: true });
      }
    }
  }
}
function broadcastLightingState(ctx, extra) {
  try {
    const dimOffLevel = Number(ctx.setting('dim_off_level', 0));
    const dimVal = ctx.value('dimmer_output');
    const relayOn = ctx.isOn('light_relay');
    const dimKnown = dimVal != null && dimVal !== '';
    const dimOn = dimKnown ? Number(dimVal) > (dimOffLevel + 5) : false;
    const on = dimKnown ? (dimOn || !!relayOn) : !!relayOn;
    ctx.broadcastState?.(Object.assign({
      mode: ctx.settingStr('mode', 'auto'),
      status: on ? 'on' : 'off',
      output_on: !!on,
      dimmer_level: dimVal != null ? Number(dimVal) : null,
      relay_on: !!relayOn,
      relay_2_on: !!ctx.isOn('light_relay_2'),
      relay_3_on: !!ctx.isOn('light_relay_3'),
      relay_4_on: !!ctx.isOn('light_relay_4'),
      source: null,
      manual_active: false,
      schedule_active: false,
      motion_active: false,
      dark: null,
      lux_value: ctx.value('lux_sensor') != null ? Number(ctx.value('lux_sensor')) : null,
      motion_value: ctx.value('motion_ai') != null ? Number(ctx.value('motion_ai')) : null,
      pir_state: ctx.state('pir_sensor') || null,
      last_reason: null
    }, extra || {}));
  } catch {}
}

function applyLuxDimming(send, ctx, options) {
  const {
    hasDimmer,
    hasLux,
    isActive,
    lux,
    luxDimTarget,
    luxDimMaxLevel,
    dimOnLevel,
    dimOffLevel,
  } = options;

  if (!hasDimmer || !hasLux || !isActive) return false;

  const targetLux = Number(luxDimTarget);
  const currentLux = Number(lux);
  if (!Number.isFinite(targetLux) || targetLux <= 0 || !Number.isFinite(currentLux)) return false;

  const currentLevelRaw = Number(ctx.value('dimmer_output'));
  const fallbackLevel = Number.isFinite(Number(dimOnLevel)) ? Number(dimOnLevel) : 100;
  const offLevel = Number.isFinite(Number(dimOffLevel)) ? Number(dimOffLevel) : 0;
  const currentLevel = Number.isFinite(currentLevelRaw) && currentLevelRaw > (offLevel + 5)
    ? currentLevelRaw
    : fallbackLevel;

  const error = currentLux - targetLux;
  const step = Math.round(error / 15);
  const minLevel = Math.max(5, offLevel);
  const maxLevel = Math.max(minLevel, Number.isFinite(Number(luxDimMaxLevel)) ? Number(luxDimMaxLevel) : 100);
  const newLevel = Math.max(minLevel, Math.min(maxLevel, currentLevel - step));

  if (Math.abs(newLevel - currentLevel) < 2) return false;

  send('dimmer_output', newLevel, `Lux dim: lux=${currentLux.toFixed(0)} target=${targetLux} to ${newLevel}%`);
  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────────
function lightingHandler(ctx, send, siteInfo) {
  const instId = ctx.instance.id;
  const now    = Date.now();
  const nowMin = localMinutes(siteInfo);

  const mode            = ctx.settingStr('mode',            'auto');
  const prevMode        = lastModeSeen.get(instId);
  if (prevMode != null && prevMode !== mode) manualState.delete(instId);
  lastModeSeen.set(instId, mode);
  const luxThreshold    = ctx.setting('lux_threshold',       50);
  const luxThresholdOff = ctx.setting('lux_threshold_off',  luxThreshold * 1.15); // OFF threshold (brighter)
  const pirTimeout      = ctx.setting('pir_timeout',         300) * 1000;
  const motionThreshold = ctx.setting('motion_threshold',    10);
  const dimOnLevel      = ctx.setting('dim_on_level',        100);
  const dimOffLevel     = ctx.setting('dim_off_level',       0);
  const schedOnStr      = ctx.settingStr('schedule_on',      '');
  const schedOffStr     = ctx.settingStr('schedule_off',     '');
  const switchToggle    = ctx.setting('switch_toggle',       1) >= 1;
  const manualExpiry    = ctx.setting('manual_timeout_s',    0) * 1000;
  const switchRetriggerBlockMs = Math.max(0, Number(ctx.setting('switch_retrigger_block_s', 1)) * 1000);

  const luxDimTarget    = ctx.setting('lux_dim_target',    0);   // 0 = disabled
  const luxDimMaxLevel  = ctx.setting('lux_dim_max_level', 100); // cap brightness

  const hasDimmer  = !!ctx.io('dimmer_output');
  const hasSwitch  = !!ctx.io('switch_di');
  const hasPIR     = !!ctx.io('pir_sensor');
  const hasMotionAI= !!ctx.io('motion_ai');
  const hasLux     = !!ctx.io('lux_sensor');

  const mappedRelays = ['light_relay', 'light_relay_2', 'light_relay_3', 'light_relay_4'].filter(k => !!ctx.io(k));
  const anyRelayMapped = mappedRelays.length > 0;
  const dimVal = ctx.value('dimmer_output');
  const dimKnown = dimVal != null && dimVal !== '';
  const relayAnyOn = mappedRelays.some(k => ctx.isOn(k) === true);
  const isOn = hasDimmer
    ? ((dimKnown ? Number(dimVal) > (dimOffLevel + 5) : false) || relayAnyOn)
    : relayAnyOn;
  const allRelaysUnknown = anyRelayMapped && mappedRelays.every(k => ctx.isOn(k) === undefined);
  const relayStateUnknown = !hasDimmer && allRelaysUnknown;

  // ── Wall switch (DI) — fast path for immediate light response ───────
  if (hasSwitch) {
    const sw    = ctx.state('switch_di');
    const prevSw= switchState.get(instId);

    // Long gap (>10 sec) → reconnect / ESP reboot → sync state only, don't toggle
    const lastTap = switchTapTime.get(instId) || 0;
    if (lastTap > 0 && (now - lastTap) > 5000) {
      switchState.set(instId, sw);
      switchFastLock.set(instId, now + switchRetriggerBlockMs);
    } else {
      switchState.set(instId, sw);
    }

    const swOn  = sw==='ON'||sw==='1'||sw==='true';
    const prevOn= prevSw==='ON'||prevSw==='1'||prevSw==='true';
    let fastHandled = false;

    // Skip edge detection entirely if we just synced after a long gap
    const justSynced = lastTap > 0 && (now - lastTap) > 5000;
    if (justSynced) {
      switchTapTime.set(instId, 0); // reset so next press is handled normally
    } else if (swOn && !prevOn) { // rising edge
      const lockUntil = switchFastLock.get(instId) || 0;
      const dt = now - lastTap;
      const isDoubleTap = dt > 50 && dt < 500;
      // Allow double-tap through even if debounce lock is active —
      // the second tap must not be blocked or double-tap can never fire.
      if (switchRetriggerBlockMs > 0 && now < lockUntil && !isDoubleTap) {
        // bounce — skip switch logic only, continue to PIR/schedule/lux
      } else {
        switchTapTime.set(instId, now);
        if (isDoubleTap) {
          const doubleTapLevel = ctx.setting('double_tap_level', 100);
          if (hasDimmer) {
            send('dimmer_output', doubleTapLevel, `Double-tap: ${doubleTapLevel}%`, { action: lightingActionName(ctx, 'Switch', true) });
          } else {
            setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, 'Double-tap: ON', 'Switch');
          }
          manualState.set(instId, { on: true, ts: now });
          if (switchRetriggerBlockMs > 0) switchFastLock.set(instId, now + switchRetriggerBlockMs);
          broadcastLightingState(ctx, { manual_active: true, source: 'manual', schedule_active: false, motion_active: false, dark: null, last_reason: hasDimmer ? `Double-tap: ${doubleTapLevel}%` : 'Double-tap: ON', status: 'on', output_on: true });
          return;
        }
        if (relayStateUnknown) return;
        const targetOn = switchToggle ? !isOn : swOn;
        const reason = targetOn ? 'Manual ON' : 'Manual OFF';
        manualState.set(instId, { on: targetOn, ts: now });
        if (switchRetriggerBlockMs > 0) switchFastLock.set(instId, now + switchRetriggerBlockMs);
        setOut(send, ctx, hasDimmer, targetOn, dimOnLevel, dimOffLevel, reason, 'Switch');
        broadcastLightingState(ctx, { manual_active: true, source: 'manual', schedule_active: false, motion_active: false, dark: null, last_reason: reason, status: targetOn ? 'on' : 'off', output_on: !!targetOn });
        return;
      }
    } else if (!switchToggle && sw !== prevSw) {
      const lockUntil = switchFastLock.get(instId) || 0;
      if (switchRetriggerBlockMs > 0 && now < lockUntil) {
        // skip switch logic only, continue to PIR/schedule/lux
      } else {
        const reason = swOn ? 'Manual ON' : 'Manual OFF';
        manualState.set(instId, { on: swOn, ts: now });
        if (switchRetriggerBlockMs > 0) switchFastLock.set(instId, now + switchRetriggerBlockMs);
        setOut(send, ctx, hasDimmer, swOn, dimOnLevel, dimOffLevel, reason, 'Switch');
        broadcastLightingState(ctx, { manual_active: true, source: 'manual', schedule_active: false, motion_active: false, dark: null, last_reason: reason, status: swOn ? 'on' : 'off', output_on: !!swOn });
        return;
      }
    }
  }

  // ── Sunrise/sunset + sensor snapshot ─────────────────────────────────
  const sun = siteInfo ? getSun(siteInfo.lat, siteInfo.lon) : null;
  const schedOn  = parseTime(schedOnStr,  sun);
  const schedOff = parseTime(schedOffStr, sun);
  const inSched  = inRange(nowMin, schedOn, schedOff);

  const lux        = hasLux      ? ctx.value('lux_sensor')  : null;
  const pirState   = hasPIR      ? ctx.state('pir_sensor')  : null;
  const motionVal  = hasMotionAI ? ctx.value('motion_ai')   : null;
  const pirOn      = pirState==='ON'||pirState==='1'||pirState==='true';
  const motion     = pirOn || (motionVal!=null && motionVal >= motionThreshold);
  const isDark     = lux==null ? true : lux < luxThreshold;
  const timeSince  = lastMotionTime.has(instId) ? now - lastMotionTime.get(instId) : Infinity;
  const prevPirRaw = pirSeenState.get(instId);
  const prevPirOn  = prevPirRaw==='ON'||prevPirRaw==='1'||prevPirRaw==='true';
  pirSeenState.set(instId, pirState || '0');

  if (motion) lastMotionTime.set(instId, now);

  // ── Manual override (dashboard or switch) ───────────────────────────
  const manual = manualState.get(instId);
  if (manual) {
    const expired = manualExpiry > 0 && (now - manual.ts) > manualExpiry;
    if (!expired) {
      const r = manual.on ? 'Manual ON' : 'Manual OFF';
      // Use manual_level if set, otherwise fall back to dimOnLevel/dimOffLevel
      const manualLevel = ctx.setting('manual_level', NaN);
      const effectiveDimOn = Number.isFinite(manualLevel) ? manualLevel : dimOnLevel;
      const effectiveDimOff = dimOffLevel;
      setOut(send, ctx, hasDimmer, manual.on, effectiveDimOn, effectiveDimOff, r, 'Manual');
      broadcastLightingState(ctx, { manual_active: true, source: 'manual', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: r });
      return;
    }
    manualState.delete(instId);
  }

  if (hasPIR && pirOn && !prevPirOn) {
    if (mode === 'pir' && !isOn) {
      const reason = 'Motion';
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, reason, 'PIR');
      broadcastLightingState(ctx, { source: 'pir', schedule_active: inSched, motion_active: true, dark: !!isDark, last_reason: reason, status: 'on', output_on: true });
      return;
    }
    if ((mode === 'combined' || mode === 'auto') && isDark && !isOn) {
      const reason = mode === 'combined' ? (hasLux ? `Motion+dark lux=${lux??'?'}` : 'Motion') : 'Auto: motion';
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, reason, 'PIR');
      broadcastLightingState(ctx, { source: mode === 'combined' ? 'combined' : 'auto_motion', schedule_active: inSched, motion_active: true, dark: !!isDark, last_reason: reason, status: 'on', output_on: true });
      return;
    }
  }

  if (mode === 'manual') {
    broadcastLightingState(ctx, { manual_active: true, source: 'manual_mode', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: 'Manual mode' });
    return;
  }

  // ── SCHEDULE mode ───────────────────────────────────────────────────
  if (mode === 'schedule') {
    if (inSched  && !isOn) setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Schedule ON (${schedOnStr || schedOn})`, 'Schedule');
    if (!inSched && isOn)  setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Schedule OFF (${schedOffStr || schedOff})`, 'Schedule');
    applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: inSched, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
    broadcastLightingState(ctx, { source: 'schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? `In schedule window` : `Outside schedule` });
    return;
  }

  // ── LUX mode ────────────────────────────────────────────────────────
  if (mode === 'lux') {
    if (!hasLux) { broadcastLightingState(ctx, { source: 'lux', schedule_active: inSched, motion_active: !!motion, dark: null, last_reason: 'Lux sensor not mapped' }); return; }
    if (!isOn && isDark)                   setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, lux != null ? `Dark: lux=${lux} < ${luxThreshold}` : 'Dark: lux unknown', 'Lux');
    else if (isOn && lux >= luxThresholdOff) setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Bright: lux=${lux?.toFixed(0)}`, 'Lux');
    applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: isDark, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
    broadcastLightingState(ctx, { source: 'lux', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: isDark ? (lux != null ? `Dark: lux=${lux}` : 'Dark: lux unknown') : `Bright: lux=${lux?.toFixed(0)}` });
    return;
  }

  // ── PIR mode ────────────────────────────────────────────────────────
  if (mode === 'pir') {
    if (motion && !isOn)
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, motionVal!=null ? `Motion AI=${motionVal}` : 'Motion', 'PIR');
    else if (isOn && !motion && timeSince > pirTimeout) {
      lastMotionTime.delete(instId);
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `No motion ${Math.round(timeSince/1000)}s`, 'PIR');
    }
    applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: !!motion, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
    broadcastLightingState(ctx, { source: 'pir', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: motion ? (motionVal!=null ? `Motion AI=${motionVal}` : 'Motion') : `No motion` });
    return;
  }

  // ── COMBINED mode: PIR only when dark ───────────────────────────────
  if (mode === 'combined') {
    if (motion && isDark && !isOn)
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, hasLux ? `Motion+dark lux=${lux??'?'}` : 'Motion', 'PIR');
    else if (isOn && (!motion||!isDark) && timeSince > pirTimeout) {
      lastMotionTime.delete(instId);
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Timeout/bright`, 'PIR');
    }
    applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: !!motion && !!isDark, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
    broadcastLightingState(ctx, { source: 'combined', schedule_active: inSched, motion_active: !!motion, dark: hasLux ? !!isDark : null, last_reason: motion && isDark ? (hasLux ? 'Motion + dark' : 'Motion') : (!isDark ? 'Bright enough' : 'No motion') });
    return;
  }

  // ── AUTO mode: all sources, priority stack ──────────────────────────
  if (mode === 'auto') {
    // Hard schedule OFF
    if (schedOn!=null && schedOff!=null && !inSched) {
      if (isOn) setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Outside schedule`, 'Schedule');
      broadcastLightingState(ctx, { source: 'schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? `Schedule ON (${schedOnStr || schedOn})` : 'Outside schedule' });
      return;
    }
    // Bright override → always off
    if (hasLux && lux != null && lux >= luxThresholdOff && isOn) {
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Auto: bright lux=${lux?.toFixed(0)}`, 'Lux');
      broadcastLightingState(ctx, { source: 'auto_lux', schedule_active: inSched, motion_active: !!motion, dark: false, last_reason: `Auto: bright lux=${lux?.toFixed(0)}` });
      return;
    }
    // Motion (when dark enough or no lux sensor)
    if (hasPIR || hasMotionAI) {
      if (motion && isDark && !isOn)
        setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, motionVal!=null ? `Auto: motion AI=${motionVal}` : 'Auto: motion', 'PIR');
      else if (isOn && !motion && timeSince > pirTimeout) {
        lastMotionTime.delete(instId);
        setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Auto: no motion ${Math.round(timeSince/1000)}s`, 'PIR');
      }
      applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: !!motion && !!isDark, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
      broadcastLightingState(ctx, { source: 'auto_motion', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: motion && isDark ? (motionVal!=null ? `Auto: motion AI=${motionVal}` : 'Auto: motion') : (isDark ? 'Auto: no motion' : 'Bright enough') });
      return;
    }
    // Lux-only (no motion sensor)
    if (hasLux) {
      if (!isOn && isDark)  setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, lux != null ? `Auto: dark lux=${lux}` : 'Auto: lux unknown', 'Lux');
      applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: !!isDark, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
      broadcastLightingState(ctx, { source: 'auto_lux_only', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: isDark ? (lux != null ? `Auto: dark lux=${lux}` : 'Auto: lux unknown') : `Auto: bright lux=${lux?.toFixed(0)}` });
      return;
    }
    // Schedule only
    if (inSched && !isOn) setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Auto: schedule`, 'Schedule');
    applyLuxDimming(send, ctx, { hasDimmer, hasLux, isActive: inSched, lux, luxDimTarget, luxDimMaxLevel, dimOnLevel, dimOffLevel });
    broadcastLightingState(ctx, { source: 'auto_schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? 'Auto: schedule window' : 'Auto idle' });
    return;
  }
}

// ── Set manual state (called from dashboard) ──────────────────────────────────
function setManual(instId, on) {
  manualState.set(instId, { on, ts: Date.now() });
}

function clearManual(instId) {
  manualState.delete(instId);
}

// ── Module definition ──────────────────────────────────────────────────────────
const LIGHTING_MODULE = {
  id:          'lighting',
  name:        'Advanced Lighting',
  icon:        '💡',
  description: 'Switch (DI), PIR (DI), presence (AI), lux (AI), dimmer (AO), schedule with sunrise/sunset offsets.',
  color:       '#ffd700',
  category:    'lighting',

  inputs: [
    { key: 'light_relay',   label: 'Light Relay (DO)',          type: 'relay',       required: false,
      description: "Relay output that switches the light circuit ON/OFF. Use this for standard on/off lights (not dimmable). Connect to one or more light fixtures." },
    { key: 'dimmer_output', label: 'Dimmer Output AO (0-100%)', type: 'analog_out',  required: false,
      description: "Analog output (0–100%) connected to a dimmer actuator or LED driver. Allows brightness control. If mapped, the relay becomes redundant." },
    { key: 'switch_di',     label: 'Wall Switch (DI)',          type: 'sensor',      required: false,
      description: "Physical wall switch or push button. Can work in toggle mode (each press flips ON/OFF) or follow mode (tracks switch state directly)." },
    { key: 'pir_sensor',    label: 'PIR Motion (DI)',           type: 'sensor',      required: false,
      description: "PIR motion detector (digital: ON = motion detected). Triggers the light and starts the auto-off timer." },
    { key: 'motion_ai',     label: 'Presence Sensor (AI 0-100)',type: 'sensor', unit: '%', required: false,
      description: "Analog presence sensor (0–100%). Works with radar-based presence detectors that output a probability or intensity value." },
    { key: 'lux_sensor',    label: 'Lux Sensor (AI)',           type: 'sensor', unit: 'lux', required: false,
      description: "Ambient light sensor in lux. Prevents the light from turning on during daytime when there is already enough natural light." },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false,
      description: "Second relay output controlled in parallel with Relay 1. All mapped relay outputs switch together." },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false,
      description: "Third relay output controlled in parallel." },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false,
      description: "Fourth relay output controlled in parallel." },
  ],

  groups: [
    { id: 'General',  label: '⚙️ General',  open: true,  requires: null },
    { id: 'Motion',   label: '🏃 Motion',   open: false, requiresAny: ['pir_sensor', 'motion_ai'] },
    { id: 'Lux',      label: '☀️ Lux',      open: false, requires: 'lux_sensor' },
    { id: 'Dimmer',   label: '🎚️ Dimmer',   open: false, requires: 'dimmer_output' },
    { id: 'Schedule', label: '📅 Schedule', open: false, requires: null },
    { id: 'Switch',   label: '🔘 Switch',   open: false, requires: 'switch_di' },
    { id: 'Lux Dimming', label: '🎯 Lux Dimming', open: false, requires: 'dimmer_output' },
  ],

  setpoints: [
    { group: 'General', key: 'mode', label: 'Mode', type: 'select',
      options: ['auto','pir','lux','schedule','combined','manual'], default: 'auto',
      help: 'auto: uses all available sensors together. pir: triggers only on motion. lux: turns ON when ambient light is low. schedule: follows ON/OFF times only. combined: motion + dark (both required). manual: controlled only by wall switch or dashboard.' },

    { group: 'Motion',
      key: 'pir_timeout',       label: 'OFF after no motion',     type: 'number', unit: 'sec', step: 30, default: 300,
      help: "Time in seconds after the last detected motion before the light turns OFF automatically. E.g. 300 = 5 minutes after the room is empty." },
    { group: 'Motion',
      key: 'motion_threshold',  label: 'AI presence threshold',   type: 'number', unit: '%',   step: 1,  default: 10,
      help: "Trigger level for the analog presence sensor (0–100). Motion is detected when the sensor value exceeds this threshold. Lower value = more sensitive." },

    { group: 'Lux',
      key: 'lux_threshold',     label: 'Dark below (ON)',         type: 'number', unit: 'lux', step: 10, default: 50,
      help: "The light activates when ambient lux drops below this value (it is 'dark enough'). Typical indoor threshold: 30–100 lux." },
    { group: 'Lux',
      key: 'lux_threshold_off', label: 'Bright above (OFF)',      type: 'number', unit: 'lux', step: 10, default: 60,
      help: "The light turns OFF when ambient lux rises above this value. Should be higher than 'Dark below' to create a hysteresis dead band and prevent rapid toggling." },

    { group: 'Dimmer',
      key: 'dim_on_level',      label: 'Brightness ON',           type: 'number', unit: '%', step: 5, default: 100,
      help: "Brightness level (0–100%) when the light is turned ON. 100% = full brightness. Adjust for evening ambiance." },
    { group: 'Dimmer',
      key: 'dim_off_level',     label: 'Brightness OFF',          type: 'number', unit: '%', step: 5, default: 0,
      help: "Brightness level when the light is 'off'. Use a small value like 5% for a nightlight effect instead of fully cutting power." },

    { group: 'Schedule',
      key: 'schedule_on',       label: 'ON at',                   type: 'text', default: '',
      help: 'Fixed time or sun-relative time to turn ON. Format: "HH:MM" for a fixed time (e.g. "18:30"), or "sunset-30" / "sunset+15" for minutes relative to sunset, or "sunrise+60" for minutes after sunrise.' },
    { group: 'Schedule',
      key: 'schedule_off',      label: 'OFF at',                  type: 'text', default: '',
      help: 'Fixed time or sun-relative time to turn OFF. Same format as ON at. Example: "23:00" or "sunrise" or "sunrise+30".' },

    { group: 'Switch',
      key: 'switch_toggle',     label: 'Switch mode',             type: 'select', options: ['1','0'], default: '1',
      help: '1 = Toggle mode: each button press flips the light ON→OFF or OFF→ON (use for push buttons). 0 = Follow mode: light state mirrors the switch position directly (use for standard rocker switches).' },
    { group: 'Switch',
      key: 'manual_timeout_s',  label: 'Manual override expires', type: 'number', unit: 'sec', step: 60, default: 0,
      help: 'How long a manual override from the wall switch or dashboard lasts before automatic control resumes. Set to 0 for a permanent override (manual control until next automation trigger).' },
    { group: 'Switch',
      key: 'switch_retrigger_block_s', label: 'Switch retrigger block', type: 'number', unit: 'sec', step: 0.1, default: 1,
      help: 'Ignores extra switch retriggers for this many seconds after a switch-driven stage change. Helps with bounce or very fast toggle chatter on physical inputs.' },
    { group: 'Switch',
      key: 'double_tap_level', label: 'Double-tap brightness', type: 'number', unit: '%', step: 5, default: 100,
      help: 'Brightness level set when the wall switch is tapped twice quickly (< 500ms). Only applies to dimmer output. Set to 100 for full brightness, or any level for a "boost" mode.' },

    { group: 'Lux Dimming',
      key: 'lux_dim_target',    label: 'Target lux (0=off)', type: 'number', unit: 'lux', step: 10, default: 0,
      help: 'When set > 0 and a dimmer + lux sensor are both mapped, the dimmer level adjusts automatically to maintain this lux level at the sensor. Set to 0 to disable.' },
    { group: 'Lux Dimming',
      key: 'lux_dim_max_level', label: 'Max dimmer level',   type: 'number', unit: '%',   step: 5,  default: 100,
      help: 'Maximum brightness the lux-based dimming is allowed to reach. Useful to cap energy use or protect fixtures.' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      help: 'When ON, automation decisions run normally but no real lighting commands are sent to outputs.' },
  ],
};

module.exports = { lightingHandler, LIGHTING_MODULE, setManual, clearManual, parseTime, inRange, getSun, localMinutes };
