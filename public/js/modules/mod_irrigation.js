// public/js/modules/mod_irrigation.js

function analyzeIrrigationMappings(currentMappings={}) {
  const ioUse = new Map();
  const issues = [];
  const note = (id, label) => {
    if (!id) return;
    if (!ioUse.has(id)) ioUse.set(id, []);
    ioUse.get(id).push(label);
  };

  const zoneRows = [1,2,3].map(i => ({
    idx:i,
    zone: Number(currentMappings['zone_'+i]||0)||null,
    minutes: Number(currentMappings['zone_'+i+'_min']||0)||0
  }));
  const master = Number(currentMappings['master_valve']||0)||null;
  const rain = Number(currentMappings['rain_sensor']||0)||null;
  const soil = Number(currentMappings['soil_moisture']||0)||null;
  const temp = Number(currentMappings['temp_outdoor']||0)||null;
  const wind = Number(currentMappings['wind_sensor']||0)||null;
  const lux = Number(currentMappings['lux_sensor']||0)||null;
  const flow = Number(currentMappings['flow_sensor']||0)||null;

  zoneRows.forEach(z => note(z.zone, `Zone ${z.idx}`));
  [[master,'Master valve'],[rain,'Rain sensor'],[soil,'Soil moisture'],[temp,'Outdoor temp'],[wind,'Wind sensor'],[lux,'Lux'],[flow,'Flow sensor']].forEach(([id,label])=>note(id,label));

  const configuredZones = zoneRows.filter(z => z.zone);
  if (!configuredZones.length) issues.push({severity:'bad', message:'Map at least one irrigation zone valve/relay.'});
  if (configuredZones.length && !configuredZones.some(z => z.idx===1 && z.zone)) {
    issues.push({severity:'warn', message:'Zone 1 is not mapped. Sequential runs normally start from zone 1.'});
  }
  if (configuredZones.some(z => z.zone) && configuredZones.every(z => !z.zone || z.minutes<=0)) {
    issues.push({severity:'warn', message:'All mapped zones have zero configured duration. Set zone minutes in setpoints after saving.'});
  }
  if (master && configuredZones.some(z => z.zone===master)) issues.push({severity:'bad', message:'Master valve reuses the same output as a zone valve.'});
  if (flow && !configuredZones.length) issues.push({severity:'info', message:'Flow meter is mapped but no zones are configured yet.'});
  if (lux && !temp) issues.push({severity:'info', message:'Lux sensor helps ET estimation only when outdoor temperature is also mapped.'});
  if (soil && !rain) issues.push({severity:'info', message:'Only soil moisture is mapped. Consider adding rain sensor for better skip logic.'});
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.`});
  });

  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return {zoneRows, configuredZones, master, rain, soil, temp, wind, lux, flow, issues, readiness};
}

function renderIrrigationCommissioningSummary(currentMappings={}) {
  const a = analyzeIrrigationMappings(currentMappings);
  const zonePills = a.zoneRows.filter(z=>z.zone).map(z => `<span class="thermo-zone-pill"><strong>Z${z.idx}</strong><span class="mini">${ioLabelById(z.zone)}</span></span>`).join('') || `<span class="thermo-zone-pill"><strong>No zones</strong><span class="mini">Map one or more irrigation outputs.</span></span>`;
  const sensorPills = [
    a.rain ? `<span class="thermo-zone-pill"><strong>Rain</strong><span class="mini">${ioLabelById(a.rain)}</span></span>` : '',
    a.soil ? `<span class="thermo-zone-pill"><strong>Soil</strong><span class="mini">${ioLabelById(a.soil)}</span></span>` : '',
    a.temp ? `<span class="thermo-zone-pill"><strong>Outdoor Temp</strong><span class="mini">${ioLabelById(a.temp)}</span></span>` : '',
    a.wind ? `<span class="thermo-zone-pill"><strong>Wind</strong><span class="mini">${ioLabelById(a.wind)}</span></span>` : '',
    a.lux ? `<span class="thermo-zone-pill"><strong>Lux</strong><span class="mini">${ioLabelById(a.lux)}</span></span>` : '',
    a.flow ? `<span class="thermo-zone-pill"><strong>Flow</strong><span class="mini">${ioLabelById(a.flow)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>No sensors</strong><span class="mini">Rain / soil / temp / wind / flow are optional but useful.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Irrigation mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this irrigation setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Zones</div><div class="thermo-stat-v">${a.configuredZones.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Master</div><div class="thermo-stat-v">${a.master ? 'Mapped' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Sensors</div><div class="thermo-stat-v">${[a.rain,a.soil,a.temp,a.wind,a.lux,a.flow].filter(Boolean).length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Rain lockout</div><div class="thermo-stat-v">${a.rain ? 'Ready' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Flow alert</div><div class="thermo-stat-v">${a.flow ? 'Ready' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">ET inputs</div><div class="thermo-stat-v">${a.temp ? (a.lux ? 'Temp + Lux' : 'Temp only') : 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Zone outputs</div>
      <div class="thermo-zone-sum">${zonePills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Optional sensors / helpers</div>
      <div class="thermo-zone-sum">${sensorPills}</div>
      ${issues}
    </div>`;
}

function updateIrrigationCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('irrigationCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderIrrigationCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderIrrigationSummary(inst, settings, live) {
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const status = String(live?.status || live?.phase || 'idle').toUpperCase();
  const currentZone = live?.current_zone ? `Z${live.current_zone}` : '—';
  const remaining = Number(live?.remaining_sec||0);
  const remTxt = remaining>0 ? `${Math.floor(remaining/60)}m ${String(remaining%60).padStart(2,'0')}s` : '—';
  const warns = [];
  if (!mapped('zone_1')) warns.push('No Zone 1 output');
  if (![1,2,3].some(i => mapped(`zone_${i}`))) warns.push('No irrigation zones mapped');
  if (mapped('master_valve') && ![1,2,3].some(i => mapped(`zone_${i}`))) warns.push('Master valve without zones');
  const pills = [
    renderBadge(status, live?.phase==='running' ? 'var(--good)' : (status==='BLOCKED' ? '#f59e0b' : 'var(--muted2)'), live?.phase==='running' ? 'rgba(34,217,122,.3)' : (status==='BLOCKED' ? 'rgba(245,158,11,.35)' : 'var(--line)')),
    renderBadge(`ZONE ${currentZone}`, '#22d97a', 'rgba(34,217,122,.3)'),
    renderBadge(`LEFT ${remTxt}`, 'var(--text)', 'var(--line)'),
    live?.manual_mode ? renderBadge('MANUAL', '#f0c040', 'rgba(240,192,64,.3)') : '',
    mapped('master_valve') ? renderBadge('MASTER READY', 'var(--text)', 'var(--line)') : '',
    mapped('flow_sensor') ? renderBadge('FLOW READY', '#1d8cff', 'rgba(29,140,255,.28)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (live?.lockout_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge('LOCKOUT · '+String(live.lockout_reason).slice(0,80), '#f59e0b', 'rgba(245,158,11,.35)')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ '+w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('irrigation', {
  hasAuto: true,
  summaryBoxId: 'irrigationCommissioningSummary',
  updateCommissioningSummary(m) { updateIrrigationCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderIrrigationSummary(inst, s, live); },
});
