// public/js/modules/rules.js

let ruleBuilderInstId = null;
let rules = [];

function openRuleBuilder(instId, moduleIdArg) {
  ruleBuilderInstId = instId;

  // Use generic settings endpoint for all module types
  const inst = instances.find(i=>String(i.id)===String(instId));

  // Pre-load scenes for scene action selector
  const sceneSiteId = Number(inst?.site_id || siteId || 0);
  api('/api/scenes'+(sceneSiteId?('?site_id='+encodeURIComponent(sceneSiteId)):''))
    .then(r => { window._scenesCache = r.scenes || []; }).catch(()=>{});
  const moduleId = moduleIdArg || inst?.module_id || '';
  const endpoint = moduleSettingsEndpoint(instId);

  console.log('[RuleBuilder] instId='+instId+' module='+moduleId+' endpoint='+endpoint);

  api(endpoint).then(d => {
    try {
      // solar returns d.setpoints.rules, generic returns d.settings.rules
      const settingsObj = d.setpoints || d.settings || {};
      rules = JSON.parse(settingsObj?.rules || "[]");
      if (!Array.isArray(rules)) rules = [];
      // Backward-compatible: old rules didn't have mode → default to "stateful"
      rules = rules.map(r => ({ ...r, mode: r?.mode || "stateful" }));
      ruleTestValues = {};
      ruleTestClock = "";
      ruleTestWeekday = "";
      ruleLiveValues = {};
      ruleLastTestContext = null;

// Backward-compatible: old AO actions used "value" (%). Convert to min=max and remove value.
rules = rules.map(r => ({
  ...r,
  actions: (r.actions||[]).map(a => {
    // legacy: AO had "value" only (fixed %)
    if ((a.kind === "AO" || a.value !== undefined) && a.value !== undefined &&
        (a.min_pct === undefined || a.max_pct === undefined)) {
      const v = Number(a.value);
      const out = { ...a, kind: "AO", min_pct: v, max_pct: v };
      delete out.value;
      return out;
    }
    // drop legacy value if min/max exist
    if (a.kind === "AO" && a.value !== undefined) {
      const out = { ...a };
      delete out.value;
      return out;
    }
    return a;
  })
}));
    } catch { rules = []; }
    showRuleBuilderModal();
  }).catch(() => { rules = []; ruleTestValues = {}; ruleTestClock = ""; ruleTestWeekday = ""; ruleLiveValues = {}; ruleLastTestContext = null; showRuleBuilderModal(); });
}

// All IO available on site (sensors + relays/DI)
function allIO() { return siteIO; }
function sensorsIO() { return siteIO.filter(e => e.type === "sensor"); }
function digitalIO() { return siteIO; } // all IO can be used as digital state
function relaysIO()  { return siteIO.filter(e => e.type === "relay");  }
function analogOutIO(){ return siteIO.filter(e => ["dimmer","ao","analog","pwm"].includes(e.type)); }
function outputsIO()  { return siteIO.filter(e => e.type === "relay" || ["dimmer","ao","analog","pwm"].includes(e.type)); }

function isAnalogType(t){ return ["dimmer","ao","analog","pwm"].includes(t); }

// Action kind helper (DO vs AO)
function isAOAction(a){
  if (!a) return false;
  if (a.kind === "AO") return true;
  const sel = siteIO.find(io => String(io.id) === String(a.io_id));
  return sel ? isAnalogType(sel.type) : false;
}

function ioLabel(io) {
  const z = io.zone_name ? ` [${io.zone_name}]` : (io.zone_id ? ` [zone ${io.zone_id}]` : ``);
  const name = io.name && io.name !== io.key ? `${io.device_id}·${io.group_name}.${io.key} (${io.name})` : `${io.device_id}·${io.group_name}.${io.key}`;
  return escapeHTML(`${name}${z}`);
}

function norm(s){ return String(s||"").toLowerCase().trim(); }

function filterIOList(list, query, zoneValue, selectedId=null) {
  let out = list || [];
  const q = norm(query);
  const z = String(zoneValue||"");
  if (z) {
    if (z === "__none__") out = out.filter(io => !io.zone_id);
    else out = out.filter(io => String(io.zone_id) === z);
  }
  if (q) {
    out = out.filter(io => {
      const hay = [
        io.device_id, io.group_name, io.key, io.name, io.type, io.unit,
        io.zone_name, io.zone_id
      ].map(norm).join(" ");
      return hay.includes(q);
    });
  }
  // Keep selected visible even if filter hides it
  if (selectedId) {
    const sid = String(selectedId);
    if (!out.some(io => String(io.id) === sid)) {
      const sel = (list||[]).find(io => String(io.id) === sid);
      if (sel) out = [sel, ...out];
    }
  }
  return out;
}

function buildZoneOptionsHTML() {
  const seen = new Map(); // zone_id -> zone_name
  for (const io of (siteIO||[])) {
    if (io.zone_id == null) continue;
    const id = String(io.zone_id);
    if (!seen.has(id)) seen.set(id, io.zone_name || `Zone ${id}`);
  }
  const items = Array.from(seen.entries())
    .sort((a,b)=> a[1].localeCompare(b[1]))
    .map(([id,name]) => `<option value="${id}">${escapeHTML(name)}</option>`)
    .join("");
  return `<option value="">All zones</option><option value="__none__">No zone</option>` + items;
}

function refreshIOFilterSelects() {
  const mapSel  = document.getElementById("mapZoneFilterSelect");
  if (mapSel) {
    mapSel.innerHTML = buildZoneOptionsHTML();
    mapSel.value = mapZoneFilter || "";
  }
  const ruleSel = document.getElementById("ruleZoneFilterSelect");
  if (ruleSel) {
    ruleSel.innerHTML = buildZoneOptionsHTML();
    ruleSel.value = ruleZoneFilter || "";
  }
}

