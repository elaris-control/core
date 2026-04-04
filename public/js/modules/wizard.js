// public/js/modules/wizard.js
// Wizard state, dynamic inputs, save/edit/delete for Modules page.
// This is the SINGLE SOURCE OF TRUTH — modules.html inline script MUST be removed.

// ── State ─────────────────────────────────────────────────────────────────
let defs = [], instances = [], siteIO = [], siteId = null, selectedDef = null, suggestions = {};
let mapIOQuery = "", mapZoneFilter = "";
let ruleIOQuery = "", ruleZoneFilter = "";
let activeCat = "all", editingId = null;
let ruleTestValues = {}, ruleTestClock = "", ruleTestWeekday = "", ruleLiveValues = {}, ruleLastTestContext = null;
let thermostatVisibleZones = 1;
let dynSlots = [];
let _lastMappings = {};

// ── Helpers ───────────────────────────────────────────────────────────────
function moduleSettingsEndpoint(instOrId) {
  const id = typeof instOrId === "object" ? instOrId?.id : instOrId;
  return `/automation/settings/${id}`;
}

function moduleLogEndpoint(instOrId) {
  const id = typeof instOrId === "object" ? instOrId?.id : instOrId;
  return `/automation/log/${id}`;
}

function getMapDisplayValue(map) {
  return map?.io_name || (map?.io_key ? `${map.group_name}.${map.io_key}` : null);
}

function stateOn(v) {
  return v === true || v === 1 || v === "1" || String(v || "").toUpperCase() === "ON" || String(v || "").toUpperCase() === "TRUE";
}

function ioLabelById(ioId) {
  const io = siteIO.find(x => Number(x.id) === Number(ioId));
  if (!io) return `IO ${Number(ioId)}`;
  return escapeHTML(`${io.device_id}\u00B7${io.group_name}.${io.key}`) + (io.name && io.name !== io.key ? ` (${escapeHTML(io.name)})` : '');
}

function ioFriendlyLabel(ioId) {
  const io = siteIO.find(x => Number(x.id) === Number(ioId));
  if (!io) return `IO ${Number(ioId)}`;
  return escapeHTML(io.name && io.name !== io.key ? io.name : io.key);
}

function filterIOList(list, query, zoneFilter, suggestedValue) {
  if (!query && !zoneFilter) return list;
  let result = list;
  if (zoneFilter) {
    result = result.filter(e => String(e.zone_id) === String(zoneFilter));
  }
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(e =>
      (e.device_id || '').toLowerCase().includes(q) ||
      (e.key || '').toLowerCase().includes(q) ||
      (e.name || '').toLowerCase().includes(q) ||
      (e.group_name || '').toLowerCase().includes(q)
    );
  }
  if (suggestedValue && !result.some(e => Number(e.id) === Number(suggestedValue))) {
    const sug = siteIO.find(x => Number(x.id) === Number(suggestedValue));
    if (sug) result = [sug, ...result];
  }
  return result;
}

