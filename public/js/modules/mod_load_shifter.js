// public/js/modules/mod_load_shifter.js

function analyzeLoadShifterMappings(currentMappings={}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const power = map('power_w');
  const loads = [1,2,3,4].map(i => ({ key:'load_'+i, idx:i, io: map('load_'+i) })).filter(x => !!x.io);
  const threshold = Number(document.getElementById('sp_new_power_threshold')?.value || document.getElementById('sp_0_power_threshold')?.value || 8000);
  const restoreBelow = Number(document.getElementById('sp_new_restore_below')?.value || document.getElementById('sp_0_restore_below')?.value || 6000);
  const issues = [];
  const ioUse = new Map();
  const note = (id,label) => { if(!id) return; if(!ioUse.has(id)) ioUse.set(id, []); ioUse.get(id).push(label); };
  note(power, 'Power meter');
  loads.forEach(l => note(l.io, 'Load '+l.idx));
  if (!power) issues.push({ severity:'bad', message:'Map the site power meter (W).' });
  if (!loads.length) issues.push({ severity:'bad', message:'Map at least one controllable load output.' });
  if (!map('load_1')) issues.push({ severity:'info', message:'Load 1 is not mapped. Start with your most important controllable load there.' });
  if (restoreBelow >= threshold) issues.push({ severity:'bad', message:'Restore below must be lower than shed above.' });
  if (loads.length === 1) issues.push({ severity:'info', message:'Only one load is mapped. Load shifting will work, but there is no priority ladder yet.' });
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({ severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.` });
  });
  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return { power, loads, threshold, restoreBelow, issues, readiness };
}

function renderLoadShifterCommissioningSummary(currentMappings={}) {
  const a = analyzeLoadShifterMappings(currentMappings);
  const powerPill = a.power
    ? `<span class="thermo-zone-pill"><strong>Power meter</strong><span class="mini">${ioLabelById(a.power)}</span></span>`
    : `<span class="thermo-zone-pill"><strong>No power meter</strong><span class="mini">Map the main power input.</span></span>`;
  const loadPills = a.loads.length
    ? a.loads.map(l => `<span class="thermo-zone-pill"><strong>Load ${l.idx}</strong><span class="mini">${ioLabelById(l.io)}</span></span>`).join('')
    : `<span class="thermo-zone-pill"><strong>No loads</strong><span class="mini">Map one or more relay loads to shed.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Load Shifter mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this peak-load protection setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Loads mapped</div><div class="thermo-stat-v">${a.loads.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Power meter</div><div class="thermo-stat-v">${a.power ? 'Mapped' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Shed above</div><div class="thermo-stat-v">${a.threshold}W</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Restore below</div><div class="thermo-stat-v">${a.restoreBelow}W</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Power source</div>
      <div class="thermo-zone-sum">${powerPill}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Controllable loads</div>
      <div class="thermo-zone-sum">${loadPills}</div>
      ${issues}
    </div>`;
}

function updateLoadShifterCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('loadShifterCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderLoadShifterCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderLoadShifterSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const state = live?.state || {};
  const warns = [];
  if (!mapped('power_w')) warns.push('No power meter mapped');
  if (![1,2,3,4].some(i => mapped('load_'+i))) warns.push('No loads mapped');
  if (Number(settings.restore_below||0) >= Number(settings.power_threshold||0)) warns.push('Restore below >= shed above');
  const mappedLoads = [1,2,3,4].filter(i => mapped('load_'+i));
  const shedKeys = Array.isArray(state.shed_keys) ? state.shed_keys.map(k => String(k).replace('load_','L')).join(', ') : '';
  const status = String(state.status || 'idle').toUpperCase();
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">`+
    `${renderBadge(status, status==='SHED' ? '#ff6b6b' : (status==='NO_DATA' ? '#f59e0b' : '#22d97a'), status==='SHED' ? 'rgba(255,107,107,.35)' : (status==='NO_DATA' ? 'rgba(245,158,11,.35)' : 'rgba(34,217,122,.35)'))}`+
    `${renderBadge('LOADS '+mappedLoads.length, 'var(--text)', 'var(--line)')}`+
    `${renderBadge('THR '+(settings.power_threshold||'—')+'W', 'var(--text)', 'var(--line)')}`+
    `${renderBadge('REST '+(settings.restore_below||'—')+'W', 'var(--muted)', 'var(--line)')}`+
    `${state.power!=null ? renderBadge('PWR '+Math.round(Number(state.power))+'W', '#f0c040', 'rgba(240,192,64,.3)') : ''}`+
    `${shedKeys ? renderBadge('SHED '+shedKeys, '#ff6b6b', 'rgba(255,107,107,.35)') : ''}`+
    `</div>`;
  if (state.last_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(String(state.last_reason).slice(0,80), 'var(--muted)', 'var(--line)')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('load_shifter', {
  hasAuto: true,
  summaryBoxId: 'loadShifterCommissioningSummary',
  updateCommissioningSummary(m) { updateLoadShifterCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderLoadShifterSummary(inst, s, live); },
});
