// public/js/modules/mod_pool_spa.js

function analyzePoolSpaMappings(currentMappings={}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const issues = [];
  const ioUse = new Map();
  const note = (id, label) => { if (!id) return; if (!ioUse.has(id)) ioUse.set(id, []); ioUse.get(id).push(label); };

  const core = {
    filterPump: map('filter_pump'),
    tempWater: map('temp_water'),
  };
  const heating = {
    solarPump: map('solar_pump'),
    collector: map('temp_collector'),
    buffer: map('temp_buffer'),
    source1: map('heat_source_1'),
    source2: map('heat_source_2'),
    hp1Fault: map('hp_1_fault'),
    hp2Fault: map('hp_2_fault'),
    defrost: map('hp_defrost'),
  };
  const safety = {
    flow: map('flow_switch'),
    pressure: map('pressure_sensor'),
    level: map('level_sensor'),
    backwash: map('backwash_valve'),
    outdoor: map('temp_outdoor'),
  };
  const chemistry = {
    ph: map('ph_sensor'),
    orp: map('orp_sensor'),
    phMinus: map('ph_minus_pump'),
    phPlus: map('ph_plus_pump'),
    cl: map('cl_pump'),
  };
  const extras = {
    spaJets: map('spa_jets'),
    lights: map('lights'),
    lux: map('lux_sensor'),
  };

  Object.entries({
    'Filter pump': core.filterPump,
    'Water temp': core.tempWater,
    'Solar pump': heating.solarPump,
    'Collector temp': heating.collector,
    'Buffer temp': heating.buffer,
    'Heat source 1': heating.source1,
    'Heat source 2': heating.source2,
    'HP1 fault': heating.hp1Fault,
    'HP2 fault': heating.hp2Fault,
    'Defrost': heating.defrost,
    'Flow switch': safety.flow,
    'Pressure sensor': safety.pressure,
    'Level sensor': safety.level,
    'Backwash valve': safety.backwash,
    'Outdoor temp': safety.outdoor,
    'pH sensor': chemistry.ph,
    'ORP sensor': chemistry.orp,
    'pH- pump': chemistry.phMinus,
    'pH+ pump': chemistry.phPlus,
    'Cl pump': chemistry.cl,
    'Spa jets': extras.spaJets,
    'Lights': extras.lights,
    'Lux sensor': extras.lux,
  }).forEach(([label, id]) => note(id, label));

  if (!core.filterPump) issues.push({ severity:'bad', message:'Map the filter pump relay.' });
  if (!core.tempWater) issues.push({ severity:'bad', message:'Map the pool water temperature sensor.' });
  if (heating.source2 && !heating.source1) issues.push({ severity:'bad', message:'Heat Source 2 is mapped, but Heat Source 1 is missing. Source 2 is fallback-only in this module.' });
  if (heating.solarPump && !heating.collector) issues.push({ severity:'warn', message:'Solar pump is mapped without collector temperature. Solar heating cannot calculate ΔT.' });
  if (heating.collector && !heating.solarPump) issues.push({ severity:'warn', message:'Collector temperature is mapped without solar pump output.' });
  if (heating.buffer && !heating.solarPump) issues.push({ severity:'info', message:'Buffer temperature is mapped, but solar pump is missing. Thermal dump will not run.' });
  if ((heating.source1 || heating.source2 || heating.solarPump) && !safety.flow) issues.push({ severity:'info', message:'Add a flow switch for safer heater / solar shutdown verification.' });
  if (safety.backwash && !safety.pressure) issues.push({ severity:'info', message:'Backwash valve is mapped without pressure sensor. Backwash stays manual-confirm only.' });
  if (safety.pressure && !safety.backwash) issues.push({ severity:'info', message:'Pressure sensor is mapped without backwash valve. You will get alerts only.' });
  if (safety.backwash && !safety.level) issues.push({ severity:'info', message:'Add a level sensor so backwash can block on low water level.' });
  if (heating.hp1Fault && !heating.source1) issues.push({ severity:'warn', message:'HP1 fault input is mapped without Heat Source 1.' });
  if (heating.hp2Fault && !heating.source2) issues.push({ severity:'warn', message:'HP2 fault input is mapped without Heat Source 2.' });
  if (chemistry.phMinus && !chemistry.ph) issues.push({ severity:'warn', message:'pH- dosing pump is mapped without a pH sensor.' });
  if (chemistry.phPlus && !chemistry.ph) issues.push({ severity:'warn', message:'pH+ dosing pump is mapped without a pH sensor.' });
  if (chemistry.cl && !chemistry.orp) issues.push({ severity:'warn', message:'Chlorine dosing pump is mapped without an ORP sensor.' });
  if (chemistry.orp && !chemistry.ph) issues.push({ severity:'info', message:'ORP alert works best with pH sensor mapped, because chlorine advice is pH-first.' });
  if ((chemistry.ph || chemistry.orp) && !(chemistry.phMinus || chemistry.phPlus || chemistry.cl)) issues.push({ severity:'info', message:'Chemistry sensors are mapped, but no dosing pumps are configured. Alerts-only mode is fine.' });
  if (extras.lux && !extras.lights) issues.push({ severity:'info', message:'Lux sensor is mapped without pool lights output.' });
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({ severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.` });
  });

  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return {
    core, heating, safety, chemistry, extras, issues, readiness,
    solarReady: !!(heating.solarPump && heating.collector),
    heatingReady: !!heating.source1,
    chemistryCount: [chemistry.ph, chemistry.orp, chemistry.phMinus, chemistry.phPlus, chemistry.cl].filter(Boolean).length,
    safetyCount: [safety.flow, safety.pressure, safety.level, safety.backwash, safety.outdoor].filter(Boolean).length,
    extrasCount: [extras.spaJets, extras.lights, extras.lux].filter(Boolean).length,
  };
}

function renderPoolSpaCommissioningSummary(currentMappings={}) {
  const a = analyzePoolSpaMappings(currentMappings);
  const corePills = [
    a.core.filterPump ? `<span class="thermo-zone-pill"><strong>Filter</strong><span class="mini">${ioLabelById(a.core.filterPump)}</span></span>` : '',
    a.core.tempWater ? `<span class="thermo-zone-pill"><strong>Water Temp</strong><span class="mini">${ioLabelById(a.core.tempWater)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>Core</strong><span class="mini">Map filter pump + water temperature first.</span></span>`;
  const helperPills = [
    a.heating.solarPump ? `<span class="thermo-zone-pill"><strong>Solar Pump</strong><span class="mini">${ioLabelById(a.heating.solarPump)}</span></span>` : '',
    a.heating.collector ? `<span class="thermo-zone-pill"><strong>Collector</strong><span class="mini">${ioLabelById(a.heating.collector)}</span></span>` : '',
    a.heating.source1 ? `<span class="thermo-zone-pill"><strong>Source 1</strong><span class="mini">${ioLabelById(a.heating.source1)}</span></span>` : '',
    a.heating.source2 ? `<span class="thermo-zone-pill"><strong>Source 2</strong><span class="mini">${ioLabelById(a.heating.source2)}</span></span>` : '',
    a.safety.flow ? `<span class="thermo-zone-pill"><strong>Flow</strong><span class="mini">${ioLabelById(a.safety.flow)}</span></span>` : '',
    a.safety.pressure ? `<span class="thermo-zone-pill"><strong>Pressure</strong><span class="mini">${ioLabelById(a.safety.pressure)}</span></span>` : '',
    a.safety.backwash ? `<span class="thermo-zone-pill"><strong>Backwash</strong><span class="mini">${ioLabelById(a.safety.backwash)}</span></span>` : '',
    a.chemistry.ph ? `<span class="thermo-zone-pill"><strong>pH</strong><span class="mini">${ioLabelById(a.chemistry.ph)}</span></span>` : '',
    a.chemistry.orp ? `<span class="thermo-zone-pill"><strong>ORP</strong><span class="mini">${ioLabelById(a.chemistry.orp)}</span></span>` : '',
    a.extras.spaJets ? `<span class="thermo-zone-pill"><strong>Spa Jets</strong><span class="mini">${ioLabelById(a.extras.spaJets)}</span></span>` : '',
    a.extras.lights ? `<span class="thermo-zone-pill"><strong>Lights</strong><span class="mini">${ioLabelById(a.extras.lights)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>Helpers</strong><span class="mini">Solar / heaters / chemistry / spa are optional.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Pool &amp; Spa mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this Pool &amp; Spa setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Core</div><div class="thermo-stat-v">${a.core.filterPump && a.core.tempWater ? 'Ready' : 'Required'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Solar</div><div class="thermo-stat-v">${a.solarReady ? 'Ready' : (a.heating.solarPump || a.heating.collector ? 'Partial' : 'Optional')}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Heating</div><div class="thermo-stat-v">${a.heatingReady ? (a.heating.source2 ? 'Primary + Fallback' : 'Primary only') : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Safety</div><div class="thermo-stat-v">${a.safetyCount || 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Chemistry</div><div class="thermo-stat-v">${a.chemistryCount || 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Spa / Lights</div><div class="thermo-stat-v">${a.extrasCount || 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Core mapping</div>
      <div class="thermo-zone-sum">${corePills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Helpers / subsystems</div>
      <div class="thermo-zone-sum">${helperPills}</div>
      ${issues}
    </div>`;
}

function updatePoolSpaCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('poolSpaCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderPoolSpaCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderPoolSpaSummary(inst, settings, liveWrap) {
  const live = liveWrap?.state || liveWrap || {};
  const values = liveWrap?.values || {};
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const status = String(live.status || (live.flow_fault ? 'fault' : (live.spa_active ? 'spa' : (live.filtration_active ? 'active' : 'idle')))).toUpperCase();
  const tempWater = values.temp_water != null ? Number(values.temp_water).toFixed(1) + '°C' : '—';
  const target = live.target_pool_temp != null ? Number(live.target_pool_temp).toFixed(1) + '°C' : (settings.pool_temp_target != null ? Number(settings.pool_temp_target).toFixed(1) + '°C' : '—');
  const hours = live.filt_hours_today != null ? Number(live.filt_hours_today).toFixed(1) + 'h' : (settings._filt_hours_today ? Number(settings._filt_hours_today).toFixed(1) + 'h' : '—');
  const hoursTarget = live.filt_target_today != null ? Number(live.filt_target_today).toFixed(0) + 'h' : (settings._filt_target_today ? Number(settings._filt_target_today).toFixed(0) + 'h' : '—');
  const pressure = values.pressure_sensor != null ? Number(values.pressure_sensor).toFixed(2) + ' bar' : '—';
  const ph = values.ph_sensor != null ? Number(values.ph_sensor).toFixed(2) : '—';
  const orp = values.orp_sensor != null ? Math.round(Number(values.orp_sensor)) + 'mV' : '—';
  const reason = String(live.last_reason || liveWrap?.lastLog?.[0]?.reason || (live.flow_fault ? 'Flow fault latched' : (live.spa_active ? 'Spa boost active' : 'Waiting for schedule or demand'))).slice(0, 96);
  const warns = [];
  if (!mapped('filter_pump')) warns.push('No filter pump');
  if (!mapped('temp_water')) warns.push('No water temp sensor');
  if (mapped('solar_pump') && !mapped('temp_collector')) warns.push('Solar pump without collector temp');
  if (mapped('heat_source_2') && !mapped('heat_source_1')) warns.push('Source 2 without source 1');
  if ((mapped('solar_pump') || mapped('heat_source_1') || mapped('heat_source_2')) && !mapped('flow_switch')) warns.push('No flow switch');
  if ((mapped('ph_minus_pump') || mapped('ph_plus_pump')) && !mapped('ph_sensor')) warns.push('Dosing without pH sensor');
  if (mapped('cl_pump') && !mapped('orp_sensor')) warns.push('Cl pump without ORP sensor');
  const pills = [
    renderBadge(status, status === 'FAULT' ? '#ff6b6b' : (status === 'BACKWASH' ? '#f59e0b' : (status === 'SPA' ? '#a855f7' : (status === 'ANTI_FREEZE' ? '#06b6d4' : '#22d97a'))), status === 'FAULT' ? 'rgba(255,107,107,.35)' : (status === 'BACKWASH' ? 'rgba(245,158,11,.35)' : (status === 'SPA' ? 'rgba(168,85,247,.3)' : (status === 'ANTI_FREEZE' ? 'rgba(6,182,212,.3)' : 'rgba(34,217,122,.35)')))),
    renderBadge('WATER ' + tempWater, '#06b6d4', 'rgba(6,182,212,.28)'),
    renderBadge('TARGET ' + target, 'var(--text)', 'var(--line)'),
    renderBadge('FILT ' + hours + ' / ' + hoursTarget, 'var(--text)', 'var(--line)'),
    live.filter_pump_on ? renderBadge('FILTER ON', '#22d97a', 'rgba(34,217,122,.28)') : '',
    live.solar_active ? renderBadge('SOLAR', '#f59e0b', 'rgba(245,158,11,.35)') : '',
    live.heat_source_1_on ? renderBadge((live.source_1_type || 'SRC1').toUpperCase() + ' ON', '#ff9a3a', 'rgba(255,154,58,.28)') : '',
    live.heat_source_2_on ? renderBadge((live.source_2_type || 'SRC2').toUpperCase() + ' ON', '#ff9a3a', 'rgba(255,154,58,.28)') : '',
    live.spa_active ? renderBadge('SPA', '#a855f7', 'rgba(168,85,247,.3)') : '',
    live.backwash_running ? renderBadge('BACKWASH', '#f59e0b', 'rgba(245,158,11,.35)') : '',
    live.backwash_needed ? renderBadge('BACKWASH NEEDS OK', '#f59e0b', 'rgba(245,158,11,.35)') : '',
    live.anti_freeze_active ? renderBadge('ANTI-FREEZE', '#06b6d4', 'rgba(6,182,212,.3)') : '',
    live.flow_fault ? renderBadge('FLOW FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : '',
    live.hp1_fault ? renderBadge('HP1 FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : '',
    live.hp2_fault ? renderBadge('HP2 FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(reason, 'var(--muted)', 'var(--line)')}</div>`;
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge('PRESS ' + pressure, 'var(--muted)', 'var(--line)')}${renderBadge('pH ' + ph, 'var(--muted)', 'var(--line)')}${renderBadge('ORP ' + orp, 'var(--muted)', 'var(--line)')}${live.lights_on ? renderBadge('LIGHTS', '#1d8cff', 'rgba(29,140,255,.28)') : ''}${live.spa_jets_on ? renderBadge('JETS', '#a855f7', 'rgba(168,85,247,.3)') : ''}${live.dose_ph_minus_active ? renderBadge('pH-', '#f59e0b', 'rgba(245,158,11,.35)') : ''}${live.dose_ph_plus_active ? renderBadge('pH+', '#22d97a', 'rgba(34,217,122,.28)') : ''}${live.dose_cl_active ? renderBadge('CL', '#06b6d4', 'rgba(6,182,212,.28)') : ''}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ ' + w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('pool_spa', {
  hasAuto: false,
  summaryBoxId: 'poolSpaCommissioningSummary',
  updateCommissioningSummary(m) { updatePoolSpaCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderPoolSpaSummary(inst, s, live); },
});
