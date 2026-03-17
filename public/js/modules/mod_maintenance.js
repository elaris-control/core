// public/js/modules/mod_maintenance.js

function analyzeMaintenanceMappings(currentMappings={}) {
  const equipments = [1,2,3,4].map(i => ({ idx:i, io:Number(currentMappings['equipment_'+i]||0)||null }));
  const intervals = [1,2,3,4].map(i => ({ idx:i, value:Number(document.getElementById('sp_new_service_interval_h_'+i)?.value || document.getElementById('sp_0_service_interval_h_'+i)?.value || 0) }));
  const names = [1,2,3,4].map(i => ({ idx:i, value:String(document.getElementById('sp_new_equipment_name_'+i)?.value || document.getElementById('sp_0_equipment_name_'+i)?.value || ('Equipment '+i)).trim() }));
  const issues = [];
  const ioUse = new Map();
  const note = (id,label) => { if(!id) return; if(!ioUse.has(id)) ioUse.set(id, []); ioUse.get(id).push(label); };
  equipments.forEach(eq => note(eq.io, 'Equipment '+eq.idx));
  const mapped = equipments.filter(e => e.io);
  if (!equipments[0].io) issues.push({ severity:'bad', message:'Map Equipment 1. At least one tracked equipment input is required.' });
  if (!mapped.length) issues.push({ severity:'bad', message:'Map at least one relay/DI that indicates running equipment.' });
  if (mapped.length === 1) issues.push({ severity:'info', message:'Only one equipment item is tracked. Add more later if needed.' });
  intervals.forEach(it => {
    if (mapped.some(e => e.idx===it.idx) && (!Number.isFinite(it.value) || it.value <= 0)) issues.push({ severity:'warn', message:`Service interval for equipment ${it.idx} should be greater than 0.` });
  });
  names.forEach(n => {
    if (mapped.some(e => e.idx===n.idx) && !n.value) issues.push({ severity:'warn', message:`Give equipment ${n.idx} a friendly name for notifications.` });
  });
  [...ioUse.entries()].forEach(([ioId, labels]) => { if (labels.length > 1) issues.push({ severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.` }); });
  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check settings' : 'Ready');
  return { equipments, mapped, intervals, names, issues, readiness };
}

function renderMaintenanceCommissioningSummary(currentMappings={}) {
  const a = analyzeMaintenanceMappings(currentMappings);
  const eqPills = a.mapped.length
    ? a.mapped.map(eq => `<span class="thermo-zone-pill"><strong>${(a.names.find(n=>n.idx===eq.idx)?.value)||('Equipment '+eq.idx)}</strong><span class="mini">${ioLabelById(eq.io)}</span></span>`).join('')
    : `<span class="thermo-zone-pill"><strong>No equipment mapped</strong><span class="mini">Map one or more running-state relays/inputs.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Maintenance tracker mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this maintenance tracker setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Tracked items</div><div class="thermo-stat-v">${a.mapped.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Equipment 1</div><div class="thermo-stat-v">${a.equipments[0].io ? 'Mapped' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Reminders</div><div class="thermo-stat-v">${a.mapped.length ? 'Enabled' : 'Idle'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Tracked equipment</div>
      <div class="thermo-zone-sum">${eqPills}</div>
      ${issues}
    </div>`;
}

function updateMaintenanceCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('maintenanceCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderMaintenanceCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderMaintenanceSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const state = live?.state || {};
  const tracked = Array.isArray(state.equipment) ? state.equipment : [1,2,3,4].filter(i => mapped('equipment_'+i)).map(i => ({
    idx:i,
    name: settings['equipment_name_'+i] || ('Equipment '+i),
    hours: Number(settings['_hours_'+i] || 0),
    interval: Number(settings['service_interval_h_'+i] || 0),
    due: Number(settings['service_interval_h_'+i]||0) > 0 && (Number(settings['_hours_'+i]||0) - Number(settings['_hours_at_service_'+i]||0)) >= Number(settings['service_interval_h_'+i]||0),
    on: false
  }));
  const dueCount = Number(state.due_count != null ? state.due_count : tracked.filter(t=>t.due).length);
  const runningCount = Number(state.running_count != null ? state.running_count : tracked.filter(t=>t.on).length);
  const status = String(state.status || (dueCount>0 ? 'service_due' : 'monitoring')).toUpperCase();
  const warns = [];
  if (!mapped('equipment_1')) warns.push('Equipment 1 is not mapped');
  if (!tracked.length) warns.push('No tracked equipment mapped');
  const pills = [
    renderBadge(status, status==='SERVICE_DUE' ? '#ff6b6b' : '#22d97a', status==='SERVICE_DUE' ? 'rgba(255,107,107,.35)' : 'rgba(34,217,122,.35)'),
    renderBadge('TRACKED '+tracked.length, 'var(--text)', 'var(--line)'),
    renderBadge('RUNNING '+runningCount, '#1d8cff', 'rgba(29,140,255,.28)'),
    dueCount ? renderBadge('DUE '+dueCount, '#ff6b6b', 'rgba(255,107,107,.35)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (state.last_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(String(state.last_reason).slice(0,80), 'var(--muted)', 'var(--line)')}</div>`;
  if (tracked.length) {
    const rows = tracked.slice(0,4).map(t => {
      const due = !!t.due;
      const since = Number(t.hours_since_service != null ? t.hours_since_service : Math.max(0, Number(t.hours||0) - Number(settings['_hours_at_service_'+t.idx]||0)));
      return renderBadge(`${due ? '⚠ ' : ''}${(t.name||('Eq '+t.idx)).toUpperCase().slice(0,18)} ${Number(since).toFixed(0)}h`, due ? '#ff6b6b' : (t.on ? '#22d97a' : 'var(--muted)'), due ? 'rgba(255,107,107,.35)' : (t.on ? 'rgba(34,217,122,.28)' : 'var(--line)'));
    }).join('');
    html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${rows}</div>`;
  }
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('maintenance', {
  hasAuto: false,
  summaryBoxId: 'maintenanceCommissioningSummary',
  updateCommissioningSummary(m) { updateMaintenanceCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderMaintenanceSummary(inst, s, live); },
});
