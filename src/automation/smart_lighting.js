// src/automation/smart_lighting.js
// ✨ Smart Lighting — scenario-based, user-friendly
//
// Instead of IF/THEN rules, the user defines "scenarios" (moods):
//   Βραδινό, Κινηματογράφος, Αφύπνιση, Παρουσία, Κόμμα, etc.
//
// Each scenario has:
//   name         — display name
//   icon         — emoji
//   enabled      — bool
//   outputs      — [{ io_id, level: 0-100 }]  (relay=100/0, dimmer=0-100)
//   fade_s       — fade transition seconds (0 = instant)
//   trigger      — manual | time | pir | switch | sunset | sunrise | scene
//   trigger_time — HH:MM (for time trigger)
//   trigger_sun  — "sunset" | "sunrise" with optional offset "sunset-30"
//   off_after    — minutes until auto-off (0 = stay on)
//   priority     — higher wins when multiple scenarios active
//
// Inputs (all optional — map as many as needed):
//   output_1..10   — relay or dimmer outputs
//   pir_sensor     — PIR motion DI
//   switch_di      — wall switch DI
//   lux_sensor     — ambient lux AI
//
// Active scenario stored in memory — dashboard can override.

const { localMinutes, dayKey, oncePerMinute } = require('./time_utils');

const activeScenario  = new Map(); // instId → { id, name, ts, reason, manual }
const offTimers       = new Map(); // instId → timeoutId
const switchPrev      = new Map(); // instId → DI state
const sunCache        = new Map();
const fadeTimers      = new Map(); // instId_ioId → intervalId
const panicState      = new Map(); // instId → { active, blinkTimer }
const luxHistory      = new Map(); // instId → last lux for adaptive dimming

const triggerHistory  = new Map(); // instId -> { scenarioId: lastTriggerKey }

function siteNowParts(siteInfo) {
  try {
    const tz = siteInfo?.timezone || null;
    if (!tz) {
      const d = new Date();
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes()
      };
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
    }).formatToParts(new Date());
    const obj = {};
    for (const p of parts) if (p.type !== 'literal') obj[p.type] = p.value;
    return {
      year: Number(obj.year), month: Number(obj.month), day: Number(obj.day),
      hour: Number(obj.hour), minute: Number(obj.minute)
    };
  } catch (e) {
    const d = new Date();
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes()
    };
  }
}
function nowMin(siteInfo) {
  const p = siteNowParts(siteInfo);
  return p.hour * 60 + p.minute;
}
function siteDayKey(siteInfo) {
  const p = siteNowParts(siteInfo);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
function parseClockValue(str, fallback = null) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return hh * 60 + mm;
}
function shouldFireTrigger(instId, scenarioId, key) {
  const mem = triggerHistory.get(instId) || {};
  if (mem[scenarioId] === key) return false;
  mem[scenarioId] = key;
  triggerHistory.set(instId, mem);
  return true;
}
function clearFadeTimers(instId) {
  for (const [k, v] of [...fadeTimers.entries()]) {
    if (String(k).startsWith(String(instId) + '_')) {
      clearInterval(v);
      fadeTimers.delete(k);
    }
  }
}
function clearPanic(instId) {
  const cur = panicState.get(instId);
  if (cur?.blinkTimer) clearInterval(cur.blinkTimer);
  panicState.delete(instId);
}

function getSun(lat, lon) {
  if (!lat || !lon) return null;
  const key = dayKey() + '_' + lat + '_' + lon;
  if (!sunCache.has(key)) {
    const D2R = Math.PI/180;
    const n   = Date.now()/86400000 - 10957;
    const L   = (280.460 + 0.9856474*n)%360;
    const g   = (357.528 + 0.9856003*n)%360;
    const lam = L + 1.915*Math.sin(g*D2R) + 0.020*Math.sin(2*g*D2R);
    const eps = 23.439 - 0.0000004*n;
    const sinDec = Math.sin(eps*D2R)*Math.sin(lam*D2R);
    const dec  = Math.asin(sinDec)*(180/Math.PI);
    const cosH = (Math.cos(90.833*D2R)-Math.sin(lat*D2R)*Math.sin(dec*D2R))/(Math.cos(lat*D2R)*Math.cos(dec*D2R));
    if (cosH > 1)  { sunCache.set(key, { sunrise: null, sunset: null }); }
    else if (cosH < -1) { sunCache.set(key, { sunrise: 0, sunset: 1440 }); }
    else {
      const H    = Math.acos(cosH)*(180/Math.PI);
      const RA   = (Math.atan2(Math.cos(eps*D2R)*Math.sin(lam*D2R),Math.cos(lam*D2R))*(180/Math.PI)/15+24)%24;
      const eot  = (L/15-RA+24)%24;
      const noon = 12-eot-lon/15;
      sunCache.set(key, { sunrise: Math.round((noon-H/15)*60), sunset: Math.round((noon+H/15)*60) });
    }
    if (sunCache.size > 10) sunCache.delete(sunCache.keys().next().value);
  }
  return sunCache.get(key);
}

