// public/js/modules/mod_lighting.js

function analyzeLightingMappings(currentMappings={}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const relay = map('light_relay');
  const dimmer = map('dimmer_output');
  const switchDi = map('switch_di');
  const pir = map('pir_sensor');
  const motionAi = map('motion_ai');
  const lux = map('lux_sensor');
  const issues = [];
  const ioUse = new Map();
  const note = (id, label) => {
    if (!id) return;
    if (!ioUse.has(id)) ioUse.set(id, []);
    ioUse.get(id).push(label);
  };
  [
    [relay, 'Relay output'],
    [dimmer, 'Dimmer output'],
    [switchDi, 'Wall switch'],
    [pir, 'PIR'],
    [motionAi, 'Presence AI'],
    [lux, 'Lux sensor'],
  ].forEach(([id,label]) => note(id,label));

  const outputs = [];
  if (relay) outputs.push({ key:'light_relay', label:'Relay output', io:relay });
  if (dimmer) outputs.push({ key:'dimmer_output', label:'Dimmer output', io:dimmer });
  const inputs = [];
  if (switchDi) inputs.push({ key:'switch_di', label:'Wall switch', io:switchDi });
  if (pir) inputs.push({ key:'pir_sensor', label:'PIR', io:pir });
  if (motionAi) inputs.push({ key:'motion_ai', label:'Presence AI', io:motionAi });
  if (lux) inputs.push({ key:'lux_sensor', label:'Lux sensor', io:lux });

  if (!outputs.length) issues.push({ severity:'bad', message:'Map at least one output (relay or dimmer).' });
  if (!inputs.length) issues.push({ severity:'info', message:'No control inputs mapped yet. The module can still work from manual dashboard control or fixed schedule.' });

  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({ severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.` });
  });

  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs outputs' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return {
    relay, dimmer, switchDi, pir, motionAi, lux,
    outputs, inputs, issues, readiness
  };
}

function renderLightingCommissioningSummary(currentMappings={}) {
  const a = analyzeLightingMappings(currentMappings);
  const sourcePills = [
    a.switchDi ? `<span class="thermo-zone-pill"><strong>Switch</strong><span class="mini">${ioLabelById(a.switchDi)}</span></span>` : '',
    a.pir ? `<span class="thermo-zone-pill"><strong>PIR</strong><span class="mini">${ioLabelById(a.pir)}</span></span>` : '',
    a.motionAi ? `<span class="thermo-zone-pill"><strong>Presence AI</strong><span class="mini">${ioLabelById(a.motionAi)}</span></span>` : '',
    a.lux ? `<span class="thermo-zone-pill"><strong>Lux</strong><span class="mini">${ioLabelById(a.lux)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No inputs</strong><span class="mini">Add a switch, PIR, lux or AI source.</span></span>`;

  const outputPills = [
    a.relay ? `<span class="thermo-zone-pill"><strong>Relay</strong><span class="mini">${ioLabelById(a.relay)}</span></span>` : '',
    a.dimmer ? `<span class="thermo-zone-pill"><strong>Dimmer</strong><span class="mini">${ioLabelById(a.dimmer)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No outputs</strong><span class="mini">Map relay or dimmer to control the load.</span></span>`;

  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> This lighting mapping looks clean so far.</div></div>`;

  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this lighting setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Outputs</div><div class="thermo-stat-v">${a.outputs.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Inputs</div><div class="thermo-stat-v">${a.inputs.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Switch</div><div class="thermo-stat-v">${a.switchDi ? 'Mapped' : '—'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Motion</div><div class="thermo-stat-v">${a.pir || a.motionAi ? 'Mapped' : '—'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Lux</div><div class="thermo-stat-v">${a.lux ? 'Mapped' : '—'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Dimming</div><div class="thermo-stat-v">${a.dimmer ? 'Yes' : 'No'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Outputs</div>
      <div class="thermo-zone-sum">${outputPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Inputs</div>
      <div class="thermo-zone-sum">${sourcePills}</div>
      ${issues}
    </div>`;
}

function updateLightingCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('lightingCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderLightingCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderLightingSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const outputs = [];
  if (mapped('light_relay')) outputs.push('relay');
  if (mapped('dimmer_output')) outputs.push('dimmer');
  const inputs = [];
  if (mapped('switch_di')) inputs.push('switch');
  if (mapped('pir_sensor')) inputs.push('pir');
  if (mapped('motion_ai')) inputs.push('motion ai');
  if (mapped('lux_sensor')) inputs.push('lux');
  const mode = settings.mode || 'auto';
  const state = live?.state || {};
  const warns = [];
  if (!outputs.length) warns.push('No output mapped');
  if ((mode === 'pir' || mode === 'combined') && !mapped('pir_sensor') && !mapped('motion_ai')) warns.push('Motion mode without PIR/AI');
  if ((mode === 'lux' || mode === 'combined') && !mapped('lux_sensor')) warns.push('Lux mode without lux sensor');
  if (mode === 'schedule' && !(settings.schedule_on && settings.schedule_off)) warns.push('Schedule mode without ON/OFF times');
  const parts = [];
  parts.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(String(mode).toUpperCase(), '#f5c842', 'rgba(245,200,66,.35)')}${outputs.length ? renderBadge('OUT '+outputs.join(' + ').toUpperCase(), 'var(--text)', 'var(--line)') : ''}${inputs.length ? renderBadge('IN '+inputs.join(' · ').toUpperCase(), 'var(--muted)', 'var(--line)') : ''}${state.source ? renderBadge(String(state.source).replace(/_/g,' ').toUpperCase(), '#22d97a', 'rgba(34,217,122,.35)') : ''}</div>`);
  if (warns.length) parts.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`);
  return parts.join('');
}

registerModule('lighting', {
  hasAuto: true,
  summaryBoxId: 'lightingCommissioningSummary',
  updateCommissioningSummary(m) { updateLightingCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderLightingSummary(inst, s, live); },
});
