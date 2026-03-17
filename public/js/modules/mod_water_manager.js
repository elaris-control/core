// public/js/modules/mod_water_manager.js

function analyzeWaterManagerMappings(currentMappings={}) {
  const leakIds = [1,2,3,4].map(i => Number(currentMappings['leak_sensor_'+i]||0)).filter(Boolean);
  const mainValve = Number(currentMappings['main_valve']||0)||null;
  const flow = Number(currentMappings['flow_sensor']||0)||null;
  const pressure = Number(currentMappings['pressure_sensor']||0)||null;
  const issues = [];
  const ioUse = new Map();
  const note = (id, label) => {
    if (!id) return;
    if (!ioUse.has(id)) ioUse.set(id, []);
    ioUse.get(id).push(label);
  };
  leakIds.forEach((id, idx) => note(id, 'Leak ' + (idx+1)));
  note(mainValve, 'Main valve');
  note(flow, 'Flow');
  note(pressure, 'Pressure');

  if (!mainValve) issues.push({severity:'bad', message:'Map the main water valve output.'});
  if (!leakIds.length) issues.push({severity:'bad', message:'Map at least one leak sensor.'});
  if (mainValve && leakIds.includes(mainValve)) issues.push({severity:'bad', message:'Main valve reuses the same IO as a leak sensor.'});
  if (flow && !leakIds.length) issues.push({severity:'info', message:'Flow meter is mapped but no leak sensors are configured yet.'});
  if (pressure && !leakIds.length) issues.push({severity:'info', message:'Pressure sensor is mapped but no leak sensors are configured yet.'});
  if (!flow && !pressure) issues.push({severity:'info', message:'Only direct leak sensors are mapped. Ghost-flow and burst detection stay disabled.'});
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.`});
  });
  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return { leakIds, mainValve, flow, pressure, issues, readiness };
}

function renderWaterManagerCommissioningSummary(currentMappings={}) {
  const a = analyzeWaterManagerMappings(currentMappings);
  const leakPills = a.leakIds.length
    ? a.leakIds.map((id, idx)=>`<span class="thermo-zone-pill"><strong>Leak ${idx+1}</strong><span class="mini">${ioLabelById(id)}</span></span>`).join('')
    : `<span class="thermo-zone-pill"><strong>No leak sensors</strong><span class="mini">Map one or more flood inputs.</span></span>`;
  const helperPills = [
    a.mainValve ? `<span class="thermo-zone-pill"><strong>Main Valve</strong><span class="mini">${ioLabelById(a.mainValve)}</span></span>` : '',
    a.flow ? `<span class="thermo-zone-pill"><strong>Flow</strong><span class="mini">${ioLabelById(a.flow)}</span></span>` : '',
    a.pressure ? `<span class="thermo-zone-pill"><strong>Pressure</strong><span class="mini">${ioLabelById(a.pressure)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No helpers</strong><span class="mini">Flow / pressure are optional.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Water Manager mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this water protection setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Leak sensors</div><div class="thermo-stat-v">${a.leakIds.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Main valve</div><div class="thermo-stat-v">${a.mainValve ? 'Mapped' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Flow</div><div class="thermo-stat-v">${a.flow ? 'Ready' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Pressure</div><div class="thermo-stat-v">${a.pressure ? 'Ready' : 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Leak inputs</div>
      <div class="thermo-zone-sum">${leakPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Valve / helper sensors</div>
      <div class="thermo-zone-sum">${helperPills}</div>
      ${issues}
    </div>`;
}

function updateWaterManagerCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('waterManagerCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderWaterManagerCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderWaterManagerSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const status = String(live?.status || (live?.alarm ? 'alarm' : 'idle')).toUpperCase();
  const flow = live?.flow;
  const pressure = live?.pressure;
  const warns = [];
  if (!mapped('main_valve')) warns.push('No main valve mapped');
  if (![1,2,3,4].some(i => mapped('leak_sensor_'+i))) warns.push('No leak sensors mapped');
  const pills = [
    renderBadge(status, status==='ALARM' ? '#ff6b6b' : (status==='PAUSED' ? '#f59e0b' : '#22d97a'), status==='ALARM' ? 'rgba(255,107,107,.35)' : (status==='PAUSED' ? 'rgba(245,158,11,.35)' : 'rgba(34,217,122,.35)')),
    mapped('main_valve') ? renderBadge('VALVE READY', 'var(--text)', 'var(--line)') : '',
    mapped('flow_sensor') ? renderBadge('FLOW READY', '#1d8cff', 'rgba(29,140,255,.28)') : '',
    mapped('pressure_sensor') ? renderBadge('PRESSURE READY', '#1d8cff', 'rgba(29,140,255,.28)') : '',
    live?.shutoff_closed ? renderBadge('SHUTOFF CLOSED', '#ff6b6b', 'rgba(255,107,107,.35)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (live?.lockout_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge('ALARM · '+String(live.lockout_reason).slice(0,80), '#ff6b6b', 'rgba(255,107,107,.35)')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 4px">${flow!=null ? renderBadge('FLOW '+flow, 'var(--text)', 'var(--line)') : ''}${pressure!=null ? renderBadge('PRESS '+pressure, 'var(--text)', 'var(--line)') : ''}${live?.last_trip_ts ? renderBadge('TRIPPED '+new Date(live.last_trip_ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), 'var(--muted)', 'var(--line)') : ''}</div>`;
  return html;
}

registerModule('water_manager', {
  hasAuto: true,
  summaryBoxId: 'waterManagerCommissioningSummary',
  updateCommissioningSummary(m) { updateWaterManagerCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderWaterManagerSummary(inst, s, live); },
});