function ioOptions(list, selectedId, emptyLabel = "— select IO —", filter = null) {
  const filtered = filter ? filterIOList(list, filter.query, filter.zone, selectedId) : list;
  return `<option value="">${escapeHTML(emptyLabel)}</option>` +
    (filtered||[]).map(io => `<option value="${io.id}" ${String(io.id) === String(selectedId) ? "selected" : ""}>${ioLabel(io)}</option>`).join("");
}

function opOptions(selected, types = [">=",">","<=","<","==","!="]) {
  return types.map(op => `<option ${op === selected ? "selected" : ""}>${op}</option>`).join("");
}

function hasSelectedIO(value) {
  return !(value == null || String(value).trim() === '');
}

function condWarnings(c) {
  const issues = [];
  if (!c || typeof c !== 'object') return issues;
  if (c.type === 'sensor_value' && !hasSelectedIO(c.io_id)) issues.push('Select a sensor first.');
  if (c.type === 'sensor_vs_sensor') {
    if (!hasSelectedIO(c.io_a)) issues.push('Select Sensor A.');
    if (!hasSelectedIO(c.io_b)) issues.push('Select Sensor B.');
  }
  if (c.type === 'io_state' && !hasSelectedIO(c.io_id)) issues.push('Select an IO first.');
  if (c.type === 'duration' && !hasSelectedIO(c.inner_condition?.io_id)) issues.push('Select the duration sensor first.');
  return issues;
}

function actionWarnings(a) {
  const issues = [];
  const kind = a?.kind || (isAOAction(a) ? 'AO' : 'DO');
  if ((kind === 'DO' || kind === 'AO') && !hasSelectedIO(a?.io_id)) issues.push(`Select a ${kind === 'AO' ? 'analog output' : 'relay output'} target.`);
  if (kind === 'scene' && !hasSelectedIO(a?.scene_id)) issues.push('Select a scene to activate.');
  return issues;
}

function ruleWarnings(rule) {
  const issues = [];
  (rule?.conditions || []).forEach((c, idx) => condWarnings(c).forEach(msg => issues.push(`Condition ${idx + 1}: ${msg}`)));
  (rule?.actions || []).forEach((a, idx) => actionWarnings(a).forEach(msg => issues.push(`Action ${idx + 1}: ${msg}`)));
  if (rule?.hysteresis?.enabled) {
    (rule?.hysteresis?.off_conditions || []).forEach((c, idx) => condWarnings(c).forEach(msg => issues.push(`Off condition ${idx + 1}: ${msg}`)));
  }
  return issues;
}

function allRuleWarnings() {
  const out = [];
  (rules || []).forEach((rule, idx) => {
    ruleWarnings(rule).forEach(msg => out.push({ ruleIndex: idx, ruleName: rule?.name || `Rule ${idx + 1}`, message: msg }));
  });
  return out;
}

function renderWarningPills(items) {
  return (Array.isArray(items) ? items : []).map(msg => `<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(255,201,71,.10);border:1px solid rgba(255,201,71,.28);color:#ffd978">⚠ ${msg}</span>`).join('');
}

