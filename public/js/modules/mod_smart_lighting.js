// public/js/modules/mod_smart_lighting.js

function analyzeSmartLightingMappings(currentMappings={}) {
  const entries = Object.entries(currentMappings).filter(([,v]) => !!Number(v));
  const outputs = entries.filter(([k]) => /^do_|^ao_/.test(k)).map(([key, io]) => ({ key, io:Number(io) }));
  const inputs = entries.filter(([k]) => /^di_|^ai_/.test(k)).map(([key, io]) => ({ key, io:Number(io) }));
  const issues = [];
  const ioUse = new Map();
  const note = (id, label) => {
    if (!id) return;
    if (!ioUse.has(id)) ioUse.set(id, []);
    ioUse.get(id).push(label);
  };
  outputs.forEach(o => note(o.io, o.key.toUpperCase()));
  inputs.forEach(i => note(i.io, i.key.toUpperCase()));

  if (!outputs.length) issues.push({ severity:'bad', message:'Map at least one output (relay or dimmer).' });
  if (!inputs.length) issues.push({ severity:'info', message:'No trigger inputs mapped yet. Scenarios can still be activated manually or from schedules.' });

  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({ severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.` });
  });

  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs outputs' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return { outputs, inputs, issues, readiness };
}

function renderSmartLightingCommissioningSummary(currentMappings={}) {
  const a = analyzeSmartLightingMappings(currentMappings);
  const outputPills = a.outputs.map(o => `<span class="thermo-zone-pill"><strong>${String(o.key).toUpperCase()}</strong><span class="mini">${ioLabelById(o.io)}</span></span>`).join('') || `<span class="thermo-zone-pill"><strong>No outputs</strong><span class="mini">Add one or more relay/dimmer outputs.</span></span>`;
  const inputPills = a.inputs.map(i => `<span class="thermo-zone-pill"><strong>${String(i.key).toUpperCase()}</strong><span class="mini">${ioLabelById(i.io)}</span></span>`).join('') || `<span class="thermo-zone-pill"><strong>No inputs</strong><span class="mini">Add DI/AI triggers if you want motion, switch or sensor based scenes.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> The Smart Lighting I/O mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this Smart Lighting mapping.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Outputs</div><div class="thermo-stat-v">${a.outputs.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Inputs</div><div class="thermo-stat-v">${a.inputs.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Relays</div><div class="thermo-stat-v">${a.outputs.filter(o => String(o.key).startsWith('do_')).length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Dimmers</div><div class="thermo-stat-v">${a.outputs.filter(o => String(o.key).startsWith('ao_')).length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">DI inputs</div><div class="thermo-stat-v">${a.inputs.filter(i => String(i.key).startsWith('di_')).length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">AI inputs</div><div class="thermo-stat-v">${a.inputs.filter(i => String(i.key).startsWith('ai_')).length}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Outputs</div>
      <div class="thermo-zone-sum">${outputPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Inputs</div>
      <div class="thermo-zone-sum">${inputPills}</div>
      ${issues}
    </div>`;
}

function updateSmartLightingCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('smartLightingCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderSmartLightingCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderSmartLightingSummary(inst, scenarios, live) {
  const maps = inst.mappings || [];
  const outCount = maps.filter(m => m.io_id && (String(m.input_key).startsWith('do_') || String(m.input_key).startsWith('ao_'))).length;
  const inCount = maps.filter(m => m.io_id && (String(m.input_key).startsWith('di_') || String(m.input_key).startsWith('ai_'))).length;
  const enabled = scenarios.filter(s => s.enabled !== false);
  const triggerKinds = new Set(enabled.map(s => String(s.trigger || 'manual')));
  const state = live?.state || {};
  const warns = [];
  if (!outCount) warns.push('No outputs mapped');
  if (!enabled.length) warns.push('No active scenarios');
  if (enabled.length && enabled.every(s => !s.outputs || !s.outputs.length)) warns.push('Scenarios without outputs');
  const pills = [
    renderBadge(`${enabled.length} SCENARIOS`, '#f0c040', 'rgba(240,192,64,.3)'),
    renderBadge(`${outCount} OUTPUTS`, 'var(--text)', 'var(--line)'),
    renderBadge(`${inCount} INPUTS`, 'var(--muted)', 'var(--line)')
  ];
  if (triggerKinds.size) pills.push(renderBadge([...triggerKinds].join(' · ').toUpperCase(), '#22d97a', 'rgba(34,217,122,.35)'));
  if (state.active_scene_name) pills.push(renderBadge(`LIVE ${String(state.active_scene_name).toUpperCase()}`, '#f0c040', 'rgba(240,192,64,.3)'));
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

function getSmartLightingDimmerOptions(inst) {
  return (inst.mappings || [])
    .filter(m => m.io_id && String(m.input_key).startsWith('ao_'))
    .map(m => ({ value: String(m.input_key), label: `${m.input_key} - ${m.io_name || m.io_key || m.input_key}` }));
}

function getSmartLightingOutputOptions(inst) {
  return (inst.mappings || [])
    .filter(m => m.io_id && (String(m.input_key).startsWith('do_') || String(m.input_key).startsWith('ao_')))
    .map(m => ({ value: String(m.input_key), label: `${m.input_key} - ${m.io_name || m.io_key || m.input_key}` }));
}

function getSmartLightingInputOptions(inst, prefix) {
  return (inst.mappings || [])
    .filter(m => m.io_id && String(m.input_key).startsWith(prefix))
    .map(m => ({ value: String(m.input_key), label: `${m.input_key} - ${m.io_name || m.io_key || m.input_key}` }));
}

function parseSmartLightingPairs(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderSmartLightingAdaptiveEditor(inst, settings) {
  const aiOptions = [{ value: '', label: 'Auto select first AI input' }, ...getSmartLightingInputOptions(inst, 'ai_')];
  const aoOptions = [{ value: '', label: 'All mapped AO outputs' }, ...getSmartLightingDimmerOptions(inst)];
  if (aiOptions.length <= 1 && aoOptions.length <= 1) return '';
  return `<details class="sp-group" style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">🎯 Adaptive Routing</summary>
    <div class="sp-row"><span class="sp-label">Lux source AI</span><div class="sp-ctrl"><select class="sp-select" onchange="saveSP(${inst.id},'adaptive_source_key',this.value)">${aiOptions.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(settings.adaptive_source_key || '') === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></div><div class="sp-help" style="font-size:10px;color:var(--muted);margin-top:2px">Choose which AI input provides the lux value for adaptive dimming.</div></div>
    <div class="sp-row"><span class="sp-label">Adaptive AO target</span><div class="sp-ctrl"><select class="sp-select" onchange="saveSP(${inst.id},'adaptive_output_key',this.value)">${aoOptions.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(settings.adaptive_output_key || '') === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></div><div class="sp-help" style="font-size:10px;color:var(--muted);margin-top:2px">Limit adaptive dimming to one AO output, or leave blank to drive all mapped AO outputs.</div></div>
  </details>`;
}

function renderSmartLightingFollowMeEditor(inst, settings) {
  const diOptions = getSmartLightingInputOptions(inst, 'di_');
  const outOptions = getSmartLightingOutputOptions(inst);
  if (!diOptions.length || !outOptions.length) return '';
  const savedPairs = parseSmartLightingPairs(settings.follow_me_pairs);
  const rows = diOptions.map(di => {
    const saved = savedPairs.find(p => p.input_key === di.value);
    return `<div class="sp-row"><span class="sp-label">${escapeHTML(di.value)}</span><div class="sp-ctrl"><select class="sp-select smart-follow-pair" data-input-key="${escapeHTML(di.value)}"><option value="">No target output</option>${outOptions.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(saved?.output_key || '') === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></div><div class="sp-help" style="font-size:10px;color:var(--muted);margin-top:2px">Pick the output this DI should control in Follow-me mode.</div></div>`;
  }).join('');
  return `<details class="sp-group" style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">🚶 Follow-Me Pairs</summary>
    ${rows}
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-xs sp-btn" onclick="saveSmartLightingFollowPairs(${inst.id})">Save pairs</button></div>
  </details>`;
}

async function saveSmartLightingFollowPairs(instId) {
  const selects = Array.from(document.querySelectorAll('.smart-follow-pair'));
  const pairs = selects
    .map(sel => ({ input_key: String(sel.dataset.inputKey || ''), output_key: String(sel.value || '') }))
    .filter(p => p.input_key && p.output_key);
  await saveSP(instId, 'follow_me_pairs', JSON.stringify(pairs));
}

window.saveSmartLightingFollowPairs = saveSmartLightingFollowPairs;

registerModule('smart_lighting', {
  hasAuto: true,
  summaryBoxId: 'smartLightingCommissioningSummary',
  updateCommissioningSummary(m) { updateSmartLightingCommissioningSummary(m); },
  renderSummary(inst, s, live) { return ''; },
  async enrichCard(inst, settings, spEl) {
    let scenarios = [];
    let scCount = 0;
    const testMode = String(settings.test_mode || '0') === '1';
    try { scenarios = JSON.parse(settings.scenarios||'[]'); } catch {}
    if (!Array.isArray(scenarios)) scenarios = [];
    scCount = scenarios.filter(s=>s.enabled!==false).length;
    const summary = renderSmartLightingSummary(inst, scenarios, inst._liveStatus);

    const maps = inst.mappings || [];
    const outMappings = maps.filter(m => m.io_id && (String(m.input_key).startsWith('do_') || String(m.input_key).startsWith('ao_')));
    const inMappings = maps.filter(m => m.io_id && (String(m.input_key).startsWith('di_') || String(m.input_key).startsWith('ai_')));

    let ioHtml = '';
    if (outMappings.length || inMappings.length) {
      ioHtml = '<div style="font-size:10px;color:var(--muted2);margin:8px 0 4px">Mapped IO</div>';
      outMappings.forEach(m => { ioHtml += '<div style="font-size:11px;color:var(--muted)">→ ' + escapeHTML(m.input_key) + ': ' + escapeHTML(m.io_name || m.io_key || '') + '</div>'; });
      inMappings.forEach(m => { ioHtml += '<div style="font-size:11px;color:var(--muted)">← ' + escapeHTML(m.input_key) + ': ' + escapeHTML(m.io_name || m.io_key || '') + '</div>'; });
    }

    const adaptiveOn = String(settings.adaptive_brightness || '0') === '1';
    const followOn = String(settings.follow_me || '0') === '1';
    const sunriseOn = String(settings.sunrise_enabled || '0') === '1';
    const sleepOn = String(settings.sleep_enabled || '0') === '1';

    let featureHtml = '';
    if (adaptiveOn || followOn || sunriseOn || sleepOn) {
      featureHtml = '<div style="font-size:10px;color:var(--muted2);margin:8px 0 4px">Active Features</div>';
      if (adaptiveOn) featureHtml += renderBadge('ADAPTIVE', '#06b6d4', 'rgba(6,182,212,.3)') + ' ';
      if (followOn) featureHtml += renderBadge('FOLLOW-ME', '#84cc16', 'rgba(132,204,22,.3)') + ' ';
      if (sunriseOn) featureHtml += renderBadge('SUNRISE', '#f97316', 'rgba(249,115,22,.3)') + ' ';
      if (sleepOn) featureHtml += renderBadge('SLEEP', '#6366f1', 'rgba(99,102,241,.3)') + ' ';
    }

    // Render setpoints using the shared setpoint row renderer
    const def = inst.definition;
    let setpointsHtml = '';
    if (def?.setpoints?.length) {
      const dimmerOptions = getSmartLightingDimmerOptions(inst);
      setpointsHtml = '<details class="sp-group" style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase">⚙️ Settings</summary>';
      def.setpoints.forEach(sp => {
        const val = settings[sp.key] ?? sp.default ?? '';
        const help = sp.help ? `<div class="sp-help" style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHTML(sp.help)}</div>` : '';
        if (sp.type === 'select') {
          const options = (sp.options || []).map(o => typeof o === 'object' ? o : { value: o, label: o });
          setpointsHtml += `<div class="sp-row"><span class="sp-label">${escapeHTML(sp.label)}</span><div class="sp-ctrl"><select class="sp-select" id="sp_${inst.id}_${sp.key}" onchange="saveSP(${inst.id},'${sp.key}',this.value)">${options.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(val) === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></div>${help}</div>`;
        } else if (sp.type === 'time') {
          setpointsHtml += `<div class="sp-row"><span class="sp-label">${escapeHTML(sp.label)}</span><div class="sp-ctrl"><input type="time" class="sp-input" style="width:85px" id="sp_${inst.id}_${sp.key}" value="${escapeHTML(String(val))}" onchange="saveSP(${inst.id},'${sp.key}',this.value)"></div>${help}</div>`;
        } else if (sp.type === 'text' && (sp.key === 'sunrise_output' || sp.key === 'sleep_output')) {
          const options = [{ value: '', label: 'Select dimmer output' }, ...dimmerOptions];
          setpointsHtml += `<div class="sp-row"><span class="sp-label">${escapeHTML(sp.label)}</span><div class="sp-ctrl"><select class="sp-select" id="sp_${inst.id}_${sp.key}" onchange="saveSP(${inst.id},'${sp.key}',this.value)">${options.map(o => `<option value="${escapeHTML(String(o.value))}" ${String(val) === String(o.value) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></div>${help}</div>`;
        } else if (sp.type === 'text') {
          setpointsHtml += `<div class="sp-row"><span class="sp-label">${escapeHTML(sp.label)}</span><div class="sp-ctrl"><input class="sp-input" type="text" id="sp_${inst.id}_${sp.key}" value="${escapeHTML(String(val))}"><button class="btn btn-xs sp-btn" onclick="saveSP(${inst.id},'${sp.key}',document.getElementById('sp_${inst.id}_${sp.key}').value)">Save</button></div>${help}</div>`;
        } else {
          setpointsHtml += `<div class="sp-row"><span class="sp-label">${escapeHTML(sp.label)}</span><div class="sp-ctrl"><input class="sp-input" type="number" step="${escapeHTML(String(sp.step || 1))}" id="sp_${inst.id}_${sp.key}" value="${escapeHTML(String(val))}"><span class="sp-unit">${escapeHTML(sp.unit || '')}</span><button class="btn btn-xs sp-btn" onclick="saveSP(${inst.id},'${sp.key}',document.getElementById('sp_${inst.id}_${sp.key}').value)">Save</button></div>${help}</div>`;
        }
      });
      setpointsHtml += '</details>';
      setpointsHtml += renderSmartLightingAdaptiveEditor(inst, settings);
      setpointsHtml += renderSmartLightingFollowMeEditor(inst, settings);
    }

    spEl.innerHTML = `
      <div class="sp-panel">
        <div class="sp-title">✨ Scenarios</div>
        ${summary}
        ${ioHtml}
        ${featureHtml}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${testMode ? renderBadge('TEST MODE', '#ffd978', 'rgba(255,201,71,.35)') : ''}</div>
        <button class="btn btn-sm" style="width:100%;background:linear-gradient(135deg,rgba(240,192,64,.15),rgba(240,192,64,.05));border-color:rgba(240,192,64,.4);color:#f0c040"
                onclick="openScenarioEditor(${inst.id})">
          🎬 Edit Scenarios
        </button>
        <button class="btn btn-sm" style="width:100%;margin-top:8px;border-color:${testMode ? 'rgba(255,201,71,.35)' : 'var(--line2)'};color:${testMode ? '#ffd978' : 'var(--muted2)'};background:${testMode ? 'rgba(255,201,71,.08)' : 'rgba(255,255,255,.03)'}"
                onclick="toggleModuleTestMode(${inst.id}, '${settings.test_mode || '0'}')">
          ${testMode ? '🧪 Disable Test Mode' : '🧪 Enable Test Mode'}
        </button>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center">
          ${scCount} active scenario(s)
        </div>
        ${setpointsHtml}
      </div>`;
  },
});
