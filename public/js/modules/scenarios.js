// public/js/modules/scenarios.js

let scenarioEditorInstId = null;
let scenarios = [];

const SCENE_ICONS = ['💡','🌙','🎬','☀️','🌅','🌇','🎉','🛋️','🍽️','📖','🌿','❄️','🔥','💤','⚡'];
const TRIGGER_LABELS = {
  manual:  '🖐️ Manual only',
  time:    '🕐 Time',
  sunset:  '🌇 Sunset',
  sunrise: '🌄 Sunrise',
  pir:     '🚶 PIR Motion',
  switch:  '🔘 Wall Switch',
  lux:     '☀️ Lux threshold',
};

function parseScenarioSunOffset(s) {
  const expr = String(s?.trigger_sun || '').trim();
  if (!expr) return Number(s?.trigger_offset || 0) || 0;
  const match = expr.match(/^(sunrise|sunset)([+-]\d+)?$/);
  if (!match) return Number(s?.trigger_offset || 0) || 0;
  return Number(match[2] || 0) || 0;
}

function getTriggerInputOptions(inputMappings, prefix, emptyLabel) {
  const opts = inputMappings.filter(m => String(m.input_key).startsWith(prefix));
  return [{ value: '', label: emptyLabel }].concat(opts.map(m => ({ value: String(m.input_key), label: `${m.input_key} - ${m.io_name || m.io_key || m.input_key}` })));
}

function syncScenarioTriggerFields(s) {
  if (!s) return;
  if (s.trigger === 'sunrise' || s.trigger === 'sunset') {
    const offset = Number(s.trigger_offset || 0) || 0;
    s.trigger_sun = `${s.trigger}${offset > 0 ? `+${offset}` : offset < 0 ? `${offset}` : ''}`;
  } else {
    delete s.trigger_sun;
    delete s.trigger_offset;
  }
  if (s.trigger !== 'time') delete s.trigger_time;
  if (s.trigger !== 'lux') delete s.trigger_lux_max;
  if (!['switch', 'pir', 'lux'].includes(s.trigger)) delete s.trigger_input_key;
}

function getScenarioWarnings(s, mappings) {
  const warnings = [];
  const outputs = Array.isArray(s?.outputs) ? s.outputs : [];
  const diKeys = mappings.filter(m => String(m.input_key).startsWith('di_')).map(m => String(m.input_key));
  const aiKeys = mappings.filter(m => String(m.input_key).startsWith('ai_')).map(m => String(m.input_key));
  const diCount = diKeys.length;
  const aiCount = aiKeys.length;
  const activeOutputs = outputs.filter(o => o && o.io_key);

  if (!String(s?.name || '').trim()) warnings.push({ severity:'warn', text:'Add a scenario name so users can recognize it quickly.' });
  if (!mappings.length) warnings.push({ severity:'bad', text:'No outputs are mapped yet. This scenario cannot control any load.' });
  else if (!activeOutputs.length) warnings.push({ severity:'warn', text:'This scenario has no output levels selected yet.' });

  if (s?.trigger === 'time' && !String(s?.trigger_time || '').trim()) warnings.push({ severity:'bad', text:'Pick a clock time for the time trigger.' });
  if ((s?.trigger === 'sunrise' || s?.trigger === 'sunset') && parseScenarioSunOffset(s) === 0 && !String(s?.trigger_sun || '').trim()) {
    warnings.push({ severity:'info', text:'Sun trigger uses the exact sunrise or sunset time when offset is 0.' });
  }
  if (s?.trigger === 'lux') {
    if (!aiCount) warnings.push({ severity:'bad', text:'Lux trigger needs at least one mapped AI input.' });
    if (!(Number(s?.trigger_lux_max) > 0)) warnings.push({ severity:'bad', text:'Set a lux threshold above 0 for the lux trigger.' });
    if (String(s?.trigger_input_key || '').trim() && !aiKeys.includes(String(s.trigger_input_key))) warnings.push({ severity:'bad', text:'The selected lux input is no longer mapped.' });
  }
  if (s?.trigger === 'switch' && !diCount) warnings.push({ severity:'bad', text:'Wall switch trigger needs at least one mapped DI input.' });
  if (s?.trigger === 'pir' && !diCount) warnings.push({ severity:'bad', text:'PIR trigger needs at least one mapped DI input.' });
  if ((s?.trigger === 'switch' || s?.trigger === 'pir') && String(s?.trigger_input_key || '').trim() && !diKeys.includes(String(s.trigger_input_key))) warnings.push({ severity:'bad', text:'The selected DI trigger input is no longer mapped.' });

  return warnings;
}