// ── Render condition row ──────────────────────────────────────────────────
function renderCond(c, ri, ci) {
  const typeOpts = `
    <option value="sensor_value"     ${c.type==="sensor_value"     ?"selected":""}>Sensor ▶ value</option>
    <option value="sensor_vs_sensor" ${c.type==="sensor_vs_sensor" ?"selected":""}>Sensor A ▶ Sensor B</option>
    <option value="io_state"         ${c.type==="io_state"         ?"selected":""}>IO state (ON/OFF)</option>
    <option value="time"             ${c.type==="time"             ?"selected":""}>Time window</option>
    <option value="day"              ${c.type==="day"              ?"selected":""}>Day of week</option>
    <option value="sun"              ${c.type==="sun"              ?"selected":""}>🌅 Sunrise / Sunset</option>
    <option value="duration"         ${c.type==="duration"         ?"selected":""}>⏱️ Duration (true for X min)</option>`;

  let detail = "";

  if (c.type === "sensor_value") {
    detail = `
      <select class="cond-sel cond-io" title="Select sensor" onchange="rc(${ri},${ci},'io_id',this.value)">
        ${ioOptions(sensorsIO(), c.io_id, "— sensor —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <select class="cond-sel cond-op" onchange="rc(${ri},${ci},'operator',this.value)">${opOptions(c.operator||">=")}</select>
      <input  class="cond-input cond-val" type="number" value="${c.value??""}" placeholder="value"
              oninput="rc(${ri},${ci},'value',this.value)">`;
  }

  else if (c.type === "sensor_vs_sensor") {
    detail = `
      <select class="cond-sel cond-io" title="Sensor A" onchange="rc(${ri},${ci},'io_a',this.value)">
        ${ioOptions(sensorsIO(), c.io_a, "— sensor A —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <select class="cond-sel cond-op" onchange="rc(${ri},${ci},'operator',this.value)">${opOptions(c.operator||">=")}</select>
      <select class="cond-sel cond-io" title="Sensor B" onchange="rc(${ri},${ci},'io_b',this.value)">
        ${ioOptions(sensorsIO(), c.io_b, "— sensor B —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <input  class="cond-input" type="number" value="${c.offset??0}" placeholder="+offset" title="Offset added to B"
              oninput="rc(${ri},${ci},'offset',this.value)" style="width:58px">
      <span style="font-size:9px;color:var(--muted)">+off</span>`;
  }

  else if (c.type === "io_state") {
    detail = `
      <select class="cond-sel cond-io" title="Any IO" onchange="rc(${ri},${ci},'io_id',this.value)">
        ${ioOptions(digitalIO(), c.io_id, "— relay / DI —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <span style="font-size:11px;color:var(--muted);padding:0 4px">is</span>
      <select class="cond-sel cond-op" onchange="rc(${ri},${ci},'equals',this.value)">
        <option value="ON"  ${(c.equals||"ON")==="ON" ?"selected":""}>ON</option>
        <option value="OFF" ${c.equals==="OFF"?"selected":""}>OFF</option>
        <option value="1"   ${c.equals==="1"  ?"selected":""}>1</option>
        <option value="0"   ${c.equals==="0"  ?"selected":""}>0</option>
      </select>`;
  }

  else if (c.type === "time") {
    detail = `
      <span style="font-size:11px;color:var(--muted)">after</span>
      <input class="cond-input" type="time" value="${c.after||""}"  oninput="rc(${ri},${ci},'after',this.value)"  style="width:90px">
      <span style="font-size:11px;color:var(--muted)">before</span>
      <input class="cond-input" type="time" value="${c.before||""}" oninput="rc(${ri},${ci},'before',this.value)" style="width:90px">`;
  }

  else if (c.type === "day") {
    const days = ["mon","tue","wed","thu","fri","sat","sun"];
    detail = `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
      ${days.map(d => `<label style="font-size:10px;display:flex;align-items:center;gap:2px;cursor:pointer;padding:2px 5px;border-radius:4px;border:1px solid var(--line2);background:${(c.days||[]).includes(d)?"rgba(168,85,247,.15)":"rgba(255,255,255,.03)"}">
        <input type="checkbox" style="width:10px" ${(c.days||[]).includes(d)?"checked":""} onchange="toggleDay(${ri},${ci},'${d}',this.checked)">${d}</label>`).join("")}
    </div>`;
  }

  else if (c.type === "sun") {
    detail = `
      <select class="cond-sel" onchange="rc(${ri},${ci},'sun_event',this.value)">
        <option value="sunrise" ${(c.sun_event||'sunrise')==='sunrise'?'selected':''}>🌄 Sunrise</option>
        <option value="sunset"  ${c.sun_event==='sunset'?'selected':''}>🌇 Sunset</option>
      </select>
      <select class="cond-sel" onchange="rc(${ri},${ci},'sun_when',this.value)">
        <option value="after"     ${(c.sun_when||'after')==='after'?'selected':''}>after</option>
        <option value="before"    ${c.sun_when==='before'?'selected':''}>before</option>
        <option value="daytime"   ${c.sun_when==='daytime'?'selected':''}>daytime</option>
        <option value="nighttime" ${c.sun_when==='nighttime'?'selected':''}>nighttime</option>
      </select>
      <span style="font-size:11px;color:var(--muted)">offset</span>
      <input class="cond-input" type="number" value="${c.offset_min||0}" style="width:60px" placeholder="min"
             oninput="rc(${ri},${ci},'offset_min',this.value)">
      <span style="font-size:10px;color:var(--muted)">min</span>`;
  }

  else if (c.type === "duration") {
    const inner = c.inner_condition || {};
    detail = `
      <span style="font-size:11px;color:var(--muted)">Sensor</span>
      <select class="cond-sel cond-io" onchange="rc(${ri},${ci},'inner_condition',{type:'sensor_value',io_id:this.value,operator:'>='})">
        ${ioOptions(sensorsIO(), inner.io_id, "— sensor —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <select class="cond-sel cond-op" onchange="rc(${ri},${ci},'inner_condition',{...rules[${ri}].conditions[${ci}].inner_condition||{},operator:this.value})">
        ${opOptions(inner.operator||">=")}
      </select>
      <input class="cond-input" type="number" value="${inner.value??''}" style="width:72px" placeholder="value"
             oninput="rc(${ri},${ci},'inner_condition',{...rules[${ri}].conditions[${ci}].inner_condition||{},value:this.value})">
      <span style="font-size:11px;color:var(--muted)">for ≥</span>
      <input class="cond-input" type="number" value="${c.min_minutes||5}" style="width:56px"
             oninput="rc(${ri},${ci},'min_minutes',this.value)">
      <span style="font-size:10px;color:var(--muted)">min</span>`;
  }

  const warnings = condWarnings(c);
  const warnHtml = warnings.length
    ? `<div style="width:100%;margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">${renderWarningPills(warnings)}</div>`
    : '';
  return `<div class="cond-row" id="cr_${ri}_${ci}" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;padding:6px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--line)">
    <select class="cond-sel" style="width:170px" onchange="condTypeChange(${ri},${ci},this.value)">${typeOpts}</select>
    ${detail}
    <button class="btn btn-xs btn-danger" style="margin-left:auto" onclick="removeCond(${ri},${ci})">✕</button>
    ${warnHtml}
  </div>`;
}

