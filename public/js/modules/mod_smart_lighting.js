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
    spEl.innerHTML = `
      <div class="sp-panel">
        <div class="sp-title">✨ Scenarios</div>
        ${summary}
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
      </div>`;
  },
});
