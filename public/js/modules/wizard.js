// public/js/modules/wizard.js
// Wizard state transitions, dynamic inputs, save/edit/delete flows for Modules page.

// ── Shared helpers moved to /public/modules.shared.js + /public/js/modules/core_ui.js ─────────────
function collectCurrentWizardMappings() {
  const mappings = {};
  (selectedDef?.inputs || []).forEach(input => {
    const sel = document.getElementById('map_' + input.key);
    if (sel && !sel.disabled && sel.value) mappings[input.key] = Number(sel.value);
  });
  if (selectedDef?.dynamic) {
    dynSlots.forEach(slot => {
      const sel = document.getElementById('map_' + slot.key);
      if (sel && !sel.disabled && sel.value) mappings[slot.key] = Number(sel.value);
    });
  }
  return mappings;
}

function buildEffectiveMappings(currentMappings) {
  const eff = {};
  (selectedDef?.inputs || []).forEach(inp => {
    const v = currentMappings[inp.key] ?? suggestions[inp.key];
    const enabled = inp.required || !!currentMappings[inp.key] || (!editingId && !!suggestions[inp.key]);
    if (enabled && v) eff[inp.key] = Number(v);
  });
  return eff;
}

function renderThermostatWizard(currentMappings={}, rowRenderer) {
  const legacyDefs = ['temp_room','ac_relay','temp_outdoor']
    .map(key => (selectedDef?.inputs||[]).find(inp => inp.key === key)).filter(Boolean);
  const sharedDefs = ['central_pump']
    .map(key => (selectedDef?.inputs||[]).find(inp => inp.key === key)).filter(Boolean);
  const suggestedCount = thermostatSuggestedVisibleZones(currentMappings);
  const visibleCount = Math.max(thermostatVisibleZones || 1, suggestedCount);
  thermostatVisibleZones = visibleCount;

  let html = `<div class="thermo-note"><strong>Thermostat mapping</strong><br>Use <strong>zones</strong> for the normal setup. Add only the zone sensors/outputs you need. <strong>Central Pump</strong> is optional and turns ON when any active zone calls. The <strong>Legacy</strong> section is only for classic single-zone compatibility.</div>`;
  html += `<div id="thermoCommissioningSummary"></div>`;

  html += `<details class="wizard-group" open>
    <summary>Shared outputs</summary>
    <div class="wizard-group-body">
      <div class="wizard-group-hint">Optional outputs that apply to the whole thermostat instance.</div>
      ${sharedDefs.map(inp => rowRenderer(inp, false, 'compact')).join('')}
    </div>
  </details>`;

  html += `<details class="wizard-group" open>
    <summary>Zones</summary>
    <div class="wizard-group-body">
      <div class="wizard-group-hint">Each zone can use a room sensor or thermostat call input, plus optional zone valve/relay and optional zone pump.</div>
      <div class="zone-toolbar">
        <div class="wizard-group-hint" style="margin:0">Showing ${visibleCount} of 6 zones.</div>
        <div class="zone-toolbar-actions">
          ${visibleCount < 6 ? `<button type="button" class="btn ghost" onclick="setThermostatVisibleZones(${visibleCount + 1})">+ Add Zone</button>` : ''}
          ${visibleCount > suggestedCount ? `<button type="button" class="btn ghost" onclick="setThermostatVisibleZones(${Math.max(1, suggestedCount)})">Hide Empty</button>` : ''}
          ${visibleCount < 6 ? `<button type="button" class="btn ghost" onclick="setThermostatVisibleZones(6)">Show All</button>` : ''}
        </div>
      </div>
      <div class="zone-grid">`;
  for (let i = 1; i <= visibleCount; i++) {
    const { defs, active, mappedCount } = thermostatZoneState(i, currentMappings);
    const badge = active ? `<span class="zone-badge active">active</span>` : `<span class="zone-badge">optional</span>`;
    html += `<div class="zone-card ${active ? 'active' : ''}">
      <div class="zone-head">
        <div>
          <div class="zone-title">Zone ${i}</div>
          <div class="zone-meta">sensor / thermostat • output • pump</div>
        </div>
        ${badge}
      </div>
      <div class="zone-hint">${mappedCount ? `${mappedCount} mapping${mappedCount === 1 ? '' : 's'} selected or suggested.` : 'Leave empty if this zone is not used.'}</div>
      ${defs.map(inp => rowRenderer(inp, false, 'compact')).join('')}
    </div>`;
  }
  html += `</div></div></details>`;

  html += `<details class="wizard-group">
    <summary>Legacy / single-zone compatibility</summary>
    <div class="wizard-group-body">
      <div class="wizard-group-hint">Keep these only for older single-zone thermostat setups. For new installs, prefer Zone 1 above.</div>
      ${legacyDefs.map(inp => rowRenderer(inp, false, 'compact')).join('')}
    </div>
  </details>`;

  return html;
}