// ── Render action row ────────────────────────────────────────────────────
function renderAction(a, ri, ai) {
  const kind = a.kind || (isAOAction(a) ? "AO" : "DO");
  const minPct = a.min_pct ?? 0;
  const maxPct = a.max_pct ?? 100;
  const offDelay = a.off_delay_s ?? 0;
  const warnings = actionWarnings(a);
  const warnHtml = warnings.length
    ? `<div style="width:100%;margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">${renderWarningPills(warnings)}</div>`
    : '';
  return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;padding:6px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--line)">
    <span style="font-size:11px;color:var(--muted);white-space:nowrap">SET</span>
    <select class="cond-sel" style="width:170px" onchange="actionKindChange(${ri},${ai},this.value)">
      <option value="DO"     ${kind==="DO"    ?"selected":""}>Relay (DO)</option>
      <option value="AO"     ${kind==="AO"    ?"selected":""}>Analog Output (AO)</option>
      <option value="notify" ${kind==="notify"?"selected":""}>🔔 Notify</option>
      <option value="scene"  ${kind==="scene" ?"selected":""}>🎬 Activate Scene</option>
    </select>
    <select class="cond-sel" style="flex:1" onchange="actionIOChange(${ri},${ai},this.value)">
      ${kind==="AO" ? ioOptions(analogOutIO(), a.io_id, "— analog output (AO) —", {query:ruleIOQuery, zone:ruleZoneFilter}) : ioOptions(relaysIO(), a.io_id, "— relay output (DO) —", {query:ruleIOQuery, zone:ruleZoneFilter})}
    </select>
    <span style="font-size:11px;color:var(--muted)">→</span>
    ${kind === "AO" ? `
<select class="cond-sel" style="flex:1" onchange="actionIOChange(${ri},${ai},this.value)">
  ${ioOptions(analogOutIO(), a.io_id, "— analog output (AO) —", {query:ruleIOQuery, zone:ruleZoneFilter})}
</select>
<span style="font-size:11px;color:var(--muted);white-space:nowrap">AUTO DT</span>
<span style="font-size:11px;color:var(--muted);margin-left:10px">min</span>
<input class="cond-input" type="number" min="0" max="100" step="0.5" value="${minPct}" style="width:72px"
       oninput="ra(${ri},${ai},'min_pct',this.value)" placeholder="0">
<span style="font-size:11px;color:var(--muted);margin-left:6px">max</span>
<input class="cond-input" type="number" min="0" max="100" step="0.5" value="${maxPct}" style="width:72px"
       oninput="ra(${ri},${ai},'max_pct',this.value)" placeholder="100">
    ` : kind === "notify" ? `
<input class="cond-input" style="flex:1;min-width:120px" placeholder="Title" value="${a.notify_title||''}"
       oninput="ra(${ri},${ai},'notify_title',this.value)">
<input class="cond-input" style="flex:1;min-width:120px" placeholder="Body message" value="${a.notify_body||''}"
       oninput="ra(${ri},${ai},'notify_body',this.value)">
<select class="cond-sel" onchange="ra(${ri},${ai},'notify_level',this.value)">
  <option value="info"    ${(a.notify_level||'info')==='info'   ?'selected':''}>ℹ️ Info</option>
  <option value="warning" ${a.notify_level==='warning'          ?'selected':''}>⚠️ Warning</option>
  <option value="error"   ${a.notify_level==='error'            ?'selected':''}>🔴 Error</option>
</select>
    ` : kind === "scene" ? `
<select class="cond-sel" style="flex:1" onchange="ra(${ri},${ai},'scene_id',this.value)">
  <option value="">— select scene —</option>
  ${(window._scenesCache||[]).map(s=>'<option value="'+s.id+'" '+(String(a.scene_id)===String(s.id)?'selected':'')+'>'+(escapeHTML(s.icon||'\u2699\ufe0f'))+' '+escapeHTML(s.name)+'</option>').join('')}
</select>
    ` : `
      <select class="cond-sel" style="flex:1" onchange="actionIOChange(${ri},${ai},this.value)">
        ${ioOptions(relaysIO(), a.io_id, "— relay output (DO) —", {query:ruleIOQuery, zone:ruleZoneFilter})}
      </select>
      <span style="font-size:11px;color:var(--muted);white-space:nowrap">ON/OFF</span>
      <span style="font-size:11px;color:var(--muted);margin-left:8px;white-space:nowrap">OFF delay</span>
      <input class="cond-input" type="number" min="0" step="1" value="${offDelay}" style="width:74px"
             oninput="ra(${ri},${ai},'off_delay_s',this.value)" placeholder="sec">
      <span style="font-size:11px;color:var(--muted)">s</span>
    `}
    <button class="btn btn-xs btn-danger" onclick="removeAction(${ri},${ai})">✕</button>
    ${warnHtml}
  </div>`;
}

// ── Render full rule card ────────────────────────────────────────────────
function renderRuleCard(rule, ri) {
  const condRows = (rule.conditions||[]).map((c,ci) => renderCond(c,ri,ci)).join("");
  const actRows  = (rule.actions||[]).map((a,ai) => renderAction(a,ri,ai)).join("");
  const warnings = ruleWarnings(rule);

  // Hysteresis OFF conditions
  const hystEnabled = rule.hysteresis?.enabled;
  const offRows = hystEnabled
    ? (rule.hysteresis.off_conditions||[]).map((c,ci) => renderCond(c, `${ri}_off`, ci)).join("")
    : "";
  const warningHtml = warnings.length
    ? `<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,201,71,.28);background:rgba(255,201,71,.06)">
         <div style="font-size:10px;font-weight:800;color:#ffd978;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Needs attention before a full dry run</div>
         <div style="display:flex;flex-wrap:wrap;gap:4px">${renderWarningPills(warnings)}</div>
       </div>`
    : '';

  return `<div class="rule-card" id="rc_${ri}" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input class="rule-name-input" placeholder="Rule name" value="${rule.name||""}"
             style="flex:1;min-width:120px" oninput="rules[${ri}].name=this.value">
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted2);cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${rule.enabled?"checked":""} onchange="rules[${ri}].enabled=this.checked"> Enabled
      </label>
      <button class="btn btn-xs" onclick="moveRule(${ri},-1)" title="Move up" style="padding:4px 8px">▲</button>
      <button class="btn btn-xs" onclick="moveRule(${ri},+1)" title="Move down" style="padding:4px 8px">▼</button>
      <button class="btn btn-xs btn-danger" onclick="removeRule(${ri})">✕ Remove</button>
    </div>

    ${warningHtml}

    <!-- Conditions -->
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">
      IF Conditions
    </div>
    <div id="condList_${ri}">${condRows}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-xs" onclick="addCond(${ri})">+ Condition</button>
      <div class="logic-toggle" style="display:flex;gap:4px">
        <button class="logic-btn ${(rule.logic||"AND")==="AND"?"active":""}" onclick="setLogic(${ri},'AND')">AND (all)</button>
        <button class="logic-btn ${rule.logic==="OR"?"active":""}" onclick="setLogic(${ri},'OR')">OR (any)</button>
      </div>
    </div>

    <!-- Actions -->
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">
      THEN Actions
    </div>
    <div id="actList_${ri}">${actRows}</div>
    <button class="btn btn-xs" onclick="addAction(${ri})" style="margin-bottom:10px">+ Action</button>

    <!-- Hysteresis toggle -->
    <div style="padding:8px;background:rgba(168,85,247,.05);border:1px solid rgba(168,85,247,.2);border-radius:6px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;font-weight:700;color:#a855f7">
        <input type="checkbox" ${hystEnabled?"checked":""} onchange="toggleHyst(${ri},this.checked)">
        ⟳ Hysteresis — separate OFF conditions
      </label>
      ${hystEnabled ? `
      <div style="margin-top:8px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">TURN OFF WHEN</div>
        <div id="offList_${ri}">${offRows}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-xs" onclick="addOffCond(${ri})">+ Off Condition</button>
          <div class="logic-toggle" style="display:flex;gap:4px">
            <button class="logic-btn ${(rule.hysteresis?.off_logic||"AND")==="AND"?"active":""}" onclick="setOffLogic(${ri},'AND')">AND</button>
            <button class="logic-btn ${rule.hysteresis?.off_logic==="OR"?"active":""}" onclick="setOffLogic(${ri},'OR')">OR</button>
          </div>
        </div>
      </div>` : ""}
    </div>

    <!-- Cooldown -->
    <div style="display:flex;align-items:center;gap:8px;font-size:11px">
      <span style="color:var(--muted)">Cooldown:</span>
      <input class="sp-input" type="number" style="width:60px" value="${rule.cooldown||60}"
             oninput="rules[${ri}].cooldown=Number(this.value)">
      <span style="color:var(--muted)">sec between re-triggers</span>
    </div>
  </div>`;
}

function renderRuleList() {
  if (!rules.length) return `<div style="color:var(--muted);font-size:13px;padding:12px 0;text-align:center">No rules yet. Click "+ Add Rule".</div>`;
  return rules.map((r,ri) => renderRuleCard(r,ri)).join("");
}

function collectRuleIOIds() {
  const ids = new Set();
  const visitCond = (c) => {
    if (!c || typeof c !== 'object') return;
    if (c.io_id != null && c.io_id !== '') ids.add(Number(c.io_id));
    if (c.io_a != null && c.io_a !== '') ids.add(Number(c.io_a));
    if (c.io_b != null && c.io_b !== '') ids.add(Number(c.io_b));
    if (c.inner_condition) visitCond(c.inner_condition);
  };
  const visitGroup = (g) => {
    if (!g || typeof g !== 'object') return;
    (g.conditions || []).forEach(visitCond);
    (g.groups || []).forEach(visitGroup);
  };
  (rules || []).forEach(rule => {
    (rule.conditions || []).forEach(visitCond);
    if (rule.logic_group || rule.logicGroup || rule.group) visitGroup(rule.logic_group || rule.logicGroup || rule.group);
    const hyst = rule.hysteresis || {};
    (hyst.off_conditions || []).forEach(visitCond);
    if (hyst.off_group || hyst.offGroup) visitGroup(hyst.off_group || hyst.offGroup);
  });
  return Array.from(ids).filter(Number.isFinite);
}

function ioValueLabel(ioId) {
  const live = ruleLiveValues?.[ioId];
  if (!live) return 'live: ?';
  const v = live.effective_value ?? live.value;
  const unit = live.unit ? ` ${live.unit}` : '';
  const source = live.source === 'test' ? 'test' : live.source === 'forced' ? 'forced' : 'live';
  return `${source}: ${v ?? '?'}${unit}`;
}

function isBinaryType(type) {
  const t = String(type || '').toLowerCase();
  return ['relay','switch','contact','binary','bool','button','digital','di','do'].includes(t);
}

function renderRuleTestInput(ioId) {
  const io = siteIO.find(x => Number(x.id) === Number(ioId));
  if (!io) return '';
  const current = ruleTestValues?.[ioId] ?? '';
  const live = ioValueLabel(ioId);
  const unit = io.unit ? ` ${io.unit}` : '';
  const binary = isBinaryType(io.type);
  return `
    <div style="padding:8px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02)">
      <div style="font-size:12px;font-weight:700">${escapeHTML(io.name || io.key || ('IO ' + Number(io.id)))}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${escapeHTML(io.device_id)}/${escapeHTML(io.key)} • ${escapeHTML(io.type)}${escapeHTML(unit)}</div>
      ${binary ? `
        <select class="sp-input" onchange="setRuleTestValue(${io.id}, this.value)">
          <option value="" ${current === '' ? 'selected' : ''}>Use live value</option>
          <option value="ON" ${String(current).toUpperCase()==='ON' ? 'selected' : ''}>ON</option>
          <option value="OFF" ${String(current).toUpperCase()==='OFF' ? 'selected' : ''}>OFF</option>
        </select>` : `
        <input class="sp-input" type="number" step="any" value="${current === '' ? '' : current}" placeholder="Use live value"
               oninput="setRuleTestValue(${io.id}, this.value)">`}
      <div style="font-size:10px;color:var(--muted2);margin-top:6px">${live}</div>
    </div>`;
}

function renderRuleTestPanel() {
  const el = document.getElementById('ruleTestPanel');
  if (!el) return;
  const ids = collectRuleIOIds();
  const items = ids.map(renderRuleTestInput).join('');
  const warnings = allRuleWarnings();
  const warnBox = warnings.length
    ? `<div style="margin-bottom:10px;padding:10px;border:1px solid rgba(255,201,71,.28);background:rgba(255,201,71,.06);border-radius:8px">
         <div style="font-size:11px;font-weight:800;color:#ffd978;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Dry run warnings</div>
         <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Rules with missing sensors or outputs can still be saved, but the dry run will mark them as incomplete.</div>
         <div style="display:flex;flex-wrap:wrap;gap:4px">${warnings.map(w => `<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(255,201,71,.10);border:1px solid rgba(255,201,71,.28);color:#ffd978">⚠ ${w.ruleName}: ${w.message}</span>`).join('')}</div>
       </div>`
    : '';
  const ctx = ruleLastTestContext
    ? `<div style="font-size:10px;color:var(--muted2);margin-top:6px">Last dry run used: ${ruleLastTestContext.clock || '--:--'} • ${String(ruleLastTestContext.weekday || '').toUpperCase()}</div>`
    : '';
  el.innerHTML = `
    <div style="padding:12px;border:1px solid rgba(34,217,122,.22);background:rgba(34,217,122,.04);border-radius:10px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div style="font-size:11px;font-weight:800;color:#22d97a;text-transform:uppercase;letter-spacing:1px">🧪 Dry Run Inputs</div>
          <div style="font-size:12px;color:var(--muted)">Set temporary values only for testing. Nothing here writes to real IO.</div>
        </div>
        <button class="btn btn-xs" onclick="clearRuleTestOverrides()">Clear test values</button>
      </div>
      ${warnBox}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px">
        <div style="padding:8px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02)">
          <div style="font-size:12px;font-weight:700">Clock override</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Leave empty to use live site time.</div>
          <input class="sp-input" type="time" value="${ruleTestClock || ''}" onchange="setRuleTestClock(this.value)">
        </div>
        <div style="padding:8px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02)">
          <div style="font-size:12px;font-weight:700">Day override</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Useful for day/time rules.</div>
          <select class="sp-input" onchange="setRuleTestWeekday(this.value)">
            <option value="" ${!ruleTestWeekday ? 'selected' : ''}>Use live day</option>
            <option value="mon" ${ruleTestWeekday==='mon' ? 'selected' : ''}>Mon</option>
            <option value="tue" ${ruleTestWeekday==='tue' ? 'selected' : ''}>Tue</option>
            <option value="wed" ${ruleTestWeekday==='wed' ? 'selected' : ''}>Wed</option>
            <option value="thu" ${ruleTestWeekday==='thu' ? 'selected' : ''}>Thu</option>
            <option value="fri" ${ruleTestWeekday==='fri' ? 'selected' : ''}>Fri</option>
            <option value="sat" ${ruleTestWeekday==='sat' ? 'selected' : ''}>Sat</option>
            <option value="sun" ${ruleTestWeekday==='sun' ? 'selected' : ''}>Sun</option>
          </select>
        </div>
      </div>
      ${items ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">${items}</div>` : `<div style="font-size:12px;color:var(--muted)">Add rule conditions first and the relevant IO test fields will appear here.</div>`}
      ${ctx}
    </div>`;
}

function setRuleTestValue(ioId, value) {
  if (value === '' || value == null) delete ruleTestValues[ioId];
  else ruleTestValues[ioId] = value;
  renderRuleTestPanel();
}
function setRuleTestClock(value) { ruleTestClock = String(value || '').trim(); renderRuleTestPanel(); }
function setRuleTestWeekday(value) { ruleTestWeekday = String(value || '').trim(); renderRuleTestPanel(); }
function clearRuleTestOverrides() {
  ruleTestValues = {};
  ruleTestClock = '';
  ruleTestWeekday = '';
  ruleLastTestContext = null;
  renderRuleTestPanel();
  const panel = document.getElementById('testResultsPanel');
  if (panel) panel.innerHTML = '';
}

function showRuleBuilderModal() {
  document.getElementById("ruleModal")?.remove();
  const inst = instances.find(i => i.id === ruleBuilderInstId);
  document.body.insertAdjacentHTML("beforeend", `
  <div id="ruleModal" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto">
  <div style="background:var(--card);border:1px solid var(--line2);border-radius:var(--radius);padding:22px;width:100%;max-width:780px;margin-bottom:40px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div style="font-size:16px;font-weight:800">⚡ Rule Builder — ${escapeHTML(inst?.name||"Custom")}</div>
      <button class="btn btn-sm" onclick="closeRuleBuilder()">✕ Close</button>
    </div>

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:-4px 0 14px">
      <input class="sp-input" id="ruleIOQueryInput" placeholder="Search IO (device / key / name / zone)"
             style="flex:1;min-width:240px" oninput="ruleIOQuery=this.value; document.getElementById('ruleList').innerHTML=renderRuleList();">
      <select class="sp-input" id="ruleZoneFilterSelect" style="width:220px"
              onchange="ruleZoneFilter=this.value; document.getElementById('ruleList').innerHTML=renderRuleList();">
        <option value="">All zones</option>
      </select>
      <button class="btn btn-sm" onclick="ruleIOQuery=''; ruleZoneFilter=''; document.getElementById('ruleIOQueryInput').value=''; document.getElementById('ruleZoneFilterSelect').value=''; document.getElementById('ruleList').innerHTML=renderRuleList();">Clear</button>
    </div>
    <div id="ruleTestPanel"></div>
    <div id="ruleList">${renderRuleList()}</div>
    <button class="btn btn-sm btn-purple" onclick="addRule()" style="margin-top:4px">+ Add Rule</button>
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn" onclick="closeRuleBuilder()">Cancel</button>
      <button class="btn" onclick="testRules()" style="background:rgba(34,217,122,.15);border-color:rgba(34,217,122,.4);color:#22d97a">🧪 Test Now</button>
      <button class="btn btn-primary" onclick="saveRules()">💾 Save Rules</button>
    </div>
  </div></div>`);
  renderRuleTestPanel();
}

// ── Mutation helpers ─────────────────────────────────────────────────────
function rc(ri, ci, field, val) { // rule condition
  const isOff = String(ri).includes("_off");
  if (isOff) {
    const realRi = parseInt(ri);
    if (rules[realRi]?.hysteresis?.off_conditions?.[ci]) rules[realRi].hysteresis.off_conditions[ci][field] = val;
  } else {
    if (rules[ri]?.conditions?.[ci]) rules[ri].conditions[ci][field] = val;
  }
  // refresh zone dropdowns in modal
  refreshIOFilterSelects();
}

function ra(ri, ai, field, val) { // rule action
  if (rules[ri]?.actions?.[ai]) rules[ri].actions[ai][field] = val;
}

function actionIOChange(ri, ai, ioId) {
  if (!rules[ri]?.actions?.[ai]) return;
  rules[ri].actions[ai].io_id = ioId;
  const io = siteIO.find(e => String(e.id) === String(ioId));
  // Keep kind consistent with IO type (and support legacy rules without kind)
  const inferredKind = io && isAnalogType(io.type) ? "AO" : "DO";
  if (!rules[ri].actions[ai].kind) rules[ri].actions[ai].kind = inferredKind;
  const kind = rules[ri].actions[ai].kind;

  if (kind === "AO") {
    if (rules[ri].actions[ai].min_pct === undefined || rules[ri].actions[ai].min_pct === null || rules[ri].actions[ai].min_pct === "") rules[ri].actions[ai].min_pct = 0;
    if (rules[ri].actions[ai].max_pct === undefined || rules[ri].actions[ai].max_pct === null || rules[ri].actions[ai].max_pct === "") rules[ri].actions[ai].max_pct = 100;
    delete rules[ri].actions[ai].value;
    delete rules[ri].actions[ai].command;
    delete rules[ri].actions[ai].off_delay_s;
  } else {
    if (!rules[ri].actions[ai].command) rules[ri].actions[ai].command = "ON";
    if (rules[ri].actions[ai].off_delay_s === undefined || rules[ri].actions[ai].off_delay_s === null) rules[ri].actions[ai].off_delay_s = 0;
    delete rules[ri].actions[ai].value;
    delete rules[ri].actions[ai].min_pct;
    delete rules[ri].actions[ai].max_pct;
  }
  refreshRuleModal();
}

function actionKindChange(ri, ai, kind) {
  if (!rules[ri]?.actions?.[ai]) return;
  rules[ri].actions[ai].kind = kind;
  // Reset IO selection when switching kind (prevents DO picking AO output and vice versa)
  rules[ri].actions[ai].io_id = "";
  if (kind === "AO") {
    rules[ri].actions[ai].min_pct = (rules[ri].actions[ai].min_pct ?? 0);
    rules[ri].actions[ai].max_pct = (rules[ri].actions[ai].max_pct ?? 100);
    delete rules[ri].actions[ai].value;
    delete rules[ri].actions[ai].command;
    delete rules[ri].actions[ai].off_delay_s;
  } else {
    rules[ri].actions[ai].command = "ON";
    rules[ri].actions[ai].off_delay_s = (rules[ri].actions[ai].off_delay_s ?? 0);
    delete rules[ri].actions[ai].value;
    delete rules[ri].actions[ai].min_pct;
    delete rules[ri].actions[ai].max_pct;
  }
  refreshRuleModal();
}

function condTypeChange(ri, ci, newType) {
  if (rules[ri]?.conditions?.[ci]) {
    rules[ri].conditions[ci] = { type: newType };
    refreshRuleModal();
  }
}

function setLogic(ri, logic) {
  rules[ri].logic = logic;
  refreshRuleModal();
}

function setOffLogic(ri, logic) {
  if (rules[ri]?.hysteresis) { rules[ri].hysteresis.off_logic = logic; refreshRuleModal(); }
}

function toggleHyst(ri, enabled) {
  rules[ri].hysteresis = enabled ? { enabled:true, off_conditions:[], off_logic:"AND" } : { enabled:false };
  refreshRuleModal();
}

function toggleDay(ri, ci, day, checked) {
  const days = rules[ri].conditions[ci].days || [];
  rules[ri].conditions[ci].days = checked ? [...new Set([...days,day])] : days.filter(d=>d!==day);
  refreshRuleModal();
}

function addRule() {
  // mode:
  //   - "stateful": keeps outputs ON while conditions are true and turns them OFF when false (with optional OFF delay)
  //   - "trigger": legacy mode (execute actions only when condition becomes true)
  rules.push({ id:"r"+Date.now(), name:"New Rule", enabled:true, mode:"stateful", conditions:[], logic:"AND", actions:[], hysteresis:{enabled:false}, cooldown:60 });
  refreshRuleModal();
}

function moveRule(ri, dir) {
  const ni = ri + dir;
  if (ni < 0 || ni >= rules.length) return;
  [rules[ri], rules[ni]] = [rules[ni], rules[ri]];
  renderRuleList && document.getElementById('ruleList') && (document.getElementById('ruleList').innerHTML = renderRuleList());
}

function removeRule(ri) { rules.splice(ri,1); refreshRuleModal(); }

function addCond(ri) {
  rules[ri].conditions.push({ type:"sensor_value", operator:">=", value:"" });
  refreshRuleModal();
}

function removeCond(ri, ci) {
  const isOff = String(ri).includes("_off");
  if (isOff) {
    const realRi = parseInt(ri);
    rules[realRi]?.hysteresis?.off_conditions?.splice(ci,1);
  } else {
    rules[ri]?.conditions?.splice(ci,1);
  }
  refreshRuleModal();
}

function addOffCond(ri) {
  if (!rules[ri].hysteresis) rules[ri].hysteresis = { enabled:true, off_conditions:[], off_logic:"AND" };
  rules[ri].hysteresis.off_conditions.push({ type:"sensor_value", operator:"<=", value:"" });
  refreshRuleModal();
}

function addAction(ri) {
  // Default action: Relay (DO)
  rules[ri].actions.push({ kind:"DO", io_id:"", command:"ON", off_delay_s:0 });
  refreshRuleModal();
}

function removeAction(ri, ai) { rules[ri].actions.splice(ai,1); refreshRuleModal(); }

function refreshRuleModal() {
  const el = document.getElementById("ruleList");
  if (el) el.innerHTML = renderRuleList();
  renderRuleTestPanel();
}

function renderDryRunCondPills(items, activeColor = '#22d97a', activeBg = 'rgba(34,217,122,.15)', activeBorder = 'rgba(34,217,122,.3)') {
  return (Array.isArray(items) ? items : []).map(c => {
    const bg = c.met ? activeBg : 'rgba(255,255,255,.05)';
    const border = c.met ? activeBorder : 'var(--line)';
    const color = c.met ? activeColor : 'var(--muted2)';
    return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${bg};border:1px solid ${border};color:${color}">${c.met ? '✓' : '✗'} ${c.label}</span>`;
  }).join('');
}