function refreshIOFilterSelects() {
  const sel = document.getElementById("mapZoneFilterSelect");
  if (!sel) return;
  const zones = new Map();
  siteIO.forEach(e => {
    if (e.zone_id && e.zone_name) zones.set(String(e.zone_id), e.zone_name);
  });
  const current = sel.value;
  sel.innerHTML = '<option value="">All zones</option>' +
    [...zones.entries()].map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`).join('');
  sel.value = current;
}

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

// ── Dynamic slots ─────────────────────────────────────────────────────────
function makeDynKey(prefix) {
  const used = new Set(dynSlots.filter(s => s.prefix === prefix).map(s => {
    const n = parseInt(s.key.split('_').pop()); return isNaN(n) ? 0 : n;
  }));
  let n = 1;
  while (used.has(n)) n++;
  return prefix + '_' + n;
}

function captureDomMappings() {
  const cur = Object.assign({}, _lastMappings || {});
  (selectedDef?.inputs || []).forEach(inp => {
    const sel = document.getElementById('map_' + inp.key);
    if (sel?.value) cur[inp.key] = Number(sel.value);
    else if (sel) delete cur[inp.key];
  });
  dynSlots.forEach(s => {
    const sel = document.getElementById('map_' + s.key);
    if (sel?.value) cur[s.key] = Number(sel.value);
    else if (sel) delete cur[s.key];
  });
  return cur;
}

function addDynSlot(prefix) {
  const def = selectedDef;
  if (!def?.dynamic) return;
  if (dynSlots.length >= (def.max_inputs || 20)) { alert('Max ' + (def.max_inputs || 20) + ' inputs reached'); return; }
  const tmpl = (def.input_templates || []).find(t => t.prefix === prefix);
  if (!tmpl) return;
  _lastMappings = captureDomMappings();
  const key = makeDynKey(prefix);
  dynSlots.push({ key, prefix, label: tmpl.label, type: tmpl.type, group: tmpl.group });
  renderWizardInputs(_lastMappings);
}

function removeDynSlot(key) {
  _lastMappings = captureDomMappings();
  dynSlots = dynSlots.filter(s => s.key !== key);
  renderWizardInputs(_lastMappings);
}

// ── Thermostat wizard helpers ─────────────────────────────────────────────
function thermostatSuggestedVisibleZones(currentMappings) {
  let count = 0;
  for (let i = 1; i <= 6; i++) {
    if (currentMappings[`zone_${i}_temp`] || currentMappings[`zone_${i}_call`] ||
        currentMappings[`zone_${i}_output`] || currentMappings[`zone_${i}_pump`]) {
      count = i;
    }
  }
  return count || 1;
}

function thermostatZoneState(zoneNum, currentMappings) {
  const keys = [`zone_${zoneNum}_temp`, `zone_${zoneNum}_call`, `zone_${zoneNum}_output`, `zone_${zoneNum}_pump`];
  const zoneDefs = keys.map(k => (selectedDef?.inputs || []).find(i => i.key === k)).filter(Boolean);
  const mappedCount = keys.filter(k => currentMappings[k]).length;
  return { defs: zoneDefs, active: mappedCount > 0, mappedCount };
}

function setThermostatVisibleZones(n) {
  thermostatVisibleZones = Math.max(1, Math.min(6, n));
  renderWizardInputs(_lastMappings || {});
}

function renderThermostatWizardIntoDom(currentMappings, rowRenderer) {
  const legacyDefs = ['temp_room', 'ac_relay', 'temp_outdoor']
    .map(key => (selectedDef?.inputs || []).find(inp => inp.key === key)).filter(Boolean);
  const sharedDefs = ['central_pump']
    .map(key => (selectedDef?.inputs || []).find(inp => inp.key === key)).filter(Boolean);
  const suggestedCount = thermostatSuggestedVisibleZones(currentMappings);
  const visibleCount = editingId ? (thermostatVisibleZones || 1) : Math.max(thermostatVisibleZones || 1, suggestedCount);
  thermostatVisibleZones = visibleCount;

  let html = `<div class="thermo-note"><strong>Thermostat mapping</strong><br>Use <strong>zones</strong> for the normal setup. Add only the zone sensors/outputs you need. <strong>Central Pump</strong> is optional. The <strong>Legacy</strong> section is for classic single-zone compatibility.</div>`;
  const summaryBoxId = ModuleRegistry[selectedDef?.id]?.summaryBoxId;
  if (summaryBoxId) html += `<div id="${summaryBoxId}"></div>`;

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
    const { defs: zDefs, active, mappedCount } = thermostatZoneState(i, currentMappings);
    const badge = active ? `<span class="zone-badge active">active</span>` : `<span class="zone-badge">optional</span>`;
    html += `<div class="zone-card ${active ? 'active' : ''}">
      <div class="zone-head">
        <div>
          <div class="zone-title">Zone ${i}</div>
          <div class="zone-meta">sensor / thermostat \u2022 output \u2022 pump</div>
        </div>
        ${badge}
      </div>
      <div class="zone-hint">${mappedCount ? `${mappedCount} mapping${mappedCount === 1 ? '' : 's'} selected or suggested.` : 'Leave empty if this zone is not used.'}</div>
      ${zDefs.map(inp => rowRenderer(inp, false, 'compact')).join('')}
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

  document.getElementById("wizardInputs").innerHTML = html;
  if (summaryBoxId) {
    ModuleRegistry[selectedDef?.id]?.updateCommissioningSummary?.(buildEffectiveMappings(currentMappings));
  }
}