function renderScenarioWarnings(s, mappings) {
  const warnings = getScenarioWarnings(s, mappings);
  if (!warnings.length) return '';
  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">${warnings.map(w => `<div style="font-size:11px;line-height:1.45;border:1px solid ${w.severity==='bad' ? 'rgba(239,68,68,.28)' : w.severity==='warn' ? 'rgba(245,158,11,.28)' : 'rgba(59,130,246,.22)'};background:${w.severity==='bad' ? 'rgba(239,68,68,.08)' : w.severity==='warn' ? 'rgba(245,158,11,.08)' : 'rgba(59,130,246,.06)'};color:${w.severity==='bad' ? '#fca5a5' : w.severity==='warn' ? '#fbbf24' : 'var(--muted2)'};border-radius:8px;padding:8px 10px">${escapeHTML(w.text)}</div>`).join('')}</div>`;
}

async function openScenarioEditor(instId) {
  scenarioEditorInstId = instId;
  try {
    const d = await api(`/automation/settings/${instId}`);
    scenarios = JSON.parse(d.settings?.scenarios || '[]');
    if (!Array.isArray(scenarios)) scenarios = [];
    scenarios.forEach(syncScenarioTriggerFields);
  } catch { scenarios = []; }

  // Get instance mappings for output selection
  const inst = instances.find(i=>String(i.id)===String(instId));
  const mappings = (inst?.mappings||[]).filter(m=>m.io_id && (m.input_key.startsWith('do_')||m.input_key.startsWith('ao_')||m.input_key.startsWith('di_')||m.input_key.startsWith('ai_')));

  renderScenarioEditorModal(inst, mappings);
}

function renderScenarioEditorModal(inst, mappings) {
  document.getElementById('scenarioModal')?.remove();

  const cards = scenarios.map((s,si) => renderScenarioCard(s, si, mappings)).join('');

  document.body.insertAdjacentHTML('beforeend', `
  <div id="scenarioModal" style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto">
  <div style="background:var(--card);border:1px solid rgba(240,192,64,.3);border-radius:var(--radius);padding:22px;width:100%;max-width:700px;margin-bottom:40px">

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
      <div style="font-size:16px;font-weight:800">✨ Scenarios — ${escapeHTML(inst?.name||'Smart Lighting')}</div>
      <button class="btn btn-sm" onclick="closeScenarioEditor()">✕ Close</button>
    </div>

    <div id="scenarioList">${cards || '<div style="color:var(--muted);font-size:13px;padding:12px 0;text-align:center">No scenarios yet. Add one below!</div>'}</div>

    <button class="btn btn-sm" onclick="addScenario()" style="width:100%;margin-top:10px;border-style:dashed;color:var(--muted2)">
      + Add Scenario
    </button>

    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)">
      <button class="btn btn-sm" onclick="closeScenarioEditor()">Cancel</button>
      <button class="btn btn-sm btn-primary" onclick="saveScenarios()">💾 Save Scenarios</button>
    </div>
  </div></div>`);
}