function parseSunTime(str, sun) {
  if (!str || !sun) return null;
  str = str.trim();
  const base = str.startsWith('sunset') ? sun.sunset : str.startsWith('sunrise') ? sun.sunrise : null;
  if (base == null) return null;
  const m = str.match(/([+-]\d+)/);
  return base + (m ? parseInt(m[1]) : 0);
}

function sendOutput(send, ctx, ioKey, level, reason) {
  // level: 0-100 for dimmers, 0/100 for relays
  if (!ctx.io(ioKey)) return;
  const io = ctx.io(ioKey);
  if (!io) return;
  // Determine if relay or analog
  const isAnalog = io.type === 'analog' || io.type === 'ao' || io.type === 'dimmer';
  if (isAnalog) {
    send(ioKey, Math.round(level), reason);
  } else {
    send(ioKey, level > 0 ? 'ON' : 'OFF', reason);
  }
}

function activateScenario(instId, scenario, ctx, send, reason) {
  if (!scenario) return;
  clearFadeTimers(instId);
  const entry = { id: scenario.id, name: scenario.name, ts: Date.now(), reason: reason || null, manual: /switch|manual/i.test(String(reason||'')) };
  activeScenario.set(instId, entry);
  ctx.setSetting('_active_scenario', JSON.stringify(entry));

  // Send outputs with optional fade transition
  const outputs = scenario.outputs || [];
  const fadeMs  = Math.max(0, Number(scenario.fade_s || 0)) * 1000;
  clearFadeTimers(instId);

  for (const out of outputs) {
    const ioKey = out.io_key;
    if (!ioKey) continue;
    const targetLevel = Number(out.level ?? 100);
    const io = ctx.io(ioKey);
    const isAnalog = io && (io.type === 'analog' || io.type === 'ao' || io.type === 'dimmer' ||
                            String(io.type||'').toLowerCase().includes('analog') ||
                            String(io.type||'').toLowerCase().includes('dimmer'));

    if (fadeMs > 0 && isAnalog) {
      const startLevel = Number(ctx.value(ioKey) ?? 0);
      if (Math.abs(targetLevel - startLevel) < 2) {
        sendOutput(send, ctx, ioKey, targetLevel, reason || 'Scene: ' + scenario.name);
        continue;
      }
      const steps  = Math.max(5, Math.round(fadeMs / 100)); // ~10 steps/sec
      const stepMs = fadeMs / steps;
      let step = 0;
      const timerKey = `${instId}_${ioKey}`;
      const timer = setInterval(() => {
        step++;
        const level = Math.round(startLevel + (targetLevel - startLevel) * (step / steps));
        send(ioKey, level, `Fade: ${scenario.name}`);
        if (step >= steps) {
          clearInterval(timer);
          fadeTimers.delete(timerKey);
        }
      }, stepMs);
      fadeTimers.set(timerKey, timer);
    } else {
      sendOutput(send, ctx, ioKey, targetLevel, reason || 'Scene: ' + scenario.name);
    }
  }

  // Auto-off timer
  clearOffTimer(instId);
  if (scenario.off_after > 0) {
    const t = setTimeout(() => {
      activeScenario.delete(instId);
      offTimers.delete(instId);
      ctx.setSetting('_active_scenario', '');
      for (const out of outputs) {
        const ioKey = out.io_key || ('output_' + out.slot);
        sendOutput(send, ctx, ioKey, 0, `Auto-off: ${scenario.name}`);
      }
      ctx.broadcastState?.({
        status: 'idle',
        active_scene: null,
        active_scene_name: null,
        manual_override: false,
        motion_active: false,
        schedule_active: false,
        lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
        last_reason: `Auto-off: ${scenario.name}`
      });
    }, scenario.off_after * 60000);
    offTimers.set(instId, t);
  }

  ctx.broadcastState?.({
    status: 'active',
    active_scene: scenario.id,
    active_scene_name: scenario.name || scenario.id,
    manual_override: /switch|manual/i.test(String(reason||'')),
    motion_active: false,
    schedule_active: /Time|Sun/i.test(String(reason||'')),
    lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
    last_reason: reason || null
  });
}