// ── Instance cards ────────────────────────────────────────────────────────
// ── Extracted instance/setpoint rendering moved to /public/js/modules/core_ui.js ─────────────
async function selectDef(defId) {
  selectedDef = defs.find(d=>d.id===defId);
  if (!selectedDef) return;
  editingId = null;
  dynSlots = []; // reset dynamic slots for new module

  document.querySelectorAll(".def-card").forEach(c=>c.classList.remove("selected"));
  document.getElementById("def_"+defId)?.classList.add("selected");

  try {
    const s = await api(`/api/modules/suggest/${siteId}/${defId}`);
    suggestions = s.suggestions||{};
  } catch { suggestions={}; }

  document.getElementById("wizardTitle").textContent = `${selectedDef.icon} ${selectedDef.name}`;
  document.getElementById("wizardSub").textContent   = selectedDef.description;
  document.getElementById("wizardName").value        = selectedDef.name;
  document.getElementById("wizardSaveBtn").setAttribute("onclick","saveModule()");
  renderWizardInputs();

  const w = document.getElementById("wizard");
  w.classList.add("show");
  w.scrollIntoView({behavior:"smooth",block:"start"});
}

// Dynamic input slots state (for dynamic modules)
let dynSlots = []; // [{ key, prefix, label, type }]

function makeDynKey(prefix) {
  // Find a unique number — don't reuse numbers even if gaps exist
  const used = new Set(dynSlots.filter(s=>s.prefix===prefix).map(s=>{
    const n = parseInt(s.key.split('_').pop()); return isNaN(n)?0:n;
  }));
  let n = 1;
  while (used.has(n)) n++;
  return prefix + '_' + n;
}

// Capture current select values from DOM before re-rendering
function captureDomMappings() {
  const cur = Object.assign({}, _lastMappings||{});
  // Static inputs
  (selectedDef?.inputs||[]).forEach(inp => {
    const sel = document.getElementById('map_'+inp.key);
    if (sel?.value) cur[inp.key] = Number(sel.value);
    else if (sel) delete cur[inp.key];
  });
  // Dynamic slots
  dynSlots.forEach(s => {
    const sel = document.getElementById('map_'+s.key);
    if (sel?.value) cur[s.key] = Number(sel.value);
    else if (sel) delete cur[s.key];
  });
  return cur;
}

function addDynSlot(prefix) {
  const def = selectedDef;
  if (!def?.dynamic) return;
  const total = dynSlots.length;
  if (total >= (def.max_inputs||20)) { alert('Max '+(def.max_inputs||20)+' inputs reached'); return; }
  const tmpl = (def.input_templates||[]).find(t=>t.prefix===prefix);
  if (!tmpl) return;
  // Capture current state BEFORE re-render
  _lastMappings = captureDomMappings();
  const key = makeDynKey(prefix);
  dynSlots.push({ key, prefix, label: tmpl.label, type: tmpl.type, group: tmpl.group });
  renderWizardInputs(_lastMappings);
}

function removeDynSlot(key) {
  _lastMappings = captureDomMappings();
  dynSlots = dynSlots.filter(s=>s.key!==key);
  renderWizardInputs(_lastMappings);
}

let _lastMappings = {};

