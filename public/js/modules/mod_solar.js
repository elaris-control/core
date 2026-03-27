// public/js/modules/mod_solar.js

function solarBool(v) {
  return v === true || v === 1 || v === '1' || String(v || '').toUpperCase() === 'ON' || String(v || '').toLowerCase() === 'true';
}

function solarStateBadge(label, active) {
  if (active) return renderBadge(`${label} ON`, '#ff9a3a', 'rgba(255,154,58,.28)');
  return renderBadge(`${label} OFF`, 'var(--muted)', 'var(--line)');
}

function resolveSolarMappings(currentMappings = {}) {
  const live = (typeof collectCurrentWizardMappings === 'function') ? collectCurrentWizardMappings() : {};
  const src = (currentMappings && Object.keys(currentMappings).length) ? currentMappings : live;
  return src || {};
}

function analyzeSolarMappings(currentMappings = {}) {
  const resolved = resolveSolarMappings(currentMappings);
  const map = key => Number(resolved[key] || 0) || null;
  const sensorSolar = map('temp_solar');
  const sensorBoiler = map('temp_boiler');
  const pump = map('pump');
  const pumpSpeed = map('pump_speed');
  const heater = map('heater');
  const backup = map('backup');
  const issues = [];

  if (!sensorSolar) issues.push({ severity: 'bad', message: 'Collector temperature sensor is required.' });
  if (!sensorBoiler) issues.push({ severity: 'bad', message: 'Boiler temperature sensor is required.' });
  if (!pump) issues.push({ severity: 'bad', message: 'Solar pump output is required.' });
  if (sensorSolar && sensorBoiler && sensorSolar === sensorBoiler) {
    issues.push({ severity: 'bad', message: 'Collector and boiler temperatures use the same IO.' });
  }
  if (pumpSpeed && !pump) {
    issues.push({ severity: 'warn', message: 'Pump speed is mapped without a main pump output.' });
  }
  if (pumpSpeed && typeof siteIO !== 'undefined' && Array.isArray(siteIO)) {
    const io = siteIO.find(x => Number(x.id) === Number(pumpSpeed));
    if (io && !['dimmer', 'ao', 'analog', 'pwm'].includes(String(io.type || '').toLowerCase())) {
      issues.push({ severity: 'warn', message: 'Pump speed should normally be an analog/dimmer output.' });
    }
  }
  if (heater && backup && heater === backup) {
    issues.push({ severity: 'bad', message: 'Heater and backup heat source use the same actuator.' });
  }

  const outputs = [pump, pumpSpeed, heater, backup].filter(Boolean).length;
  const inputs = [sensorSolar, sensorBoiler].filter(Boolean).length;
  const readiness = issues.some(i => i.severity === 'bad') ? 'Needs fixes' : (issues.some(i => i.severity === 'warn') ? 'Check mappings' : 'Ready');
  return { sensorSolar, sensorBoiler, pump, pumpSpeed, heater, backup, outputs, inputs, issues, readiness };
}

function renderSolarCommissioningSummary(currentMappings = {}) {
  const a = analyzeSolarMappings(currentMappings);
  const outputPills = [
    a.pump ? `<span class="thermo-zone-pill"><strong>Pump</strong><span class="mini">${ioLabelById(a.pump)}</span></span>` : '',
    a.pumpSpeed ? `<span class="thermo-zone-pill"><strong>Pump Speed</strong><span class="mini">${ioLabelById(a.pumpSpeed)}</span></span>` : '',
    a.heater ? `<span class="thermo-zone-pill"><strong>Heater</strong><span class="mini">${ioLabelById(a.heater)}</span></span>` : '',
    a.backup ? `<span class="thermo-zone-pill"><strong>Backup</strong><span class="mini">${ioLabelById(a.backup)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No outputs</strong><span class="mini">Pump is required. Heater and backup are optional.</span></span>`;
  const inputPills = [
    a.sensorSolar ? `<span class="thermo-zone-pill"><strong>Collector</strong><span class="mini">${ioLabelById(a.sensorSolar)}</span></span>` : '',
    a.sensorBoiler ? `<span class="thermo-zone-pill"><strong>Boiler</strong><span class="mini">${ioLabelById(a.sensorBoiler)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No sensors</strong><span class="mini">Map collector and boiler temperatures.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> This solar mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this solar setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Inputs</div><div class="thermo-stat-v">${a.inputs}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Outputs</div><div class="thermo-stat-v">${a.outputs}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Pump</div><div class="thermo-stat-v">${a.pump ? 'Mapped' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Speed ctrl</div><div class="thermo-stat-v">${a.pumpSpeed ? 'Mapped' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Heater</div><div class="thermo-stat-v">${a.heater ? 'Mapped' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Backup</div><div class="thermo-stat-v">${a.backup ? 'Mapped' : 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Sensors</div>
      <div class="thermo-zone-sum">${inputPills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Outputs</div>
      <div class="thermo-zone-sum">${outputPills}</div>
      ${issues}
    </div>`;
}

function updateSolarCommissioningSummary(currentMappings = null) {
  const box = document.getElementById('solarCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderSolarCommissioningSummary(resolveSolarMappings(currentMappings || {}));
}

function renderSolarSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const status = String(live?.status || 'idle').toUpperCase();
  const diff = live?.diff != null ? `${live.diff >= 0 ? '+' : ''}${live.diff}°` : '—';
  const collectorRaw = live?.tempSolar ?? live?.temp_solar;
  const boilerRaw = live?.tempBoiler ?? live?.temp_boiler;
  const tempSolar = collectorRaw != null ? `${Number(collectorRaw).toFixed(1)}°` : '—';
  const tempBoiler = boilerRaw != null ? `${Number(boilerRaw).toFixed(1)}°` : '—';
  const pumpOn = solarBool(live?.pumpOn ?? live?.pump_on ?? live?.pump_run);
  const heaterOn = solarBool(live?.heater_on);
  const backupOn = solarBool(live?.backup_on);
  const warns = [];
  if (!mapped('pump')) warns.push('No pump mapped');
  if (!mapped('temp_solar')) warns.push('No collector sensor');
  if (!mapped('temp_boiler')) warns.push('No boiler sensor');
  if (mapped('pump_speed') && !mapped('pump')) warns.push('Speed mapped without pump');
  const pills = [
    renderBadge(status, pumpOn ? 'var(--good)' : 'var(--muted)', pumpOn ? 'rgba(34,217,122,.35)' : 'var(--line)'),
    renderBadge(`ΔT ${diff}`, '#22d97a', 'rgba(34,217,122,.28)'),
    renderBadge(`COLLECTOR ${tempSolar}`, '#ff9a3a', 'rgba(255,154,58,.28)'),
    renderBadge(`BOILER ${tempBoiler}`, '#1d8cff', 'rgba(29,140,255,.28)'),
    mapped('heater') ? solarStateBadge('HEATER', heaterOn) : '',
    mapped('backup') ? solarStateBadge('BACKUP', backupOn) : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ ' + w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('solar', {
  hasAuto: true,
  summaryBoxId: 'solarCommissioningSummary',
  updateCommissioningSummary(m) { updateSolarCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderSolarSummary(inst, s, live); },
});