function clearOffTimer(instId) {
  const t = offTimers.get(instId);
  if (t) clearTimeout(t);
  offTimers.delete(instId);
}

function smartLightingHandler(ctx, send, siteInfo) {
  const instId    = ctx.instance.id;
  const now       = Date.now();
  const nowM      = localMinutes(siteInfo);
  const sun       = siteInfo ? getSun(Number(siteInfo.lat), Number(siteInfo.lon)) : null;

  const isTestMode = ctx.settingStr('test_mode', '0') === '1';
  if (isTestMode) {
    send = (key, value, reason) => {
      console.log(`[SMART_LIGHTING TEST MODE] would send: ${key} = ${value}${reason ? ' // ' + reason : ''}`);
    };
  }

  // Restore active scenario from DB on first run after restart
  if (!activeScenario.has(instId)) {
    const saved = ctx.settingStr('_active_scenario', '');
    if (saved) {
      try { activeScenario.set(instId, JSON.parse(saved)); } catch {}
    }
  }

  // ── Panic Mode check (di_panic or any DI tagged as panic) ─────────
  const panicEnable = ctx.settingStr('panic_enable', '0') === '1';
  // Restore panic state from DB on first run after restart
  if (panicEnable && !panicState.has(instId)) {
    const savedPanic = ctx.settingStr('_panic', '0') === '1';
    if (savedPanic) {
      panicState.set(instId, { active: true });
      const allOutputs = (ctx.mappings||[]).filter(m => m.input_key.startsWith('do_') || m.input_key.startsWith('ao_'));
      allOutputs.forEach(m => sendOutput(send, ctx, m.input_key, 100, 'PANIC MODE (restored)'));
    }
  }
  if (panicEnable) {
    // Check for a di_ input tagged as panic trigger
    const panicSrc = ctx.settingStr('panic_input', '');
    if (panicSrc) {
      const panicVal = ctx.state(panicSrc);
      const panicOn  = panicVal === 'ON' || panicVal === '1';
      const cur = panicState.get(instId);
      if (panicOn && !cur?.active) {
        // PANIC: all outputs to 100% + start blink
        panicState.set(instId, { active: true });
        ctx.setSetting('_panic', '1');
        let blinkOn = true;
        const allOutputs = (ctx.mappings||[]).filter(m => m.input_key.startsWith('do_') || m.input_key.startsWith('ao_'));
        const timer = setInterval(() => {
          allOutputs.forEach(m => {
            const level = blinkOn ? 100 : 0;
            sendOutput(send, ctx, m.input_key, level, 'PANIC MODE');
          });
          blinkOn = !blinkOn;
        }, 500);
        panicState.set(instId, { active: true, blinkTimer: timer });
        console.log(`[SMART_LIGHTING] PANIC MODE activated on instance ${instId}`);
        return;
      } else if (!panicOn && cur?.active) {
        clearPanic(instId);
        ctx.setSetting('_panic', '0');
        console.log(`[SMART_LIGHTING] PANIC MODE cleared on instance ${instId}`);
      } else if (cur?.active) {
        ctx.broadcastState?.({
          status: 'panic',
          active_scene: activeScenario.get(instId)?.id || null,
          active_scene_name: activeScenario.get(instId)?.name || null,
          manual_override: false,
          motion_active: false,
          schedule_active: false,
          lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
          last_reason: 'PANIC MODE'
        });
        return; // panic active, handler already running via interval
      }
    }
  }

  const scenariosJson = ctx.settingStr('scenarios', '[]');
  let scenarios;
  try { scenarios = JSON.parse(scenariosJson); } catch (e) {
    console.warn('[SMART_LIGHTING] Invalid scenarios JSON:', e.message, '| raw:', String(scenariosJson).slice(0, 100));
    return;
  }
  if (!Array.isArray(scenarios)) return;

  const enabled = scenarios.filter(s => s.enabled !== false);
  if (!enabled.length) return;

  // ── PIR trigger ────────────────────────────────────────────────────────
  if (ctx.io('pir_sensor')) {
    const pir = ctx.state('pir_sensor');
    const pirOn = pir === 'ON' || pir === '1' || pir === 'true';
    const pirScenarios = enabled.filter(s => s.trigger === 'pir');
    if (pirOn && pirScenarios.length) {
      const best = pirScenarios.sort((a,b)=>(b.priority||0)-(a.priority||0))[0];
      const cur  = activeScenario.get(instId);
      if (!cur || cur.id !== best.id) {
        activateScenario(instId, best, ctx, send, 'PIR motion');
      } else if (cur) {
        // Extend auto-off timer on continued motion
        clearOffTimer(instId);
        if (best.off_after > 0) {
          const t = setTimeout(() => {
            activeScenario.delete(instId);
            (best.outputs||[]).forEach(out => sendOutput(send, ctx, out.io_key||('output_'+out.slot), 0, `Auto-off: ${best.name}`));
          }, best.off_after * 60000);
          offTimers.set(instId, t);
        }
      }
      return;
    }
  }

  // ── Wall switch DI toggle ──────────────────────────────────────────────
  if (ctx.io('switch_di')) {
    const sw    = ctx.state('switch_di');
    const swOn  = sw === 'ON' || sw === '1' || sw === 'true';
    const prevOn= switchPrev.get(instId) === true;
    switchPrev.set(instId, swOn);

    if (swOn && !prevOn) { // rising edge → cycle through switch-triggered scenarios
      const swScenarios = enabled.filter(s => s.trigger === 'switch');
      if (swScenarios.length) {
        const cur   = activeScenario.get(instId);
        const curIdx= swScenarios.findIndex(s => s.id === cur?.id);
        // curIdx is -1 when no scenario active, so (curIdx+1) % length starts at 0 (first scenario).
        // When curIdx is the last index, (curIdx+1) % length == 0 which wraps back — we use
        // length itself as the "OFF" slot: if the computed index equals length, go to OFF.
        const nextIdx = (curIdx + 1) % (swScenarios.length + 1);
        const next  = swScenarios[nextIdx]; // undefined when nextIdx === swScenarios.length → OFF cycle
        if (!next) {
          // Cycle to OFF
          activeScenario.delete(instId);
          clearOffTimer(instId);
          ctx.setSetting('_active_scenario', '');
          enabled.forEach(s => (s.outputs||[]).forEach(out =>
            sendOutput(send, ctx, out.io_key||('output_'+out.slot), 0, 'Switch: OFF')));
          ctx.broadcastState?.({
            status: 'idle',
            active_scene: null,
            active_scene_name: null,
            manual_override: true,
            motion_active: false,
            schedule_active: false,
            lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
            last_reason: 'Switch: OFF'
          });
        } else {
          activateScenario(instId, next, ctx, send, 'Wall switch');
        }
        return;
      }
    }
  }

  // ── Time / Sun triggers ───────────────────────────────────────────────
  for (const s of enabled) {
    if (s.trigger === 'time' && s.trigger_time) {
      const [h,m] = s.trigger_time.split(':').map(Number);
      const target = h*60+m;
      if (oncePerMinute(instId, `smart_time_${s.id}`, target, siteInfo, 2)) {
        const cur = activeScenario.get(instId);
        if (!cur || cur.id !== s.id) activateScenario(instId, s, ctx, send, `Time ${s.trigger_time}`);
      }
    }
    if (s.trigger === 'sunset' || s.trigger === 'sunrise') {
      const target = parseSunTime(s.trigger_sun || s.trigger, sun);
      if (target !== null && oncePerMinute(instId, `smart_sun_${s.id}`, target, siteInfo, 2)) {
        const cur = activeScenario.get(instId);
        if (!cur || cur.id !== s.id) activateScenario(instId, s, ctx, send, `Sun: ${s.trigger_sun || s.trigger}`);
      }
    }
  }

  // ── Lux trigger ────────────────────────────────────────────────────────
  const luxVal = ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null;
  if (luxVal !== null) {
    const luxScenarios = enabled.filter(s => s.trigger === 'lux' && s.trigger_lux_max != null);
    for (const s of luxScenarios.sort((a,b)=>(b.priority||0)-(a.priority||0))) {
      const threshold = Number(s.trigger_lux_max);
      const isDark = luxVal < threshold;
      const cur = activeScenario.get(instId);
      if (isDark && (!cur || cur.id !== s.id)) {
        activateScenario(instId, s, ctx, send, `Lux trigger: ${luxVal.toFixed(0)} < ${threshold}`);
        break;
      } else if (!isDark && cur?.id === s.id) {
        // Lux rose above threshold — deactivate this scenario
        activeScenario.delete(instId);
        ctx.setSetting('_active_scenario', '');
        clearOffTimer(instId);
        (s.outputs||[]).forEach(out => sendOutput(send, ctx, out.io_key || ('output_'+out.slot), 0, `Lux bright: ${luxVal.toFixed(0)}`));
        ctx.broadcastState?.({ status:'idle', active_scene:null, active_scene_name:null, manual_override:false, last_reason:`Lux bright: ${luxVal.toFixed(0)}` });
        break;
      }
    }
  }

  // ── Adaptive Dimming ─────────────────────────────────────────────
  const activeSc = activeScenario.get(instId);
  if (activeSc) {
    const sc = enabled.find(s => s.id === activeSc.id);
    if (sc) applyAdaptiveDimming(instId, sc, ctx, send);
    ctx.broadcastState?.({
      status: 'active',
      active_scene: activeSc.id,
      active_scene_name: activeSc.name || activeSc.id,
      manual_override: !!activeSc.manual,
      motion_active: !!(ctx.io('pir_sensor') && ['ON','1','true'].includes(String(ctx.state('pir_sensor')))),
      schedule_active: /Time|Sun/i.test(String(activeSc.reason || '')),
      lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
      last_reason: activeSc.reason || null
    });
  } else {
    ctx.broadcastState?.({
      status: 'idle',
      active_scene: null,
      active_scene_name: null,
      manual_override: false,
      motion_active: !!(ctx.io('pir_sensor') && ['ON','1','true'].includes(String(ctx.state('pir_sensor')))),
      schedule_active: false,
      lux_value: ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null,
      last_reason: 'No active scenario'
    });
  }
}