function renderWizardInputs(currentMappings={}) {
  _lastMappings = currentMappings;
  const sensors = siteIO.filter(e=>e.type==="sensor");
  const relays  = siteIO.filter(e=>e.type==="relay");
  const analog  = siteIO.filter(e=>["dimmer","ao","analog","pwm"].includes(e.type));
  const allIO   = siteIO;

  function pickList(t){
    if (t === "relay")  return { list: relays,  label: "relay"  };
    if (t === "sensor") return { list: sensors, label: "sensor" };
    if (t === "analog") return { list: analog,  label: "analog" };
    return { list: allIO, label: t||"io" };
  }

  function makeRow(input, isDynamic=false, rowClass="") {
    const p       = pickList(input.type);
    const opts    = p.list;
    const sug     = currentMappings[input.key] ?? suggestions[input.key];
    const fopts   = filterIOList(opts, mapIOQuery, mapZoneFilter, sug);

    const isAuto  = !currentMappings[input.key] && suggestions[input.key];
    const selOpts = ['<option value="">— '+p.label+' —</option>',
      ...fopts.map(e=>'<option value="'+e.id+'" '+(String(e.id)===String(sug)?"selected":"")+'>'+e.device_id+'·'+e.group_name+'.'+e.key+(e.name&&e.name!==e.key?' ('+e.name+')':'')+'</option>')
    ].join("");
    const isEnabled = input.required || !!currentMappings[input.key] || (!editingId && !!suggestions[input.key]);
    return '<div class="input-row" id="irow_'+input.key+'" style="'+((!input.required && !isEnabled && !isDynamic) ? "opacity:.5" : "")+'">'+
      '<div>'+
      '<div class="input-label">'+
      (!input.required && !isDynamic ? '<input type="checkbox" id="toggle_'+input.key+'" '+(isEnabled?'checked':'')+' onchange="toggleOptInput(this,\''+input.key+'\')" style="margin-right:5px;cursor:pointer;vertical-align:middle">' : '')+
      input.label+
      (input.required ? '<span class="req">*</span>' : "")+
      (isAuto ? '<span class="match-badge auto">auto</span>' : "")+
      (isDynamic ? '<button data-key="'+input.key+'" onclick="removeDynSlot(this.dataset.key)" style="margin-left:8px;background:rgba(255,69,69,.15);border:1px solid rgba(255,69,69,.3);color:#ff6b6b;border-radius:4px;padding:1px 7px;font-size:10px;cursor:pointer">✕</button>' : '')+
      '</div>'+
      '<div class="input-type">'+input.type+(input.unit?' · '+input.unit:'')+' · key:'+input.key+'</div>'+
      '</div>'+
      '<select class="map-sel '+(isAuto?"auto-matched":"")+'" id="map_'+input.key+'"'+
      ((!input.required && !isEnabled && !isDynamic) ? " disabled" : "")+
      ' onchange="this.classList.remove(\'auto-matched\'); onWizardMapChanged()">'+selOpts+'</select>'+
      '</div>';
  }

  const isDyn = !!(selectedDef?.dynamic);

  if (isDyn) {
    // Dynamic module: render existing dynSlots + add buttons per template
    const groups = {};
    dynSlots.forEach(s => {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    });

    const templates = selectedDef.input_templates || [];
    const outputTmpl = templates.filter(t=>t.group==='outputs');
    const inputTmpl  = templates.filter(t=>t.group==='inputs');

    let html = '';

    // Outputs section
    if (outputTmpl.length) {
      html += '<div style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">Outputs</div>';
      (groups['outputs']||[]).forEach(s => { html += makeRow({key:s.key,label:s.label,type:s.type,required:false}, true); });
      html += '<div style="display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap">';
      outputTmpl.forEach(t => {
        html += '<button data-prefix="'+t.prefix+'" onclick="addDynSlot(this.dataset.prefix)" style="font-size:11px;padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--muted2);cursor:pointer">+ '+t.label+'</button>';
      });
      html += '</div>';
    }

    // Inputs section
    if (inputTmpl.length) {
      html += '<div style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">Inputs / Sensors</div>';
      (groups['inputs']||[]).forEach(s => { html += makeRow({key:s.key,label:s.label,type:s.type,required:false}, true); });
      html += '<div style="display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap">';
      inputTmpl.forEach(t => {
        html += '<button data-prefix="'+t.prefix+'" onclick="addDynSlot(this.dataset.prefix)" style="font-size:11px;padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--muted2);cursor:pointer">+ '+t.label+'</button>';
      });
      html += '</div>';
    }

    if (!dynSlots.length) {
      html += '<div style="color:var(--muted);font-size:12px;padding:8px 0">Use the buttons above to add inputs and outputs.</div>';
    }

    const modSummaryBox = ModuleRegistry[selectedDef?.id]?.summaryBoxId;
    document.getElementById("wizardInputs").innerHTML = (modSummaryBox ? '<div id="'+modSummaryBox+'"></div>' : '') + html;
    if (modSummaryBox) ModuleRegistry[selectedDef?.id].updateCommissioningSummary(buildEffectiveMappings(currentMappings));
  } else {
    if (selectedDef?.id === 'thermostat') {
      thermostatVisibleZones = thermostatSuggestedVisibleZones(currentMappings);
      renderThermostatWizardIntoDom(currentMappings, makeRow);
    } else if (ModuleRegistry[selectedDef?.id]?.renderWizardInputs) {
      ModuleRegistry[selectedDef?.id].renderWizardInputs(currentMappings, makeRow);
    } else {
      const modSummaryBox = ModuleRegistry[selectedDef?.id]?.summaryBoxId;
      const rows = (selectedDef?.inputs||[]).map(input => makeRow(input, false)).join("");
      document.getElementById("wizardInputs").innerHTML = (modSummaryBox ? '<div id="'+modSummaryBox+'"></div>' : '') + rows;
      if (modSummaryBox) ModuleRegistry[selectedDef?.id].updateCommissioningSummary(buildEffectiveMappings(currentMappings));
    }
  }
}

