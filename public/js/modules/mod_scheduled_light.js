// public/js/modules/mod_scheduled_light.js

function analyzeScheduledLightMappings(currentMappings = {}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const relay    = map('light_relay');
  const relay2   = map('light_relay_2');
  const relay3   = map('light_relay_3');
  const relay4   = map('light_relay_4');
  const switchDi = map('switch_di');
  const issues   = [];

  if (!relay) issues.push({ severity: 'bad', message: 'Map at least one light relay output.' });
  if (!switchDi) issues.push({ severity: 'info', message: 'No wall switch mapped. Control via schedule and dashboard only.' });

  const relays = [relay, relay2, relay3, relay4].filter(Boolean);
  if (new Set(relays).size < relays.length) issues.push({ severity: 'warn', message: 'Same relay mapped more than once.' });

  const readiness = issues.some(i => i.severity === 'bad') ? 'Needs output' : issues.some(i => i.severity === 'warn') ? 'Check mappings' : 'Ready';
  return { relay, relay2, relay3, relay4, switchDi, issues, readiness, relayCount: relays.length };
}

function renderScheduledLightCommissioningSummary(currentMappings = {}) {
  const a = analyzeScheduledLightMappings(currentMappings);
  const outPills = [a.relay, a.relay2, a.relay3, a.relay4].filter(Boolean).map((id, i) =>
    `<span class="thermo-zone-pill"><strong>Relay ${i + 1}</strong><span class="mini">${ioLabelById(id)}</span></span>`
  ).join('') || `<span class="thermo-zone-pill"><strong>No output</strong><span class="mini">Map a relay to continue.</span></span>`;
  const inPills = a.switchDi
    ? `<span class="thermo-zone-pill"><strong>Switch</strong><span class="mini">${ioLabelById(a.switchDi)}</span></span>`
    : `<span class="thermo-zone-pill"><strong>No switch</strong><span class="mini">Dashboard + schedule control only.</span></span>`;
  const issuesHtml = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Scheduled Light mapping looks good. Set ON/OFF times in setpoints.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Scheduled Light — ON/OFF at fixed or sun-relative times.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Relay outputs</div><div class="thermo-stat-v">${a.relayCount}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Wall switch</div><div class="thermo-stat-v">${a.switchDi ? 'Mapped' : '—'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Outputs</div>
      <div class="thermo-zone-sum">${outPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Inputs</div>
      <div class="thermo-zone-sum">${inPills}</div>
      ${issuesHtml}
    </div>`;
}

function updateScheduledLightCommissioningSummary(currentMappings = null) {
  const box = document.getElementById('scheduledLightCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderScheduledLightCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderScheduledLightSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const state = live?.state || {};
  const relays = ['light_relay','light_relay_2','light_relay_3','light_relay_4'].filter(mapped);
  const schedOn  = settings.schedule_on  || '';
  const schedOff = settings.schedule_off || '';
  const parts = [];
  parts.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">
    ${renderBadge(state.output_on ? 'ON' : 'OFF', state.output_on ? '#22d97a' : 'var(--muted)', state.output_on ? 'rgba(34,217,122,.25)' : 'var(--line)')}
    ${state.schedule_active != null ? renderBadge(state.schedule_active ? 'IN SCHEDULE' : 'OFF SCHEDULE', state.schedule_active ? '#f5c842' : 'var(--muted)', state.schedule_active ? 'rgba(245,200,66,.25)' : 'var(--line)') : ''}
    ${schedOn && schedOff ? renderBadge(schedOn + ' – ' + schedOff, 'var(--muted)', 'var(--line)') : ''}
    ${relays.length ? renderBadge(relays.length + ' RELAY' + (relays.length > 1 ? 'S' : ''), 'var(--text)', 'var(--line)') : ''}
  </div>`);
  if (state.last_reason) parts.push(`<div style="font-size:11px;color:var(--muted);margin-bottom:4px">${escapeHTML(String(state.last_reason))}</div>`);
  return parts.join('');
}

registerModule('scheduled_light', {
  hasAuto: true,
  summaryBoxId: 'scheduledLightCommissioningSummary',
  updateCommissioningSummary(m) { updateScheduledLightCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderScheduledLightSummary(inst, s, live); },
});