// ── Adaptive Dimming helper ────────────────────────────────────────────────
// Called at end of handler if active scenario has adaptive_dimming=true
function applyAdaptiveDimming(instId, scenario, ctx, send) {
  if (!scenario?.adaptive_dimming) return;
  const luxTarget  = Number(scenario.lux_target  || 400);  // lux target
  const luxSensor  = ctx.value('ai_1') || ctx.value('lux_sensor'); // first AI input
  if (luxSensor === null) return;

  const prevLux = luxHistory.get(instId);
  luxHistory.set(instId, luxSensor);
  if (prevLux !== undefined && Math.abs(luxSensor - prevLux) < 20) return; // no significant change

  // Find first AO output in the scenario
  for (const out of (scenario.outputs||[])) {
    if (!out.io_key?.startsWith('ao_')) continue;
    const curLevel = Number(out.level ?? 100);
    // Simple proportional: if lux > target, dim down; if lux < target, dim up
    const error = luxSensor - luxTarget;
    const delta  = Math.round(error / 20); // 20 lux per % step
    const newLevel = Math.max(0, Math.min(100, curLevel - delta));
    if (Math.abs(newLevel - curLevel) >= 2) {
      sendOutput(send, ctx, out.io_key, newLevel, `Adaptive dimming: lux=${luxSensor}, target=${luxTarget}`);
      out.level = newLevel; // update in memory
    }
    break; // only first AO
  }
}