function onWizardMapChanged() {
  ModuleRegistry[selectedDef?.id]?.updateCommissioningSummary?.();
}
function cancelWizard() {
  document.getElementById("wizard").classList.remove("show");
  document.querySelectorAll(".def-card").forEach(c=>c.classList.remove("selected"));
  selectedDef=null; editingId=null;
}
function toggleOptInput(checkbox, key) {
  const enabled = checkbox.checked;
  const row = document.getElementById("irow_" + key);
  const sel = document.getElementById("map_"  + key);
  if (!sel) return;

  sel.disabled      = !enabled;
  sel.style.opacity = enabled ? "" : "0.5";
  if (row) row.style.opacity = enabled ? "" : "0.5";

  // If unchecked → clear the selection so no mapping is sent
  if (!enabled) sel.value = "";
  onWizardMapChanged();
}

async function saveModule(existingId=null) {
  const id   = existingId || editingId;
  const name = document.getElementById("wizardName").value.trim() || selectedDef.name;
  const mappings = {};
  // Static inputs
  (selectedDef?.inputs||[]).forEach(input=>{
    const sel = document.getElementById("map_"+input.key);
    if (sel?.value) mappings[input.key] = Number(sel.value);
    else if (id) mappings[input.key] = 0; // explicitly remove when editing
  });
  // Dynamic inputs (smart_lighting, engineering rules)
  if (selectedDef?.dynamic) {
    dynSlots.forEach(slot => {
      const sel = document.getElementById("map_"+slot.key);
      if (sel?.value) mappings[slot.key] = Number(sel.value);
    });
  }
  if (selectedDef?.id === 'thermostat') {
    const analysis = analyzeThermostatMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${i.message.replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Thermostat commissioning warnings:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'lighting') {
    const analysis = analyzeLightingMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Lighting commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'solar') {
    const analysis = analyzeSolarMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Solar commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'energy') {
    const analysis = analyzeEnergyMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Energy Monitor commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'smart_lighting') {
    const analysis = analyzeSmartLightingMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Smart Lighting commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'load_shifter') {
    const analysis = analyzeLoadShifterMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Load Shifter commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'presence_simulator') {
    const analysis = analyzePresenceMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Presence Simulator commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'irrigation') {
    const analysis = analyzeIrrigationMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Irrigation commissioning check:

${msg}

Save anyway?`)) return;
    }
  } else if (selectedDef?.id === 'pool_spa') {
  const analysis = analyzePoolSpaMappings(mappings);
  const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
  if (blockingWarnings.length) {
    const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
    if (!confirm(`Pool & Spa commissioning check:

${msg}

Save anyway?`)) return;
	}
  }else if (selectedDef?.id === 'hydronic_manager') {
    const analysis = analyzeHydronicMappings(mappings);
    const blockingWarnings = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
    if (blockingWarnings.length) {
      const msg = blockingWarnings.map(i => `• ${String(i.message).replace(/<[^>]+>/g,'')}`).join('\n');
      if (!confirm(`Hydronic commissioning check:

${msg}

Save anyway?`)) return;
    }
  }
  try {
    if (id) {
      await api(`/api/modules/instances/${id}/mappings`,{method:"PATCH",body:JSON.stringify({mappings})});
      toast("✓ Module updated");
    } else {
      await api("/api/modules/instances",{method:"POST",body:JSON.stringify({site_id:siteId,module_id:selectedDef.id,name,mappings})});
      toast("✓ Module added");
    }
    cancelWizard();
    await loadInstances();
  } catch(e) { toast("Error: "+e.message,"err"); }
}

async function editInstance(id) {
  const inst = instances.find(i=>i.id===id);
  if (!inst) return;
  selectedDef = defs.find(d=>d.id===inst.module_id);
  if (!selectedDef) return;
  editingId = id;

  const curMap = {};
  (inst.mappings||[]).forEach(m=>{ if(m.io_id) curMap[m.input_key]=m.io_id; });

  // For dynamic modules, restore dynSlots from existing mappings
  dynSlots = [];
  const def2 = defs.find(d=>d.id===inst.module_id);
  thermostatVisibleZones = thermostatSuggestedVisibleZones(curMap);
  if (def2?.dynamic) {
    const tmpls = def2.input_templates || [];
    (inst.mappings||[]).forEach(m => {
      const tmpl = tmpls.find(t => m.input_key.startsWith(t.prefix+'_') || m.input_key === t.prefix);
      if (tmpl) dynSlots.push({ key: m.input_key, prefix: tmpl.prefix, label: tmpl.label, type: tmpl.type, group: tmpl.group });
    });
  }
  try {
    const s = await api(`/api/modules/suggest/${siteId}/${selectedDef.id}`);
    suggestions = s.suggestions||{};
  } catch { suggestions={}; }

  document.getElementById("wizardTitle").textContent = `✎ ${selectedDef.icon} ${inst.name}`;
  document.getElementById("wizardSub").textContent   = "Edit input mappings";
  document.getElementById("wizardName").value        = inst.name;
  document.getElementById("wizardSaveBtn").setAttribute("onclick",`saveModule(${id})`);

  document.querySelectorAll(".def-card").forEach(c=>c.classList.remove("selected"));
  renderWizardInputs(curMap);

  const w = document.getElementById("wizard");
  w.classList.add("show");
  w.scrollIntoView({behavior:"smooth",block:"start"});
}

async function deleteInstance(id, name) {
  if (!confirm(`Delete module "${name}"?`)) return;
  try {
    await api(`/api/modules/instances/${id}`,{method:"DELETE"});
    toast(`✓ "${name}" deleted`);
    await loadInstances();
  } catch(e) { toast("Error: "+e.message,"err"); }
}

async function loadInstances() {
  const d  = await api("/api/modules/instances" + (siteId ? ('?site_id=' + encodeURIComponent(siteId)) : '')); 
  instances = d.instances||[];
  renderInstances();
}

// ── Boot ──────────────────────────────────────────────────────────────────