function renderDryRunActionPills(items, muted = false) {
  return (Array.isArray(items) ? items : []).map(a => {
    const blocked = !!a.blocked && !muted;
    const incomplete = !!a.incomplete && !muted;
    const bg = muted ? 'rgba(255,255,255,.05)' : (incomplete ? 'rgba(255,201,71,.08)' : (blocked ? 'rgba(255,69,69,.08)' : 'rgba(29,140,255,.08)'));
    const border = muted ? 'var(--line)' : (incomplete ? 'rgba(255,201,71,.28)' : (blocked ? 'rgba(255,69,69,.25)' : 'rgba(29,140,255,.18)'));
    const color = muted ? 'var(--muted2)' : (incomplete ? '#ffd978' : (blocked ? '#ff9d9d' : '#8fc7ff'));
    const icon = muted ? '•' : (incomplete ? '⚠' : (blocked ? '⛔' : '⚡'));
    const extra = (!muted && blocked && a.forced_value != null) ? ` (forced=${a.forced_value})` : '';
    const label = muted ? String(a.label || '').replace(/^Would /, '') : String(a.label || '');
    return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${bg};border:1px solid ${border};color:${color}">${icon} ${label}${extra}</span>`;
  }).join('');
}

function renderDryRunResultCard(r) {
  const border = r.wouldExecute ? 'rgba(34,217,122,.3)' : (r.allMet ? 'rgba(255,201,71,.3)' : 'rgba(255,69,69,.3)');
  const bg = r.wouldExecute ? 'rgba(34,217,122,.05)' : (r.allMet ? 'rgba(255,201,71,.05)' : 'rgba(255,69,69,.05)');
  const titleColor = r.wouldExecute ? '#22d97a' : (r.allMet ? '#ffc947' : '#ff4545');
  const title = r.wouldExecute ? '✅ Would execute' : (r.allMet ? '⚠ Conditions met but disabled' : '❌ Conditions not met');
  const offHtml = Array.isArray(r.offResults) && r.offResults.length
    ? `<div style="margin-top:8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Hysteresis OFF path ${r.offAllMet ? 'is met' : 'not met'}</div>
       <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${renderDryRunCondPills(r.offResults, '#ffc947', 'rgba(255,201,71,.12)', 'rgba(255,201,71,.3)')}</div>`
    : '';
  const actionHtml = Array.isArray(r.actionsPreview) && r.actionsPreview.length
    ? `<div style="margin-top:8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Would run actions</div>
       <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${renderDryRunActionPills(r.actionsPreview, false)}</div>`
    : (Array.isArray(r.configuredActions) && r.configuredActions.length
      ? `<div style="margin-top:8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Configured actions</div>
         <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${renderDryRunActionPills(r.configuredActions, true)}</div>`
      : '');
  return `
    <div style="margin-bottom:10px;padding:10px;border-radius:8px;border:1px solid ${border};background:${bg}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
        <div style="font-weight:700;font-size:12px;color:${titleColor}">${title} — ${r.name}</div>
        <div style="font-size:10px;color:var(--muted2)">${(r.mode || 'stateful').toUpperCase()}${!r.enabled ? ' • disabled' : ''}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${renderDryRunCondPills(r.condResults)}</div>
      ${offHtml}
      ${actionHtml}
    </div>`;
}

