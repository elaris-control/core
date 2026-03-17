// public/js/modules/mod_energy.js

function analyzeEnergyMappings(currentMappings={}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const power = map('power_w');
  const relay = map('relay');
  const tariff = Number(document.getElementById('sp_new_tariff')?.value || document.getElementById('sp_0_tariff')?.value || 0.20);
  const resetHour = Number(document.getElementById('sp_new_reset_hour')?.value || document.getElementById('sp_0_reset_hour')?.value || 0);
  const alertAbove = Number(document.getElementById('sp_new_alert_above_w')?.value || document.getElementById('sp_0_alert_above_w')?.value || 0);
  const issues = [];
  if (!power) issues.push({ severity:'bad', message:'Map a power meter (W) input.' });
  if (power && relay && power === relay) issues.push({ severity:'bad', message:'Power meter and controlled relay use the same IO.' });
  if (!relay) issues.push({ severity:'info', message:'Controlled relay is optional. Map it only if you want an energy-linked load output.' });
  if (!Number.isFinite(tariff) || tariff < 0) issues.push({ severity:'warn', message:'Tariff should be a positive number.' });
  if (!Number.isFinite(resetHour) || resetHour < 0 || resetHour > 23) issues.push({ severity:'bad', message:'Daily reset hour must be between 0 and 23.' });
  if (Number.isFinite(alertAbove) && alertAbove < 0) issues.push({ severity:'warn', message:'Alert threshold should be 0 or higher.' });
  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check settings' : 'Ready');
  return { power, relay, tariff, resetHour, alertAbove, issues, readiness };
}

function renderEnergyCommissioningSummary(currentMappings={}) {
  const a = analyzeEnergyMappings(currentMappings);
  const ioPills = [
    a.power ? `<span class="thermo-zone-pill"><strong>Power meter</strong><span class="mini">${ioLabelById(a.power)}</span></span>` : '',
    a.relay ? `<span class="thermo-zone-pill"><strong>Relay</strong><span class="mini">${ioLabelById(a.relay)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No IO mapped</strong><span class="mini">Map a power sensor to enable monitoring.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Energy Monitor setup looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this energy monitor setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Power meter</div><div class="thermo-stat-v">${a.power ? 'Mapped' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Relay</div><div class="thermo-stat-v">${a.relay ? 'Mapped' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Tariff</div><div class="thermo-stat-v">€${Number(a.tariff||0).toFixed(2)}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Reset hour</div><div class="thermo-stat-v">${a.resetHour}:00</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Alert above</div><div class="thermo-stat-v">${a.alertAbove>0 ? a.alertAbove+'W' : 'Off'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Mapped IO</div>
      <div class="thermo-zone-sum">${ioPills}</div>
      ${issues}
    </div>`;
}

function updateEnergyCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('energyCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderEnergyCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderEnergySummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const state = live?.state || {};
  const watts = state.watts != null ? Math.round(Number(state.watts)) : (live?.values?.power_w != null ? Math.round(Number(live.values.power_w)) : null);
  const kwhToday = Number(state.kwh_today != null ? state.kwh_today : settings['_kwh_today'] || 0);
  const kwhMonth = Number(state.kwh_month != null ? state.kwh_month : settings['_kwh_month'] || 0);
  const tariff = Number(state.tariff != null ? state.tariff : settings['tariff'] || 0.2);
  const status = String(state.status || (live?.paused ? 'paused' : 'monitoring')).toUpperCase();
  const warns = [];
  if (!mapped('power_w')) warns.push('No power meter mapped');
  const pills = [
    renderBadge(status, status==='ALERT' ? '#ff6b6b' : (status==='PAUSED' ? '#f59e0b' : '#22d97a'), status==='ALERT' ? 'rgba(255,107,107,.35)' : (status==='PAUSED' ? 'rgba(245,158,11,.35)' : 'rgba(34,217,122,.35)')),
    watts!=null ? renderBadge('LIVE '+watts+'W', '#f59e0b', 'rgba(245,158,11,.28)') : '',
    renderBadge('TODAY '+kwhToday.toFixed(2)+'kWh', 'var(--text)', 'var(--line)'),
    renderBadge('MONTH '+kwhMonth.toFixed(2)+'kWh', 'var(--muted)', 'var(--line)'),
    mapped('relay') ? renderBadge((state.relay_on ? 'RELAY ON' : 'RELAY READY'), '#1d8cff', 'rgba(29,140,255,.28)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (state.last_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(String(state.last_reason).slice(0,90), 'var(--muted)', 'var(--line)')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 4px">${renderBadge('€ '+(kwhToday * tariff).toFixed(2)+' today', 'var(--muted)', 'var(--line)')}${renderBadge('TARIFF €'+tariff.toFixed(2)+'/kWh', 'var(--muted)', 'var(--line)')}</div>`;
  return html;
}

registerModule('energy_manager', {
  hasAuto: false,
  summaryBoxId: 'energyCommissioningSummary',
  updateCommissioningSummary(m) { updateEnergyCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderEnergySummary(inst, s, live); },
});