const SMART_LIGHTING_MODULE = {
  id:          'smart_lighting',
  name:        'Smart Lighting',
  icon:        '✨',
  description: 'Scenario-based lighting: define moods (Evening, Cinema, Reading…) with triggers (PIR, switch, time, sunset) and dimmer levels.',
  color:       '#f0c040',
  category:    'smart',

  // Dynamic inputs — user adds as many as needed (max 20)
  dynamic: true,
  max_inputs: 20,
  input_templates: [
    { prefix: 'do',  label: 'Relay Output (DO)',      type: 'relay',   group: 'outputs' },
    { prefix: 'ao',  label: 'Dimmer Output (AO 0-100%)', type: 'analog', group: 'outputs' },
    { prefix: 'di',  label: 'Digital Input (DI)',     type: 'sensor',  group: 'inputs'  },
    { prefix: 'ai',  label: 'Analog Input (AI)',      type: 'sensor',  group: 'inputs'  },
  ],
  inputs: [], // populated dynamically by user

  setpoints: [
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      description: 'When ON, scenarios and triggers still evaluate normally but no real smart-lighting output commands are sent.' },
  ], // Scenarios stored as JSON in module_settings key "scenarios"
};

module.exports = { smartLightingHandler, SMART_LIGHTING_MODULE, activeScenario };
