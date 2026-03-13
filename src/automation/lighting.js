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

const lastMotionTime = new Map();
const switchState    = new Map();
const manualState    = new Map();
const sunCache       = new Map();
const switchTapTime  = new Map(); // instId → last tap ts (for double-tap)

// ── Sunrise/sunset (NOAA, no deps) ────────────────────────────────────────────
function calcSun(lat, lon) {
  const D2R = Math.PI / 180;
  const n   = Date.now() / 86400000 - 10957; // days since J2000
  const L   = (280.460 + 0.9856474 * n) % 360;
  const g   = (357.528 + 0.9856003 * n) % 360;
  const lam = L + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R);
  const eps = 23.439 - 0.0000004 * n;
  const sinDec = Math.sin(eps * D2R) * Math.sin(lam * D2R);
  const dec    = Math.asin(sinDec) * (180 / Math.PI);
  const cosH   = (Math.cos(90.833 * D2R) - Math.sin(lat * D2R) * Math.sin(dec * D2R))
                 / (Math.cos(lat * D2R) * Math.cos(dec * D2R));
  if (cosH > 1)  return { sunrise: null, sunset: null };
  if (cosH < -1) return { sunrise: 0,    sunset: 1440  };
  const H   = Math.acos(cosH) * (180 / Math.PI);
  const RA  = (Math.atan2(Math.cos(eps*D2R)*Math.sin(lam*D2R), Math.cos(lam*D2R)) * (180/Math.PI) / 15 + 24) % 24;
  const eot = (L / 15 - RA + 24) % 24;
  const noon = 12 - eot - lon / 15;
  return { sunrise: Math.round((noon - H/15)*60), sunset: Math.round((noon + H/15)*60) };
}

function getSun(lat, lon) {
  if (!lat || !lon) return null;
  const key = new Date().toISOString().slice(0,10) + '_' + lat + '_' + lon;
  if (!sunCache.has(key)) {
    sunCache.set(key, calcSun(Number(lat), Number(lon)));
    if (sunCache.size > 10) sunCache.delete(sunCache.keys().next().value);
  }
  return sunCache.get(key);
}

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

function setOut(send, ctx, hasDimmer, on, dimOn, dimOff, reason) {
  if (hasDimmer) {
    send('dimmer_output', on ? dimOn : dimOff, reason);
  } else {
    for (let i = 1; i <= 4; i++) {
      const key = i === 1 ? 'light_relay' : `light_relay_${i}`;
      if (ctx.io(key)) send(key, on ? 'ON' : 'OFF', reason);
    }
  }
}