// ── renderWizardInputs ───────────────────────────────────────────────────
function renderWizardInputs(currentMappings = {}) {
  _lastMappings = currentMappings;
  const sensors = siteIO.filter(e => e.type === "sensor");
  const relays = siteIO.filter(e => e.type === "relay");
  const analog = siteIO.filter(e => ["dimmer", "ao", "analog", "pwm"].includes(e.type));
  const allIO = siteIO;

  function pickList(t) {
    if (t === "relay") return { list: relays, label: "relay" };
    if (t === "sensor") return { list: sensors, label: "sensor" };
    if (t === "analog") return { list: analog, label: "analog" };
    return { list: allIO, label: t || "io" };
  }

  function makeRow(input, isDynamic = false, rowClass = "") {
    const p = pickList(input.type);
    const opts = p.list;
    const suggestedValue = !editingId ? suggestions[input.key] : null;
    const sug = currentMappings[input.key] ?? suggestedValue;
    const fopts = filterIOList(opts, mapIOQuery, mapZoneFilter, sug);

    const isAuto = !editingId && !currentMappings[input.key] && suggestions[input.key];
    const selOpts = ['<option value="">\u2014 ' + p.label + ' \u2014</option>',
      ...fopts.map(e => '<option value="' + escHtml(e.id) + '" ' + (String(e.id) === String(sug) ? "selected" : "") + '>' + escHtml(e.device_id) + '\u00B7' + escHtml(e.group_name) + '.' + escHtml(e.key) + (e.name && e.name !== e.key ? ' (' + escHtml(e.name) + ')' : '') + '</option>')
    ].join("");
    const isEnabled = input.required || !!currentMappings[input.key] || (!editingId && !!suggestions[input.key]);
    return '<div class="input-row" id="irow_' + input.key + '" style="' + ((!input.required && !isEnabled && !isDynamic) ? "opacity:.5" : "") + '">' +
      '<div>' +
      '<div class="input-label">' +
      (!input.required && !isDynamic ? '<input type="checkbox" id="toggle_' + input.key + '" ' + (isEnabled ? 'checked' : '') + ' onchange="toggleOptInput(this,\'' + input.key + '\')" style="margin-right:5px;cursor:pointer;vertical-align:middle">' : '') +
      input.label +
      (input.required ? '<span class="req">*</span>' : "") +
      (isAuto ? '<span class="match-badge auto">auto</span>' : "") +
      (isDynamic ? '<button data-key="' + input.key + '" onclick="removeDynSlot(this.dataset.key)" style="margin-left:8px;background:rgba(255,69,69,.15);border:1px solid rgba(255,69,69,.3);color:#ff6b6b;border-radius:4px;padding:1px 7px;font-size:10px;cursor:pointer">\u2715</button>' : '') +
      '</div>' +
      '<div class="input-type">' + input.type + (input.unit ? ' \u00B7 ' + input.unit : '') + ' \u00B7 key:' + input.key + '</div>' +
      '</div>' +
      '<select class="map-sel ' + (isAuto ? "auto-matched" : "") + '" id="map_' + input.key + '"' +
      ((!input.required && !isEnabled && !isDynamic) ? " disabled" : "") +
      ' onchange="this.classList.remove(\'auto-matched\'); onWizardMapChanged()">' + selOpts + '</select>' +
      '</div>';
  }

  const isDyn = !!(selectedDef?.dynamic);

  if (isDyn) {
    const groups = {};
    dynSlots.forEach(s => {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    });

    const templates = selectedDef.input_templates || [];
    const outputTmpl = templates.filter(t => t.group === 'outputs');
    const inputTmpl = templates.filter(t => t.group === 'inputs');

    let html = '';

    if (outputTmpl.length) {
      html += '<div style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">Outputs</div>';
      (groups['outputs'] || []).forEach(s => { html += makeRow({ key: s.key, label: s.label, type: s.type, required: false }, true); });
      html += '<div style="display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap">';
      outputTmpl.forEach(t => {
        html += '<button data-prefix="' + t.prefix + '" onclick="addDynSlot(this.dataset.prefix)" style="font-size:11px;padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--muted2);cursor:pointer">+ ' + t.label + '</button>';
      });
      html += '</div>';
    }

    if (inputTmpl.length) {
      html += '<div style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">Inputs / Sensors</div>';
      (groups['inputs'] || []).forEach(s => { html += makeRow({ key: s.key, label: s.label, type: s.type, required: false }, true); });
      html += '<div style="display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap">';
      inputTmpl.forEach(t => {
        html += '<button data-prefix="' + t.prefix + '" onclick="addDynSlot(this.dataset.prefix)" style="font-size:11px;padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--muted2);cursor:pointer">+ ' + t.label + '</button>';
      });
      html += '</div>';
    }

    if (!dynSlots.length) {
      html += '<div style="color:var(--muted);font-size:12px;padding:8px 0">Use the buttons above to add inputs and outputs.</div>';
    }

    const modSummaryBox = ModuleRegistry[selectedDef?.id]?.summaryBoxId;
    document.getElementById("wizardInputs").innerHTML = (modSummaryBox ? '<div id="' + modSummaryBox + '"></div>' : '') + html;
    if (modSummaryBox) ModuleRegistry[selectedDef?.id].updateCommissioningSummary(buildEffectiveMappings(currentMappings));
  } else {
    if (selectedDef?.id === 'thermostat' || selectedDef?.id === 'zoned_thermostat') {
      renderThermostatWizardIntoDom(currentMappings, makeRow);
    } else if (ModuleRegistry[selectedDef?.id]?.renderWizardInputs) {
      ModuleRegistry[selectedDef?.id].renderWizardInputs(currentMappings, makeRow);
    } else {
      const modSummaryBox = ModuleRegistry[selectedDef?.id]?.summaryBoxId;
      const rows = (selectedDef?.inputs || []).map(input => makeRow(input, false)).join("");
      document.getElementById("wizardInputs").innerHTML = (modSummaryBox ? '<div id="' + modSummaryBox + '"></div>' : '') + rows;
      if (modSummaryBox) ModuleRegistry[selectedDef?.id].updateCommissioningSummary(buildEffectiveMappings(currentMappings));
    }
  }
}