async function testRules() {
  if (!ruleBuilderInstId) return;
  let liveValues = {};
  let serverResults = [];
  let context = null;
  try {
    const r = await apiPost(`/api/automation/custom/${ruleBuilderInstId}/test`, {
      rules,
      test_values: ruleTestValues,
      test_context: {
        time_hhmm: ruleTestClock || undefined,
        weekday: ruleTestWeekday || undefined,
      }
    });
    liveValues = r.values || {};
    serverResults = Array.isArray(r.results) ? r.results : [];
    context = r.context || null;
    ruleLiveValues = liveValues || {};
    ruleLastTestContext = context;
    renderRuleTestPanel();
  } catch(e) {
    toast('Test failed: ' + e.message, 'err');
    return;
  }

  let el = document.getElementById('testResultsPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'testResultsPanel';
    el.style.cssText = 'margin:12px 0;padding:12px;background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;max-height:320px;overflow-y:auto';
    const ruleList = document.getElementById('ruleList');
    if (ruleList) ruleList.parentNode.insertBefore(el, ruleList);
  }

  const warnings = allRuleWarnings();
  const ctxLine = context
    ? `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Clock: <b>${context.clock || '--:--'}</b> • Day: <b>${String(context.weekday || '').toUpperCase()}</b></div>`
    : '';
  const warnLine = warnings.length
    ? `<div style="margin-bottom:8px;padding:8px;border-radius:8px;border:1px solid rgba(255,201,71,.25);background:rgba(255,201,71,.05);font-size:12px;color:var(--muted)">⚠ Some rules are incomplete. Missing sensors/outputs are shown below and will be treated as unresolved in this dry run.</div>`
    : '';

  el.innerHTML = '<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">🧪 Dry Run Results</div>'
    + ctxLine
    + warnLine
    + serverResults.map(renderDryRunResultCard).join('');
}

async function saveRules() {
  try {
    const saveEndpoint = moduleSettingsEndpoint(ruleBuilderInstId);
    await api(saveEndpoint, {
      method:"PATCH", body: JSON.stringify({ key:"rules", value: JSON.stringify(rules) })
    });
    toast("✓ Rules saved");
    closeRuleBuilder();
    await loadInstances();
  } catch(e) { toast("Error: "+e.message,"err"); }
}

function closeRuleBuilder() {
  document.getElementById("ruleModal")?.remove();
  ruleBuilderInstId = null;
}