function broadcastLightingState(ctx, extra) {
  try {
    const dimOffLevel = Number(ctx.setting('dim_off_level', 0));
    const dimVal = ctx.value('dimmer_output');
    const relayOn = ctx.isOn('light_relay');
    const on = dimVal != null ? Number(dimVal) > (dimOffLevel + 5) : relayOn;
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

// ── Main handler ──────────────────────────────────────────────────────────────
function lightingHandler(ctx, send, siteInfo) {
  const instId = ctx.instance.id;
  const now    = Date.now();
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();

  const mode            = ctx.settingStr('mode',            'auto');
  const luxThreshold    = ctx.setting('lux_threshold',       50);
  const pirTimeout      = ctx.setting('pir_timeout',         300) * 1000;
  const motionThreshold = ctx.setting('motion_threshold',    10);
  const dimOnLevel      = ctx.setting('dim_on_level',        100);
  const dimOffLevel     = ctx.setting('dim_off_level',       0);
  const schedOnStr      = ctx.settingStr('schedule_on',      '');
  const schedOffStr     = ctx.settingStr('schedule_off',     '');
  const switchToggle    = ctx.setting('switch_toggle',       1) >= 1;
  const manualExpiry    = ctx.setting('manual_timeout_s',    0) * 1000;

  const luxDimTarget    = ctx.setting('lux_dim_target',    0);   // 0 = disabled
  const luxDimMaxLevel  = ctx.setting('lux_dim_max_level', 100); // cap brightness

  const hasDimmer  = !!ctx.io('dimmer_output');
  const hasSwitch  = !!ctx.io('switch_di');
  const hasPIR     = !!ctx.io('pir_sensor');
  const hasMotionAI= !!ctx.io('motion_ai');
  const hasLux     = !!ctx.io('lux_sensor');

  const isOn = hasDimmer
    ? (ctx.value('dimmer_output') ?? 0) > (dimOffLevel + 5)
    : ctx.isOn('light_relay');

  // ── Wall switch (DI) ────────────────────────────────────────────────
  if (hasSwitch) {
    const sw    = ctx.state('switch_di');
    const prevSw= switchState.get(instId);
    switchState.set(instId, sw);
    const swOn  = sw==='ON'||sw==='1'||sw==='true';
    const prevOn= prevSw==='ON'||prevSw==='1'||prevSw==='true';
    if (swOn && !prevOn) { // rising edge
      const lastTap = switchTapTime.get(instId) || 0;
      const dt = now - lastTap;
      switchTapTime.set(instId, now);
      if (dt > 50 && dt < 500) { // double-tap detected
        const doubleTapLevel = ctx.setting('double_tap_level', 100);
        if (hasDimmer) {
          send('dimmer_output', doubleTapLevel, 'Double-tap: full brightness');
        } else {
          for (let i = 1; i <= 4; i++) {
            const key = i === 1 ? 'light_relay' : `light_relay_${i}`;
            if (ctx.io(key)) send(key, 'ON', 'Double-tap: ON');
          }
        }
        manualState.set(instId, { on: true, ts: now });
      } else {
        if (switchToggle) {
          manualState.set(instId, { on: !isOn, ts: now });
        } else {
          manualState.set(instId, { on: swOn, ts: now });
        }
      }
    } else if (!switchToggle) {
      manualState.set(instId, { on: swOn, ts: now });
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

  if (motion) lastMotionTime.set(instId, now);

  // ── Manual override (dashboard or switch) ───────────────────────────
  const manual = manualState.get(instId);
  if (manual) {
    const expired = manualExpiry > 0 && (now - manual.ts) > manualExpiry;
    if (!expired) {
      const r = manual.on ? 'Manual ON' : 'Manual OFF';
      setOut(send, ctx, hasDimmer, manual.on, dimOnLevel, dimOffLevel, r);
      broadcastLightingState(ctx, { manual_active: true, source: 'manual', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: r });
      return;
    }
    manualState.delete(instId);
  }

  if (mode === 'manual') {
    broadcastLightingState(ctx, { manual_active: true, source: 'manual_mode', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: 'Manual mode' });
    return;
  }

  // ── SCHEDULE mode ───────────────────────────────────────────────────
  if (mode === 'schedule') {
    if (inSched  && !isOn) setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Schedule ON (${schedOnStr || schedOn})`);
    if (!inSched && isOn)  setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Schedule OFF (${schedOffStr || schedOff})`);
    broadcastLightingState(ctx, { source: 'schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? `In schedule window` : `Outside schedule` });
    return;
  }

  // ── LUX mode ────────────────────────────────────────────────────────
  if (mode === 'lux') {
    if (!hasLux) { broadcastLightingState(ctx, { source: 'lux', schedule_active: inSched, motion_active: !!motion, dark: null, last_reason: 'Lux sensor not mapped' }); return; }
    if (!isOn && isDark)                   setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Dark: lux=${lux} < ${luxThreshold}`);
    else if (isOn && lux >= luxThreshold*1.15) setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Bright: lux=${lux?.toFixed(0)}`);
    broadcastLightingState(ctx, { source: 'lux', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: isDark ? `Dark: lux=${lux}` : `Bright: lux=${lux}` });
    return;
  }

  // ── PIR mode ────────────────────────────────────────────────────────
  if (mode === 'pir') {
    if (motion && !isOn)
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, motionVal!=null ? `Motion AI=${motionVal}` : 'Motion');
    else if (isOn && !motion && timeSince > pirTimeout) {
      lastMotionTime.delete(instId);
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `No motion ${Math.round(timeSince/1000)}s`);
    }
    broadcastLightingState(ctx, { source: 'pir', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: motion ? (motionVal!=null ? `Motion AI=${motionVal}` : 'Motion') : `No motion` });
    return;
  }

  // ── COMBINED mode: PIR only when dark ───────────────────────────────
  if (mode === 'combined') {
    if (motion && isDark && !isOn)
      setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, `Motion+dark lux=${lux??'?'}`);
    else if (isOn && (!motion||!isDark) && timeSince > pirTimeout) {
      lastMotionTime.delete(instId);
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Timeout/bright`);
    }
    broadcastLightingState(ctx, { source: 'combined', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: motion && isDark ? `Motion + dark` : (!isDark ? 'Bright enough' : 'No motion') });
    return;
  }

  // ── AUTO mode: all sources, priority stack ──────────────────────────
  if (mode === 'auto') {
    // Hard schedule OFF
    if (schedOn!=null && schedOff!=null && !inSched) {
      if (isOn) setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Outside schedule`);
      broadcastLightingState(ctx, { source: 'schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? `Schedule ON (${schedOnStr || schedOn})` : 'Outside schedule' });
      return;
    }
    // Bright override → always off
    if (hasLux && lux != null && lux >= luxThreshold * 1.15 && isOn) {
      setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Auto: bright lux=${lux?.toFixed(0)}`);
      broadcastLightingState(ctx, { source: 'auto_lux', schedule_active: inSched, motion_active: !!motion, dark: false, last_reason: `Auto: bright lux=${lux?.toFixed(0)}` });
      return;
    }
    // Motion (when dark enough or no lux sensor)
    if (hasPIR || hasMotionAI) {
      if (motion && isDark && !isOn)
        setOut(send, ctx, hasDimmer, true, dimOnLevel, dimOffLevel, motionVal!=null ? `Auto: motion AI=${motionVal}` : 'Auto: motion');
      else if (isOn && !motion && timeSince > pirTimeout) {
        lastMotionTime.delete(instId);
        setOut(send, ctx, hasDimmer, false, dimOnLevel, dimOffLevel, `Auto: no motion ${Math.round(timeSince/1000)}s`);
      }
      broadcastLightingState(ctx, { source: 'auto_motion', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: motion && isDark ? (motionVal!=null ? `Auto: motion AI=${motionVal}` : 'Auto: motion') : (isDark ? 'Auto: no motion' : 'Bright enough') });
      return;
    }
    // Lux-only (no motion sensor)
    if (hasLux) {
      if (!isOn && isDark)  setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Auto: dark lux=${lux}`);
      broadcastLightingState(ctx, { source: 'auto_lux_only', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: isDark ? `Auto: dark lux=${lux}` : `Auto: bright lux=${lux}` });
      return;
    }
    // Schedule only
    if (inSched && !isOn) setOut(send, ctx, hasDimmer, true,  dimOnLevel, dimOffLevel, `Auto: schedule`);
    broadcastLightingState(ctx, { source: 'auto_schedule', schedule_active: inSched, motion_active: !!motion, dark: !!isDark, last_reason: inSched ? 'Auto: schedule window' : 'Auto idle' });
  }

  // Lux-based dimming: maintain target lux by adjusting dimmer level
  if (hasDimmer && hasLux && luxDimTarget > 0 && lux != null) {
    const curLevel = ctx.value('dimmer_output') ?? dimOnLevel;
    const error = lux - luxDimTarget;
    const step  = Math.round(error / 15); // 15 lux per 1% step
    const newLevel = Math.max(5, Math.min(luxDimMaxLevel, curLevel - step));
    if (Math.abs(newLevel - curLevel) >= 2) {
      send('dimmer_output', newLevel, `Lux dim: lux=${lux?.toFixed(0)} target=${luxDimTarget} → ${newLevel}%`);
    }
  }
}

// ── Set manual state (called from dashboard) ──────────────────────────────────
function setManual(instId, on) {
  manualState.set(instId, { on, ts: Date.now() });
}

// ── Module definition ──────────────────────────────────────────────────────────
const LIGHTING_MODULE = {
  id:          'lighting',
  name:        'Lighting Control',
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
      key: 'lux_threshold',     label: 'Dark below',              type: 'number', unit: 'lux', step: 10, default: 50,
      help: "The light activates when ambient lux drops below this value (it is 'dark enough'). Typical indoor threshold: 30–100 lux." },

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

module.exports = { lightingHandler, LIGHTING_MODULE, setManual };