function onWizardMapChanged() {
  ModuleRegistry[selectedDef?.id]?.updateCommissioningSummary?.();
}

// ── Wizard actions ────────────────────────────────────────────────────────
function cancelWizard() {
  document.getElementById("wizard").classList.remove("show");
  document.querySelectorAll(".def-card").forEach(c => c.classList.remove("selected"));
  selectedDef = null; editingId = null;
}

function toggleOptInput(checkbox, key) {
  const enabled = checkbox.checked;
  const row = document.getElementById("irow_" + key);
  const sel = document.getElementById("map_" + key);
  if (!sel) return;
  sel.disabled = !enabled;
  sel.style.opacity = enabled ? "" : "0.5";
  if (row) row.style.opacity = enabled ? "" : "0.5";
  if (!enabled) sel.value = "";
  onWizardMapChanged();
}

async function selectDef(defId) {
  selectedDef = defs.find(d => d.id === defId);
  if (!selectedDef) return;
  editingId = null;
  dynSlots = [];

  document.querySelectorAll(".def-card").forEach(c => c.classList.remove("selected"));
  document.getElementById("def_" + defId)?.classList.add("selected");

  try {
    const s = await api(`/modules/suggest/${siteId}/${defId}`);
    suggestions = s.suggestions || {};
  } catch { suggestions = {}; }

  document.getElementById("wizardTitle").textContent = `${selectedDef.icon} ${selectedDef.name}`;
  document.getElementById("wizardSub").textContent = selectedDef.description;
  document.getElementById("wizardName").value = selectedDef.name;
  document.getElementById("wizardSaveBtn").setAttribute("onclick", "saveModule()");
  renderWizardInputs();

  const w = document.getElementById("wizard");
  w.classList.add("show");
  w.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveModule(existingId = null) {
  const id = existingId || editingId;
  const name = document.getElementById("wizardName").value.trim() || selectedDef.name;
  const mappings = {};

  // Static inputs
  (selectedDef?.inputs || []).forEach(input => {
    const sel = document.getElementById("map_" + input.key);
    if (sel && !sel.disabled && sel.value) mappings[input.key] = Number(sel.value);
    else if (id && sel) mappings[input.key] = 0;
  });

  // Dynamic inputs
  if (selectedDef?.dynamic) {
    dynSlots.forEach(slot => {
      const sel = document.getElementById("map_" + slot.key);
      if (sel && !sel.disabled && sel.value) mappings[slot.key] = Number(sel.value);
      else if (id && sel) mappings[slot.key] = 0;
    });
  }

  // Commissioning check — data-driven via COMMISSIONING_REGISTRY
  const commissioningResult = runCommissioningCheck(selectedDef?.id, mappings);
  if (commissioningResult === false) return;

  try {
    if (id) {
      await api(`/modules/instances/${id}/mappings`, { method: "PATCH", body: JSON.stringify({ name, mappings }) });
      toast("Module updated", true);
    } else {
      await api("/modules/instances", { method: "POST", body: JSON.stringify({ site_id: siteId, module_id: selectedDef.id, name, mappings }) });
      toast("Module added", true);
    }
    cancelWizard();
    await loadInstances();
  } catch (e) { toast("Error: " + e.message, false); }
}

async function editInstance(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  selectedDef = defs.find(d => d.id === inst.module_id);
  if (!selectedDef) return;
  editingId = id;

  const curMap = {};
  (inst.mappings || []).forEach(m => { if (m.io_id) curMap[m.input_key] = m.io_id; });

  // Restore dynSlots from existing mappings
  dynSlots = [];
  const def2 = defs.find(d => d.id === inst.module_id);
  thermostatVisibleZones = thermostatSuggestedVisibleZones(curMap);
  if (def2?.dynamic) {
    const tmpls = def2.input_templates || [];
    (inst.mappings || []).forEach(m => {
      const tmpl = tmpls.find(t => m.input_key.startsWith(t.prefix + '_') || m.input_key === t.prefix);
      if (tmpl) dynSlots.push({ key: m.input_key, prefix: tmpl.prefix, label: tmpl.label, type: tmpl.type, group: tmpl.group });
    });
  }
  try {
    const s = await api(`/modules/suggest/${siteId}/${selectedDef.id}`);
    suggestions = s.suggestions || {};
  } catch { suggestions = {}; }

  document.getElementById("wizardTitle").textContent = `\u270E ${selectedDef.icon} ${inst.name}`;
  document.getElementById("wizardSub").textContent = "Edit input mappings";
  document.getElementById("wizardName").value = inst.name;
  document.getElementById("wizardSaveBtn").setAttribute("onclick", `saveModule(${id})`);

  document.querySelectorAll(".def-card").forEach(c => c.classList.remove("selected"));
  renderWizardInputs(curMap);

  const w = document.getElementById("wizard");
  w.classList.add("show");
  w.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteInstance(id, name) {
  if (!confirm(`Delete module "${name}"?`)) return;
  try {
    await api(`/modules/instances/${id}`, { method: "DELETE" });
    toast(`"${name}" deleted`, true);
    await loadInstances();
  } catch (e) { toast("Error: " + e.message, false); }
}

async function loadInstances() {
  const d = await api("/modules/instances" + (siteId ? ('?site_id=' + encodeURIComponent(siteId)) : ''));
  instances = d.instances || [];
  renderInstances();
}

// ── Instance card rendering ───────────────────────────────────────────────
function renderInstanceMapRows(inst, def, maps) {
  if (inst?.module_id === 'thermostat' && def) {
    const byKey = (key) => maps.find(x => x.input_key === key);
    const compactValue = (key) => getMapDisplayValue(byKey(key));
    const compactParts = [];
    const zoneSummaries = [];
    const liveValues = inst?._liveStatus?.values || {};

    const centralVal = compactValue('central_pump');
    if (centralVal) {
      const centralLive = stateOn(liveValues.central_pump);
      const centralDisplay = renderCompactBadge('map', centralVal) + renderCompactBadge('live', centralLive ? 'ON' : 'OFF', centralLive ? 'live-on' : 'live-off');
      compactParts.push(renderMapItem('Central Pump', centralDisplay, 'central_pump', { rich: true }));
    }

    const legacyKeys = ['temp_room', 'ac_relay', 'temp_outdoor'];
    const legacyPairs = legacyKeys.map(key => {
      const input = (def.inputs || []).find(i => i.key === key);
      const val = compactValue(key);
      return val ? `${input?.short_label || input?.label || key}: ${val}` : null;
    }).filter(Boolean);

    let activeZoneCount = 0;
    for (let i = 1; i <= 6; i++) {
      const tempVal = compactValue(`zone_${i}_temp`);
      const callVal = compactValue(`zone_${i}_call`);
      const outVal = compactValue(`zone_${i}_output`);
      const pumpVal = compactValue(`zone_${i}_pump`);
      const pieces = [];
      if (tempVal) pieces.push(renderCompactBadge('temp', tempVal));
      if (callVal) pieces.push(renderCompactBadge('call', callVal));
      if (outVal) pieces.push(renderCompactBadge('out', outVal));
      if (pumpVal) pieces.push(renderCompactBadge('pump', pumpVal));
      if (pieces.length) {
        activeZoneCount += 1;
        zoneSummaries.push(renderMapItem(`Zone ${i}`, pieces.join(''), `zone_${i}`, { rich: true }));
      }
    }

    if (activeZoneCount) {
      compactParts.unshift(renderMapItem('Configured Zones', String(activeZoneCount), 'zones_count'));
    }

    const fullSections = [];
    if (centralVal) {
      const centralLive = stateOn(liveValues.central_pump);
      const centralFull = renderCompactBadge('map', centralVal) + renderCompactBadge('live', centralLive ? 'ON' : 'OFF', centralLive ? 'live-on' : 'live-off');
      fullSections.push(`<div class="sp-title" style="margin-bottom:6px">Shared</div>${renderMapItem('Central Pump', centralFull, 'central_pump', { rich: true })}`);
    }
    if (legacyPairs.length) {
      const legacyRows = legacyKeys.map(key => {
        const input = (def.inputs || []).find(i => i.key === key);
        const val = compactValue(key);
        if (!val) return '';
        return renderMapItem(input?.label || key, val, key);
      }).filter(Boolean).join('');
      fullSections.push(`<div class="sp-title" style="margin:10px 0 6px">Legacy / Single Zone</div>${legacyRows}`);
    }
    if (zoneSummaries.length) {
      const zoneGroups = [];
      for (let i = 1; i <= 6; i++) {
        const zoneKeys = [`zone_${i}_temp`, `zone_${i}_call`, `zone_${i}_output`, `zone_${i}_pump`];
        const rows = zoneKeys.map(key => {
          const input = (def.inputs || []).find(inp => inp.key === key);
          const val = compactValue(key);
          if (!val) return '';
          return renderMapItem(input?.label || key, val, key);
        }).filter(Boolean).join('');
        if (rows) zoneGroups.push(`<div class="sp-title" style="margin:10px 0 6px">Zone ${i}</div>${rows}`);
      }
      fullSections.push(zoneGroups.join(''));
    }

    const summaryHtml = [
      ...compactParts,
      ...zoneSummaries,
      ...(legacyPairs.length && !activeZoneCount ? [renderMapItem('Legacy', legacyPairs.join(' \u2022 '), 'legacy')] : [])
    ].join('');

    if (summaryHtml) {
      const detailsHtml = fullSections.length ? `
        <details class="thermo-compact-details" style="margin-top:8px">
          <summary style="cursor:pointer;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase">Show full mappings</summary>
          <div style="margin-top:8px">${fullSections.join('')}</div>
        </details>` : '';
      return `${summaryHtml}${detailsHtml}`;
    }
  }

  const mapInputs = (def?.dynamic && maps.length)
    ? maps.map(m => ({ key: m.input_key }))
    : (def?.inputs || []);
  return mapInputs.map(input => {
    const m = maps.find(x => x.input_key === input.key);
    const val = getMapDisplayValue(m);
    return renderMapItem(input.label || input.key, val, input.key);
  }).join("");
}

function renderCompactBadge(label, value, extraClass = "") {
  return `<span class="compact-badge ${escapeHTML(extraClass)}"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></span>`;
}

function renderMapItem(label, value, key, opts = {}) {
  const rich = !!opts.rich;
  const cls = `map-val ${value ? "" : "unmapped"}${rich ? " rich" : ""}`;
  return `<div class="map-item">
    <span class="map-key">${escapeHTML(label || key || '')}</span>
    <span class="${cls}">${value || "\u2014 not set \u2014"}</span>
  </div>`;
}

function renderInstances() {
  const grid = document.getElementById("instGrid");
  const count = document.getElementById("instCount");
  count.textContent = instances.length ? `(${instances.length})` : "";

  if (!instances.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">\uD83D\uDCE6</div><div class="empty-text">No modules added yet.</div></div>`;
    return;
  }

  grid.innerHTML = instances.map(inst => {
    const def = inst.definition;
    const color = def?.color || "var(--blue)";
    const maps = inst.mappings || [];
    const hasAuto = !!(ModuleRegistry[inst.module_id]?.hasAuto);

    const mapRows = renderInstanceMapRows(inst, def, maps);

    return `
    <div class="inst-card" style="--card-accent:${color}">
      <div class="inst-header">
        <div class="inst-icon-name">
          <div class="inst-icon">${def?.icon || "\uD83D\uDCE6"}</div>
          <div>
            <div class="inst-name">${escapeHTML(inst.name || '')}
              ${hasAuto ? `<span class="auto-badge running" id="badge_${inst.id}">\u26A1 auto</span>` : ""}
            </div>
            <div class="inst-module-label">${escapeHTML(def?.name || inst.module_id || '')}</div>
          </div>
        </div>
        <div class="inst-actions">
          <button class="btn btn-sm" onclick="editInstance(${inst.id})">\u270E</button>
          <button class="btn btn-sm btn-danger" onclick="deleteInstance(${Number(inst.id)},${escapeHTML(JSON.stringify(String(inst.name || '')))})">\u2715</button>
        </div>
      </div>
      <div class="map-list" id="maps_${inst.id}">${mapRows}</div>
      <div id="sp_${inst.id}"><div style="color:var(--muted);font-size:11px;padding:6px 0">Loading\u2026</div></div>
      <div id="log_${inst.id}"></div>
    </div>`;
  }).join("");

  instances.forEach(inst => enrichCard(inst));
}

async function enrichCard(inst) {
  const def = inst.definition;
  if (!def?.setpoints?.length && !ModuleRegistry[inst.module_id]?.enrichCard) {
    document.getElementById(`sp_${inst.id}`).innerHTML = "";
    return;
  }

  let settings = {};
  try {
    const d = await api(moduleSettingsEndpoint(inst));
    settings = d.settings || d.setpoints || {};
  } catch {}

  const spEl = document.getElementById(`sp_${inst.id}`);
  if (!spEl) return;

  try {
    inst._liveStatus = await api(`/automation/status/${inst.id}`);
  } catch {}
  if (inst.module_id === 'solar') {
    try { inst._liveStatus = await api(`/automation/solar/${inst.id}/status`); } catch {}
  }
  try {
    const mapsEl = document.getElementById(`maps_${inst.id}`);
    if (mapsEl) mapsEl.innerHTML = renderInstanceMapRows(inst, def, inst.mappings || []);
  } catch {}

  if (ModuleRegistry[inst.module_id]?.enrichCard) {
    await ModuleRegistry[inst.module_id].enrichCard(inst, settings, spEl);
  } else if (def?.setpoints?.length) {
    const mappedKeys = new Set(
      (inst.mappings || []).filter(m => m.io_id).map(m => m.input_key)
    );

    const groups = def.groups;
    let innerHTML = "";

    if (groups?.length) {
      innerHTML = groups.map(grp => {
        if (grp.requires && !mappedKeys.has(grp.requires)) return "";
        if (grp.requires_absent && mappedKeys.has(grp.requires_absent)) return "";
        const sps = def.setpoints.filter(sp => (sp.group || "basic") === grp.id);
        if (!sps.length) return "";
        const rows = sps.map(sp => renderSetpointRow(inst.id, sp, settings)).join("");
        return `
          <details class="sp-group" ${grp.open ? "open" : ""}>
            <summary>${escapeHTML(grp.label || grp.id || 'Group')}</summary>
            ${rows}
          </details>`;
      }).join("");
    } else {
      innerHTML = def.setpoints.map(sp => renderSetpointRow(inst.id, sp, settings)).join("");
    }

    const summaryHtml = ModuleRegistry[inst.module_id]?.renderSummary?.(inst, settings, inst._liveStatus) || '';
    spEl.innerHTML = `
      <div class="sp-panel">
        <div class="sp-title">\u2699\uFE0F Setpoints</div>
        ${summaryHtml}
        ${innerHTML}
      </div>`;
  } else {
    spEl.innerHTML = "";
  }

  try {
    const d = await api(moduleLogEndpoint(inst));
    const log = (d.log || []).slice(0, 4);
    const logEl = document.getElementById(`log_${inst.id}`);
    if (logEl && log.length) {
      logEl.innerHTML = `<div class="sp-panel" style="margin-top:8px">
        <div class="sp-title">\uD83D\uDCCB Recent Actions</div>
        ${log.map(l => `<div class="log-row">
          <span class="log-ts">${new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span class="log-action ${escapeHtml(l.action)}">${escapeHtml(l.action)}</span>
          <span style="color:var(--muted2);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.reason)}</span>
        </div>`).join("")}
      </div>`;
    }
  } catch {}
}

function renderBadge(text, color, border) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.04);border:1px solid ${border || 'var(--line)'};border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700;color:${color || 'var(--text)'}">${escapeHTML(String(text ?? ''))}</span>`;
}

function renderSetpointRow(instId, sp, settings) {
  const val = settings[sp.key] ?? sp.default ?? "";
  const help = sp.help ? `<div class="sp-help" style="font-size:11px;color:var(--muted);margin-top:4px">${escapeHTML(sp.help)}</div>` : "";
  if (sp.type === "select") {
    const options = (sp.options || []).map(o => typeof o === 'object' ? o : { value: o, label: o });
    return `<div class="sp-row">
      <span class="sp-label">${escapeHTML(sp.label)}</span>
      <div class="sp-ctrl">
        <select class="sp-select" id="sp_${instId}_${sp.key}" onchange="saveSP(${instId},'${sp.key}',this.value)">
          ${options.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(val) === String(o.value) ? "selected" : ""}>${escapeHTML(o.label)}</option>`).join("")}
        </select>
      </div>
      ${help}
    </div>`;
  }
  if (sp.type === "time") {
    return `<div class="sp-row">
      <span class="sp-label">${escapeHTML(sp.label)}</span>
      <div class="sp-ctrl">
        <input type="time" class="sp-input" style="width:85px" id="sp_${instId}_${sp.key}" value="${escapeHTML(String(val))}"
               onchange="saveSP(${instId},'${sp.key}',this.value)">
      </div>
      ${help}
    </div>`;
  }
  if (sp.type === "text") {
    return `<div class="sp-row">
      <span class="sp-label">${escapeHTML(sp.label)}</span>
      <div class="sp-ctrl">
        <input class="sp-input" type="text" id="sp_${instId}_${sp.key}" value="${escapeHTML(String(val))}">
        <button class="btn btn-xs sp-btn" onclick="saveSP(${instId},'${sp.key}',document.getElementById('sp_${instId}_${sp.key}').value)">Save</button>
      </div>
      ${help}
    </div>`;
  }
  return `<div class="sp-row">
    <span class="sp-label">${escapeHTML(sp.label)}</span>
    <div class="sp-ctrl">
      <input class="sp-input" type="number" step="${escapeHTML(String(sp.step || 1))}" id="sp_${instId}_${sp.key}" value="${escapeHTML(String(val))}">
      <span class="sp-unit">${escapeHTML(sp.unit || "")}</span>
      <button class="btn btn-xs sp-btn" onclick="saveSP(${instId},'${sp.key}',document.getElementById('sp_${instId}_${sp.key}').value)">Save</button>
    </div>
    ${help}
  </div>`;
}

async function saveSP(instId, key, value) {
  try {
    await api(moduleSettingsEndpoint(instId), {
      method: "PATCH", body: JSON.stringify({ key, value })
    });
    toast("Saved", true);
  } catch (e) { toast("Error: " + e.message, false); }
}

async function toggleModuleTestMode(instId, currentValue) {
  const next = String(currentValue) === '1' ? '0' : '1';
  try {
    await api(moduleSettingsEndpoint(instId), {
      method: "PATCH", body: JSON.stringify({ key: 'test_mode', value: next })
    });
    toast(next === '1' ? 'Test mode enabled' : 'Test mode disabled', true);
    await loadInstances();
  } catch (e) {
    toast("Error: " + e.message, false);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function initModulesPage() {
  try {
    const me = await api("/me");
    if (!me.ok || !me.user) { window.location.href = "/login.html"; return; }

    try { siteId = Number(localStorage.getItem("elaris_site_id") || ""); } catch {}
    if (!siteId) {
      const sites = await api("/sites");
      siteId = sites.sites?.[0]?.id;
    }
    if (!siteId) {
      document.querySelector(".page").innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">No site found. <a href="/" style="color:var(--blue)">Go to Dashboard</a> first.</div>`;
      return;
    }

    const [defsRes, ioRes] = await Promise.all([
      api("/modules/definitions"),
      api(`/modules/io/${siteId}`)
    ]);

    defs = defsRes.modules || [];
    siteIO = ioRes.io || [];
    refreshIOFilterSelects();

    window._categories = defsRes.categories || [];
    renderCatTabs(window._categories);
    renderDefs();
    await loadInstances();

  } catch (e) {
    if (e.message.includes("401") || e.message.includes("not_auth")) {
      window.location.href = "/login.html";
    } else console.error(e);
  }
}