function renderScenarioCard(s, si, mappings) {
  const icon = s.icon || '💡';
  const name = s.name || 'Scenario '+(si+1);
  const trigger = s.trigger || 'manual';
  const enabled = s.enabled !== false;
  const warnings = getScenarioWarnings(s, mappings);

  // Output sliders
  const allOutputs = mappings.filter(m => String(m.input_key).startsWith('do_') || String(m.input_key).startsWith('ao_'));
  const outputRows = allOutputs.map(m => {
    const out = (s.outputs||[]).find(o=>o.io_key===m.input_key);
    const level = out?.level ?? (m.input_key.startsWith('ao_') ? 100 : 100);
    const isRelay = m.input_key.startsWith('do_');
    return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;color:var(--muted2);min-width:60px;font-family:monospace">${m.input_key}</span>
      <span style="font-size:11px;color:var(--muted);min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(m.io_name||m.io_key||'')}</span>
      ${isRelay ? `
        <select class="cond-sel" style="width:80px" onchange="scOut(${si},'${m.input_key}',Number(this.value))">
          <option value="100" ${level>=50?'selected':''}>ON</option>
          <option value="0"   ${level<50 ?'selected':''}>OFF</option>
        </select>
      ` : `
        <input type="range" min="0" max="100" step="5" value="${level}" style="flex:1;accent-color:#f0c040"
               oninput="scOut(${si},'${m.input_key}',Number(this.value));this.nextElementSibling.textContent=this.value+'%'">
        <span style="font-size:11px;color:#f0c040;min-width:36px;text-align:right">${level}%</span>
      `}
    </div>`;
  }).join('');

  // Trigger detail
  let triggerDetail = '';
  if (trigger === 'time') {
    triggerDetail = `<input type="time" value="${s.trigger_time||'20:00'}" class="cond-input" style="width:100px"
      oninput="scSet(${si},'trigger_time',this.value)">`;
  } else if (trigger === 'sunset' || trigger === 'sunrise') {
    const sunOffset = parseScenarioSunOffset(s);
    triggerDetail = `
      <span style="font-size:11px;color:var(--muted)">offset</span>
      <input type="number" value="${sunOffset}" class="cond-input" style="width:60px" placeholder="0"
              oninput="scSet(${si},'trigger_offset',Number(this.value))">
      <span style="font-size:10px;color:var(--muted)">min</span>`;
  } else if (trigger === 'lux') {
    const aiOptions = getTriggerInputOptions(mappings, 'ai_', 'First mapped AI input');
    triggerDetail = `
      <select class="cond-sel" style="width:220px" onchange="scSet(${si},'trigger_input_key',this.value)">
        ${aiOptions.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(s.trigger_input_key || '') === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}
      </select>
      <span style="font-size:11px;color:var(--muted)">below</span>
      <input type="number" min="0" value="${s.trigger_lux_max ?? 50}" class="cond-input" style="width:72px" placeholder="50"
             oninput="scSet(${si},'trigger_lux_max',Number(this.value))">
      <span style="font-size:10px;color:var(--muted)">lux</span>`;
  } else if (trigger === 'switch' || trigger === 'pir') {
    const diOptions = getTriggerInputOptions(mappings, 'di_', trigger === 'switch' ? 'Any mapped wall-switch DI' : 'Any mapped PIR DI');
    triggerDetail = `<select class="cond-sel" style="width:220px" onchange="scSet(${si},'trigger_input_key',this.value)">${diOptions.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(s.trigger_input_key || '') === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select>`;
  }

  return `
  <div style="background:rgba(240,192,64,.04);border:1px solid rgba(240,192,64,.${enabled?'2':'1'});border-radius:10px;padding:14px;margin-bottom:12px;opacity:${enabled?'1':'.6'}">

    <!-- Header row -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select class="cond-sel" style="width:52px;text-align:center;font-size:16px" onchange="scSet(${si},'icon',this.value)">
        ${SCENE_ICONS.map(ic=>`<option value="${ic}" ${ic===icon?'selected':''}>${ic}</option>`).join('')}
      </select>
      <input class="rule-name-input" placeholder="Scenario name" value="${name}"
             style="flex:1;min-width:100px" oninput="scSet(${si},'name',this.value)">
      <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--muted)">
        <input type="checkbox" ${enabled?'checked':''} onchange="scSet(${si},'enabled',this.checked)"> On
      </label>
      ${warnings.length ? `<span style="font-size:10px;font-weight:800;color:${warnings.some(w => w.severity === 'bad') ? '#fca5a5' : '#fbbf24'}">${warnings.length} warning${warnings.length === 1 ? '' : 's'}</span>` : ''}
      <button class="btn btn-xs btn-danger" onclick="removeScenario(${si})">✕</button>
    </div>

    <!-- Outputs -->
    ${allOutputs.length ? `
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Output Levels</div>
    ${outputRows}` : `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">⚠️ No outputs mapped yet. Edit the module mappings first.</div>`}

    <!-- Trigger -->
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin:10px 0 6px">Trigger</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <select class="cond-sel" style="width:160px" onchange="scTrigger(${si},this.value)">
        ${Object.entries(TRIGGER_LABELS).map(([k,v])=>`<option value="${k}" ${trigger===k?'selected':''}>${v}</option>`).join('')}
      </select>
      ${triggerDetail}
      <span style="font-size:11px;color:var(--muted)">priority</span>
      <input type="number" value="${Number(s.priority||0)}" class="cond-input" style="width:64px" placeholder="0"
             oninput="scSet(${si},'priority',Number(this.value))">
    </div>

    <!-- Auto-off -->
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px">
      <span style="color:var(--muted)">Auto-off after</span>
      <input type="number" min="0" value="${s.off_after||0}" class="cond-input" style="width:64px"
             oninput="scSet(${si},'off_after',Number(this.value))">
      <span style="color:var(--muted)">min <span style="font-size:10px">(0 = never)</span></span>
    </div>

    ${renderScenarioWarnings(s, mappings)}

  </div>`;
}

// Mutation helpers
function scSet(si, field, val) {
  if (!scenarios[si]) return;
  scenarios[si][field] = val;
  syncScenarioTriggerFields(scenarios[si]);
}

function scOut(si, ioKey, level) {
  if (!scenarios[si]) return;
  if (!scenarios[si].outputs) scenarios[si].outputs = [];
  const existing = scenarios[si].outputs.find(o=>o.io_key===ioKey);
  if (existing) existing.level = level;
  else scenarios[si].outputs.push({ io_key: ioKey, level });
}

function scTrigger(si, trigger) {
  if (!scenarios[si]) return;
  scenarios[si].trigger = trigger;
  syncScenarioTriggerFields(scenarios[si]);
  // Re-render to show/hide trigger detail
  const inst = instances.find(i=>String(i.id)===String(scenarioEditorInstId));
  const mappings = (inst?.mappings||[]).filter(m=>m.io_id && (m.input_key.startsWith('do_')||m.input_key.startsWith('ao_')||m.input_key.startsWith('di_')||m.input_key.startsWith('ai_')));
  renderScenarioEditorModal(inst, mappings);
}

function addScenario() {
  const inst = instances.find(i=>String(i.id)===String(scenarioEditorInstId));
  const mappings = (inst?.mappings||[]).filter(m=>m.io_id && (m.input_key.startsWith('do_')||m.input_key.startsWith('ao_')||m.input_key.startsWith('di_')||m.input_key.startsWith('ai_')));
  const defaultOutputs = mappings.filter(m => m.input_key.startsWith('do_') || m.input_key.startsWith('ao_')).map(m => ({ io_key: m.input_key, level: 100 }));
  scenarios.push({
    id: 'sc_'+Date.now(),
    name: 'New Scenario',
    icon: '💡',
    enabled: true,
    outputs: defaultOutputs,
    trigger: 'manual',
    priority: 0,
    off_after: 0,
  });
  renderScenarioEditorModal(inst, mappings);
}

function removeScenario(si) {
  scenarios.splice(si, 1);
  const inst = instances.find(i=>String(i.id)===String(scenarioEditorInstId));
  const mappings = (inst?.mappings||[]).filter(m=>m.io_id && (m.input_key.startsWith('do_')||m.input_key.startsWith('ao_')||m.input_key.startsWith('di_')||m.input_key.startsWith('ai_')));
  renderScenarioEditorModal(inst, mappings);
}

async function saveScenarios() {
  try {
    const inst = instances.find(i=>String(i.id)===String(scenarioEditorInstId));
    const mappings = (inst?.mappings||[]).filter(m=>m.io_id && (m.input_key.startsWith('do_')||m.input_key.startsWith('ao_')||m.input_key.startsWith('di_')||m.input_key.startsWith('ai_')));
    const blocking = scenarios.flatMap(s => getScenarioWarnings(s, mappings).filter(w => w.severity === 'bad'));
    if (blocking.length) {
      toast('Fix the scenario warnings before saving.', 'err');
      return;
    }
    await api(`/automation/settings/${scenarioEditorInstId}`, {
      method: 'PATCH',
      body: JSON.stringify({ key: 'scenarios', value: JSON.stringify(scenarios) })
    });
    toast('✓ Scenarios saved');
    closeScenarioEditor();
    await loadInstances();
  } catch(e) { toast('Error: '+e.message, 'err'); }
}

function closeScenarioEditor() {
  document.getElementById('scenarioModal')?.remove();
  scenarioEditorInstId = null;
}

// Dashboard: activate a scenario manually via POST
async function activateScenario(instId, scenarioId) {
  try {
    await api(`/automation/smart_lighting/${instId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ scenario_id: scenarioId })
    });
    toast('✓ Scenario activated');
  } catch(e) { toast('Error: '+e.message, 'err'); }
}
