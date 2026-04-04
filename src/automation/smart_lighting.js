// src/automation/smart_lighting.js
// Smart Lighting v2 — Scenarios + Adaptive Brightness + Follow-Me + Sunrise/Sleep

const { localMinutes, dayKey, oncePerMinute } = require('./time_utils');
const { getSun, parseSunTime, sunCache } = require('./helpers/sun');

const activeScenario  = new Map();
const offTimers       = new Map();
const switchPrev      = new Map();
const switchDebounce  = new Map();
const followTimers    = new Map();
const adaptiveState   = new Map();
const triggerHistory  = new Map();

// ── Time helpers ────────────────────────────────────────────────────────────
function siteNowParts(siteInfo) {
  try {
    const tz = siteInfo?.timezone || null;
    if (!tz) { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth()+1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }; }
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date());
    const obj = {};
    for (const p of parts) if (p.type !== 'literal') obj[p.type] = p.value;
    return { year: Number(obj.year), month: Number(obj.month), day: Number(obj.day), hour: Number(obj.hour), minute: Number(obj.minute) };
  } catch { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth()+1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }; }
}
function nowMin(siteInfo) { const p = siteNowParts(siteInfo); return p.hour * 60 + p.minute; }
function siteDayKey(siteInfo) { const p = siteNowParts(siteInfo); return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`; }
function parseClockValue(str) { const m = String(str||'').match(/^(\d{1,2}):(\d{2})$/); return m ? Math.max(0,Math.min(23,Number(m[1])))*60+Math.max(0,Math.min(59,Number(m[2]))) : null; }

// ── Core: activate scenario ─────────────────────────────────────────────────
function activateScenario(instId, scenario, ctx, send, reason) {
  if (!scenario) return;
  const entry = { id: scenario.id, name: scenario.name, ts: Date.now(), reason: reason||null, manual: /switch|manual/i.test(String(reason||'')) };
  activeScenario.set(instId, entry);
  ctx.setSetting('_active_scenario', JSON.stringify(entry));

  const outputs = scenario.outputs || [];
  for (const out of outputs) {
    if (!out.io_key) continue;
    const targetLevel = Number(out.level ?? 100);
    const io = ctx.io(out.io_key);
    const isAnalog = io && (io.type==='analog'||io.type==='ao'||io.type==='dimmer'||String(io.type||'').toLowerCase().includes('analog')||String(io.type||'').toLowerCase().includes('dimmer'));
    sendOutput(send, ctx, out.io_key, isAnalog ? targetLevel : (targetLevel >= 50 ? 'ON' : 'OFF'), reason || 'Scene: '+scenario.name);
  }

  clearOffTimer(instId);
  if (scenario.off_after > 0) {
    const t = setTimeout(() => {
      activeScenario.delete(instId); offTimers.delete(instId);
      ctx.setSetting('_active_scenario', '');
      (scenario.outputs||[]).forEach(out => sendOutput(send, ctx, out.io_key, 0, `Auto-off: ${scenario.name}`));
      ctx.broadcastState?.({ status:'idle', active_scene:null, active_scene_name:null, manual_override:false, motion_active:false, schedule_active:false, lux_value: ctx.value('ai_1')??ctx.value('lux_sensor')??null, last_reason:`Auto-off: ${scenario.name}` });
    }, scenario.off_after * 60000);
    offTimers.set(instId, t);
  }

  ctx.broadcastState?.({ status:'active', active_scene:scenario.id, active_scene_name:scenario.name||scenario.id, manual_override:/switch|manual/i.test(String(reason||'')), motion_active:false, schedule_active:/Time|Sun/i.test(String(reason||'')), lux_value: ctx.value('ai_1')??ctx.value('lux_sensor')??null, last_reason: reason||null });
}

function clearOffTimer(instId) { const t = offTimers.get(instId); if(t) clearTimeout(t); offTimers.delete(instId); }
function sendOutput(send, ctx, ioKey, value, reason) { const io = ctx.io(ioKey); if (!io) return; if (io.type==='sensor') return; send(ioKey, value, reason||''); }

// ── FEATURE 1: Adaptive Brightness ──────────────────────────────────────────
function evaluateAdaptiveBrightness(instId, ctx, send, settings) {
  if (String(settings.adaptive_brightness||'0') !== '1') return;
  const luxVals = (ctx.mappings||[]).filter(m=>m.input_key.startsWith('ai_')).map(m => { const v = parseFloat(ctx.state(m.input_key)); return isNaN(v)?null:{key:m.input_key,value:v}; }).filter(Boolean);
  if (!luxVals.length) return;
  const luxVal = luxVals[0].value;
  const darkT = Number(settings.adaptive_lux_dark||50);
  const medT  = Number(settings.adaptive_lux_medium||200);
  const darkL = Number(settings.adaptive_dark_level||100);
  const medL  = Number(settings.adaptive_medium_level||60);
  const brightL = Number(settings.adaptive_bright_level||0);

  let targetLevel;
  if (luxVal < darkT) targetLevel = darkL;
  else if (luxVal < medT) { const ratio = (luxVal-darkT)/(medT-darkT); targetLevel = Math.round(darkL+(medL-darkL)*ratio); }
  else targetLevel = brightL;

  const prev = adaptiveState.get(instId);
  if (prev && Math.abs(prev.lastLevel-targetLevel) < 5) return;

  (ctx.mappings||[]).filter(m=>m.input_key.startsWith('ao_')).forEach(m => {
    const io = ctx.io(m.input_key);
    if (io && (io.type==='analog'||io.type==='ao'||io.type==='dimmer'))
      sendOutput(send, ctx, m.input_key, targetLevel, `Adaptive: ${luxVal.toFixed(0)} lux`);
  });
  adaptiveState.set(instId, { lastLux: luxVal, lastLevel: targetLevel });
}

// ── FEATURE 2: Follow-Me Lighting ───────────────────────────────────────────
function evaluateFollowMe(instId, ctx, send, settings) {
  if (String(settings.follow_me||'0') !== '1') return;
  const timeout = Number(settings.follow_me_timeout||120) * 1000;
  const diMappings = (ctx.mappings||[]).filter(m=>m.input_key.startsWith('di_'));
  const outputMappings = (ctx.mappings||[]).filter(m=>m.input_key.startsWith('do_')||m.input_key.startsWith('ao_'));
  if (!diMappings.length) return;

  for (let i = 0; i < diMappings.length; i++) {
    const dm = diMappings[i];
    const raw = ctx.state(dm.input_key);
    const isOn = raw==='ON'||raw==='1'||raw==='true';
    const timerKey = `${instId}:${dm.input_key}`;
    const outMapping = outputMappings[i];
    if (!outMapping) continue;

    if (isOn) {
      const t = followTimers.get(timerKey); if(t) clearTimeout(t); followTimers.delete(timerKey);
      const io = ctx.io(outMapping.input_key);
      const isAnalog = io && (io.type==='analog'||io.type==='ao'||io.type==='dimmer');
      sendOutput(send, ctx, outMapping.input_key, isAnalog ? Number(settings.follow_me_level||100) : 'ON', `Follow-me: ${dm.input_key} ON`);
    } else {
      const t = followTimers.get(timerKey); if(t) clearTimeout(t);
      const timer = setTimeout(() => {
        sendOutput(send, ctx, outMapping.input_key, 0, `Follow-me: ${dm.input_key} OFF`);
        followTimers.delete(timerKey);
      }, timeout);
      followTimers.set(timerKey, timer);
    }
  }
}

// ── FEATURE 3: Sunrise/Sleep Routine ────────────────────────────────────────
function evaluateSunriseSleep(instId, ctx, send, settings, siteInfo) {
  const now = nowMin(siteInfo);
  const day = siteDayKey(siteInfo);

  if (String(settings.sunrise_enabled||'0') === '1') {
    const startMin = parseClockValue(settings.sunrise_start||'07:00');
    const endMin   = parseClockValue(settings.sunrise_end||'07:45');
    const outputKey = settings.sunrise_output||'';
    if (startMin !== null && endMin !== null && outputKey) {
      if (now >= startMin && now <= endMin) {
        if (ctx.settingStr('_sunrise_started_'+day,'') !== '1') {
          ctx.setSetting('_sunrise_started_'+day, '1');
          startRoutine(instId, outputKey, startMin, endMin, 0, 100, ctx, send, 'Sunrise');
        }
      } else if (now > endMin) { ctx.setSetting('_sunrise_started_'+day, ''); }
    }
  }

  if (String(settings.sleep_enabled||'0') === '1') {
    const startMin = parseClockValue(settings.sleep_start||'23:00');
    const endMin   = parseClockValue(settings.sleep_end||'23:45');
    const outputKey = settings.sleep_output||'';
    if (startMin !== null && endMin !== null && outputKey) {
      if (now >= startMin && now <= endMin) {
        if (ctx.settingStr('_sleep_started_'+day,'') !== '1') {
          ctx.setSetting('_sleep_started_'+day, '1');
          startRoutine(instId, outputKey, startMin, endMin, 100, 0, ctx, send, 'Sleep');
        }
      } else if (now > endMin) { ctx.setSetting('_sleep_started_'+day, ''); }
    }
  }
}

function startRoutine(instId, outputKey, startMin, endMin, fromLevel, toLevel, ctx, send, label) {
  const durationMs = (endMin-startMin)*60000;
  const steps = Math.max(10, Math.round(durationMs/60000));
  const stepMs = durationMs/steps;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    const level = Math.round(fromLevel + (toLevel-fromLevel)*(step/steps));
    sendOutput(send, ctx, outputKey, level, `${label}: ${level}%`);
    if (step >= steps) { clearInterval(timer); }
  }, stepMs);
}

// ── Trigger evaluators ──────────────────────────────────────────────────────
function shouldFireTrigger(instId, scenarioId, key) {
  const mem = triggerHistory.get(instId) || {};
  if (mem[scenarioId] === key) return false;
  mem[scenarioId] = key;
  triggerHistory.set(instId, mem);
  return true;
}

function evaluatePirTrigger(instId, enabled, ctx) {
  const pirScenarios = enabled.filter(s => s.trigger === 'pir');
  if (!pirScenarios.length) return null;
  const pir = ctx.state('pir_sensor');
  if (pir !== 'ON' && pir !== '1' && pir !== 'true') return null;
  const best = pirScenarios.sort((a,b)=>(b.priority||0)-(a.priority||0))[0];
  const cur = activeScenario.get(instId);
  if (!cur || cur.id !== best.id) return { action:'activate', scenario:best, reason:'PIR motion' };
  return { action:'extend_timer', scenario:best };
}

function evaluateSwitchTrigger(instId, enabled, ctx) {
  const swScenarios = enabled.filter(s => s.trigger === 'switch');
  if (!swScenarios.length) return null;
  const cur = activeScenario.get(instId);
  if (cur && cur.manual) return null;

  const diMappings = (ctx.mappings||[]).filter(m=>m.input_key.startsWith('di_'));
  for (const dm of diMappings) {
    const sw = ctx.state(dm.input_key);
    const swOn = sw==='ON'||sw==='1'||sw==='true';
    const prevKey = `${instId}:${dm.input_key}`;
    const prevOn = switchPrev.get(prevKey) === true;
    const now = Date.now();
    const lastChange = switchDebounce.get(prevKey) || 0;
    if (now - lastChange < 400) continue;
    if (swOn !== prevOn) { switchDebounce.set(prevKey, now); switchPrev.set(prevKey, swOn); }
    if (swOn && !prevOn) return evaluateSwitchCycle(instId, swScenarios);
  }
  return null;
}

function evaluateSwitchCycle(instId, swScenarios) {
  const cur = activeScenario.get(instId);
  const curIdx = swScenarios.findIndex(s => s.id === cur?.id);
  const nextIdx = (curIdx+1) % (swScenarios.length+1);
  const next = swScenarios[nextIdx];
  if (!next) return { action:'switch_off' };
  return { action:'activate', scenario:next, reason:'Wall switch' };
}

function evaluateTimeSunTriggers(instId, enabled, ctx, siteInfo) {
  const sun = siteInfo ? getSun(Number(siteInfo.lat), Number(siteInfo.lon)) : null;
  for (const s of enabled) {
    if (s.trigger === 'time' && s.trigger_time) {
      const [h,m] = s.trigger_time.split(':').map(Number);
      const target = h*60+m;
      const cur = activeScenario.get(instId);
      if (oncePerMinute(instId, `smart_time_${s.id}`, target, siteInfo, 2) && (!cur || cur.id !== s.id))
        return { action:'activate', scenario:s, reason:`Time ${s.trigger_time}` };
    }
    if ((s.trigger==='sunset'||s.trigger==='sunrise') && s.trigger_sun) {
      const target = parseSunTime(s.trigger_sun, sun);
      const cur = activeScenario.get(instId);
      if (target !== null && oncePerMinute(instId, `smart_sun_${s.id}`, target, siteInfo, 2) && (!cur || cur.id !== s.id))
        return { action:'activate', scenario:s, reason:`Sun: ${s.trigger_sun}` };
    }
  }
  return null;
}

function evaluateLuxTrigger(instId, enabled, ctx) {
  const luxVal = ctx.value('ai_1') ?? ctx.value('lux_sensor') ?? null;
  if (luxVal === null) return null;
  const luxScenarios = enabled.filter(s => s.trigger==='lux' && s.trigger_lux_max != null);
  for (const s of luxScenarios.sort((a,b)=>(b.priority||0)-(a.priority||0))) {
    const threshold = Number(s.trigger_lux_max);
    const isDark = luxVal < threshold;
    const cur = activeScenario.get(instId);
    if (isDark && (!cur || cur.id !== s.id)) return { action:'activate', scenario:s, reason:`Lux: ${luxVal.toFixed(0)} < ${threshold}` };
    if (!isDark && cur?.id === s.id) return { action:'lux_deactivate', scenario:s, luxVal };
  }
  return null;
}

// ── Main handler ────────────────────────────────────────────────────────────
function smartLightingHandler(ctx, send, siteInfo) {
  const instId = ctx.instance.id;

  // Restore active scenario from DB
  const saved = ctx.settingStr('_active_scenario', '');
  if (saved) { try { const p = JSON.parse(saved); if (p && (p.id || p.id===null)) activeScenario.set(instId, p); } catch {} }

  const panicEnable = ctx.settingStr('panic_enable','0') === '1';
  // Panic mode omitted — keep simple

  const scenariosJson = ctx.settingStr('scenarios','[]');
  let scenarios;
  try { scenarios = JSON.parse(scenariosJson); } catch(e) { console.warn('[SMART_LIGHTING] Invalid scenarios:', e.message); return; }
  if (!Array.isArray(scenarios)) return;

  const settings = {};
  try { Object.assign(settings, JSON.parse(ctx.settingStr('settings','{}'))); } catch {}

  // Features
  evaluateAdaptiveBrightness(instId, ctx, send, settings);
  evaluateFollowMe(instId, ctx, send, settings);
  evaluateSunriseSleep(instId, ctx, send, settings, siteInfo);

  // Scenario triggers (only if no manual override)
  const current = activeScenario.get(instId);
  const enabled = scenarios.filter(s => s.enabled !== false);

  if (!current || !current.manual) {
    if (enabled.length) {
      const pirResult = evaluatePirTrigger(instId, enabled, ctx);
      if (pirResult) {
        if (pirResult.action === 'activate') { activateScenario(instId, pirResult.scenario, ctx, send, pirResult.reason); }
        else if (pirResult.action === 'extend_timer') {
          clearOffTimer(instId);
          if (pirResult.scenario.off_after > 0) {
            const t = setTimeout(() => { activeScenario.delete(instId); (pirResult.scenario.outputs||[]).forEach(o => sendOutput(send, ctx, o.io_key, 0, `Auto-off: ${pirResult.scenario.name}`)); }, pirResult.scenario.off_after*60000);
            offTimers.set(instId, t);
          }
        }
        return;
      }

      const switchResult = evaluateSwitchTrigger(instId, enabled, ctx);
      if (switchResult) {
        if (switchResult.action === 'activate') { activateScenario(instId, switchResult.scenario, ctx, send, switchResult.reason); }
        else if (switchResult.action === 'switch_off') {
          activeScenario.delete(instId); clearOffTimer(instId); ctx.setSetting('_active_scenario','');
          enabled.forEach(s => (s.outputs||[]).forEach(o => sendOutput(send, ctx, o.io_key, 0, 'Switch: OFF')));
          ctx.broadcastState?.({ status:'idle', active_scene:null, active_scene_name:null, manual_override:true, motion_active:false, schedule_active:false, lux_value:ctx.value('ai_1')??ctx.value('lux_sensor')??null, last_reason:'Switch: OFF' });
        }
        return;
      }

      const timeSunResult = evaluateTimeSunTriggers(instId, enabled, ctx, siteInfo);
      if (timeSunResult && timeSunResult.action === 'activate') { activateScenario(instId, timeSunResult.scenario, ctx, send, timeSunResult.reason); }

      const luxResult = evaluateLuxTrigger(instId, enabled, ctx);
      if (luxResult) {
        if (luxResult.action === 'activate') { activateScenario(instId, luxResult.scenario, ctx, send, luxResult.reason); }
        else if (luxResult.action === 'lux_deactivate') {
          activeScenario.delete(instId); ctx.setSetting('_active_scenario',''); clearOffTimer(instId);
          (luxResult.scenario.outputs||[]).forEach(o => sendOutput(send, ctx, o.io_key, 0, `Lux bright: ${luxResult.luxVal.toFixed(0)}`));
          ctx.broadcastState?.({ status:'idle', active_scene:null, active_scene_name:null, manual_override:false, last_reason:`Lux bright: ${luxResult.luxVal.toFixed(0)}` });
        }
      }
    }
  }

  // Broadcast state
  const activeSc = activeScenario.get(instId);
  if (activeSc) {
    ctx.broadcastState?.({ status:'active', active_scene:activeSc.id, active_scene_name:activeSc.name||activeSc.id, manual_override:!!activeSc.manual, motion_active:false, schedule_active:/Time|Sun/i.test(String(activeSc.reason||'')), lux_value:ctx.value('ai_1')??ctx.value('lux_sensor')??null, last_reason:activeSc.reason||null });
  } else {
    ctx.broadcastState?.({ status:'idle', active_scene:null, active_scene_name:null, manual_override:false, motion_active:false, schedule_active:false, lux_value:ctx.value('ai_1')??ctx.value('lux_sensor')??null, last_reason:'No active scenario' });
  }
}

// ── Module definition ───────────────────────────────────────────────────────
const SMART_LIGHTING_MODULE = {
  id: 'smart_lighting', name: 'Smart Lighting', icon: '✨',
  description: 'Scenario-based lighting with adaptive brightness, follow-me tracking, and sunrise/sleep routines.',
  color: '#f0c040', category: 'smart',
  dynamic: true, max_inputs: 20,
  input_templates: [
    { prefix:'do', label:'Relay Output (DO)', type:'relay', group:'outputs' },
    { prefix:'ao', label:'Dimmer Output (AO 0-100%)', type:'analog', group:'outputs' },
    { prefix:'di', label:'Digital Input (DI)', type:'sensor', group:'inputs' },
    { prefix:'ai', label:'Analog Input (AI)', type:'sensor', group:'inputs' },
  ],
  inputs: [],
  setpoints: [
    { key:'test_mode', label:'Test mode (dry run)', type:'select', options:['0','1'], default:'0', help:'Logic runs normally but real outputs are intercepted.' },
    { key:'adaptive_brightness', label:'Adaptive brightness', type:'select', options:['0','1'], default:'0', help:'Auto-adjust dimmers based on lux sensor.' },
    { key:'adaptive_lux_dark', label:'Lux threshold: dark', type:'number', default:'50', step:10, unit:'lux', help:'Below this → dark level.' },
    { key:'adaptive_lux_medium', label:'Lux threshold: medium', type:'number', default:'200', step:10, unit:'lux', help:'Above this → bright level.' },
    { key:'adaptive_dark_level', label:'Dark level', type:'number', default:'100', step:5, unit:'%', help:'Dimmer level when dark.' },
    { key:'adaptive_medium_level', label:'Medium level', type:'number', default:'60', step:5, unit:'%', help:'Dimmer level at medium lux.' },
    { key:'adaptive_bright_level', label:'Bright level', type:'number', default:'0', step:5, unit:'%', help:'Dimmer level when bright.' },
    { key:'follow_me', label:'Follow-me lighting', type:'select', options:['0','1'], default:'0', help:'Each DI controls its own output.' },
    { key:'follow_me_timeout', label:'Follow-me timeout', type:'number', default:'120', step:10, unit:'sec', help:'Seconds after PIR OFF before turning off.' },
    { key:'follow_me_level', label:'Follow-me level', type:'number', default:'100', step:5, unit:'%', help:'Dimmer level for follow-me outputs.' },
    { key:'sunrise_enabled', label:'Sunrise routine', type:'select', options:['0','1'], default:'0', help:'Gradual 0%→100% at wake time.' },
    { key:'sunrise_start', label:'Sunrise start', type:'time', default:'07:00', help:'When to start fading in.' },
    { key:'sunrise_end', label:'Sunrise end', type:'time', default:'07:45', help:'When to reach 100%.' },
    { key:'sunrise_output', label:'Sunrise output', type:'text', default:'', help:'Dimmer output key (e.g. ao_1).' },
    { key:'sleep_enabled', label:'Sleep routine', type:'select', options:['0','1'], default:'0', help:'Gradual 100%→0% at sleep time.' },
    { key:'sleep_start', label:'Sleep start', type:'time', default:'23:00', help:'When to start fading out.' },
    { key:'sleep_end', label:'Sleep end', type:'time', default:'23:45', help:'When to reach 0%.' },
    { key:'sleep_output', label:'Sleep output', type:'text', default:'', help:'Dimmer output key (e.g. ao_1).' },
  ],
};

module.exports = { smartLightingHandler, SMART_LIGHTING_MODULE, activeScenario };
