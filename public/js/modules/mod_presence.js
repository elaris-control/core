// public/js/modules/mod_presence.js

function analyzePresenceMappings(currentMappings={}) {
  const lightIds = [1,2,3,4].map(i => Number(currentMappings['light_'+i]||0)).filter(Boolean);
  const tv = Number(currentMappings['tv_relay']||0)||null;
  const awning = Number(currentMappings['awning_relay']||0)||null;
  const issues = [];
  const ioUse = new Map();
  const note = (id,label) => { if(!id) return; if(!ioUse.has(id)) ioUse.set(id, []); ioUse.get(id).push(label); };
  lightIds.forEach((id, idx) => note(id, 'Light ' + (idx+1)));
  note(tv, 'TV relay');
  note(awning, 'Awning relay');
  if (!lightIds.length) issues.push({severity:'bad', message:'Map at least one light output.'});
  if (lightIds.length === 1) issues.push({severity:'info', message:'Only one light is mapped. Add more lights for a more natural simulation.'});
  if (!tv && !awning) issues.push({severity:'info', message:'Only light simulation is configured. TV and awning are optional.'});
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.`});
  });
  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return { lightIds, tv, awning, issues, readiness };
}

function renderPresenceCommissioningSummary(currentMappings={}) {
  const a = analyzePresenceMappings(currentMappings);
  const lightPills = a.lightIds.length
    ? a.lightIds.map((id, idx)=>`<span class="thermo-zone-pill"><strong>Light ${idx+1}</strong><span class="mini">${ioLabelById(id)}</span></span>`).join('')
    : `<span class="thermo-zone-pill"><strong>No lights</strong><span class="mini">Map one or more light outputs.</span></span>`;
  const helperPills = [
    a.tv ? `<span class="thermo-zone-pill"><strong>TV</strong><span class="mini">${ioLabelById(a.tv)}</span></span>` : '',
    a.awning ? `<span class="thermo-zone-pill"><strong>Awning</strong><span class="mini">${ioLabelById(a.awning)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No extras</strong><span class="mini">TV / awning are optional.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Presence simulation mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this presence simulation setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Lights</div><div class="thermo-stat-v">${a.lightIds.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">TV</div><div class="thermo-stat-v">${a.tv ? 'Ready' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Awning</div><div class="thermo-stat-v">${a.awning ? 'Ready' : 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Light outputs</div>
      <div class="thermo-zone-sum">${lightPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Optional outputs</div>
      <div class="thermo-zone-sum">${helperPills}</div>
      ${issues}
    </div>`;
}

function updatePresenceCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('presenceCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderPresenceCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderPresenceSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const lights = [1,2,3,4].filter(i => mapped('light_'+i));
  const status = String(live?.status || (settings?.armed==='1' ? 'armed' : 'disarmed')).toUpperCase();
  const warns = [];
  if (!lights.length) warns.push('No light outputs mapped');
  if (lights.length === 1) warns.push('Only one light mapped');
  const pills = [
    renderBadge(status, status==='ARMED' ? '#a855f7' : 'var(--muted2)', status==='ARMED' ? 'rgba(168,85,247,.3)' : 'var(--line)'),
    renderBadge(`LIGHTS ${live?.active_lights||0}/${lights.length}`, '#22d97a', 'rgba(34,217,122,.3)'),
    renderBadge(`${live?.evening_start || settings?.evening_start || '18:00'}–${live?.evening_end || settings?.evening_end || '23:00'}`, 'var(--text)', 'var(--line)'),
    mapped('tv_relay') ? renderBadge(`TV ${live?.tv_on ? 'ON' : 'READY'}`, live?.tv_on ? '#22d97a' : 'var(--text)', live?.tv_on ? 'rgba(34,217,122,.3)' : 'var(--line)') : '',
    mapped('awning_relay') ? renderBadge(`AWNING ${live?.awning_on ? 'ON' : 'READY'}`, live?.awning_on ? '#22d97a' : 'var(--text)', live?.awning_on ? 'rgba(34,217,122,.3)' : 'var(--line)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('presence_simulator', {
  hasAuto: false,
  summaryBoxId: 'presenceCommissioningSummary',
  updateCommissioningSummary(m) { updatePresenceCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderPresenceSummary(inst, s, live); },
});
