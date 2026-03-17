// public/js/modules/mod_hydronic.js

function analyzeHydronicMappings(currentMappings={}) {
  const map = key => Number(currentMappings[key] || 0) || null;
  const issues = [];
  const ioUse = new Map();
  const note = (id, label) => {
    if (!id) return;
    if (!ioUse.has(id)) ioUse.set(id, []);
    ioUse.get(id).push(label);
  };

  const topology = map('mixing_valve') ? 'mixing' : 'direct';
  const source1 = map('heat_source_1');
  const source2 = map('heat_source_2');
  const valve = map('mixing_valve');
  const supply = map('temp_supply');
  const buffer = map('temp_buffer');
  const mainPump = map('main_pump');
  const flow = map('flow_switch');
  const outdoor = map('temp_outdoor');
  const collector = map('temp_collector');
  const solarPump = map('solar_pump');
  const roomRh = map('humidity_room');
  const supplyRh = map('humidity_supply');
  const resistance = map('resistance');

  const zones = [];
  for (let i = 1; i <= 6; i++) {
    const thermostat = map(`zone_${i}_thermostat`);
    const pump = map(`zone_${i}_pump`);
    const configured = !!(thermostat || pump);
    if (!configured) continue;
    zones.push({ idx:i, thermostat, pump, complete: !!(thermostat && pump) });
    note(thermostat, `Zone ${i} thermostat`);
    note(pump, `Zone ${i} pump`);
  }

  [[source1,'Heat Source 1'],[source2,'Heat Source 2'],[valve,'Mixing valve'],[supply,'Supply temp'],[buffer,'Buffer temp'],[mainPump,'Main pump'],[flow,'Flow switch'],[outdoor,'Outdoor temp'],[collector,'Collector temp'],[solarPump,'Solar pump'],[roomRh,'Room RH'],[supplyRh,'Supply RH'],[resistance,'Resistance']].forEach(([id,label])=>note(id,label));

  if (!source1) issues.push({severity:'bad', message:'Map Heat Source 1 output.'});
  if (!map('zone_1_thermostat')) issues.push({severity:'bad', message:'Map Zone 1 thermostat input.'});
  if (!map('zone_1_pump')) issues.push({severity:'bad', message:'Map Zone 1 pump output.'});
  if (!zones.length) issues.push({severity:'bad', message:'Map at least one thermostat + pump zone pair.'});
  zones.filter(z => !z.complete).forEach(z => issues.push({severity:'warn', message:`Zone ${z.idx} is incomplete. Map both thermostat and pump.`}));
  if (topology === 'mixing' && !valve) issues.push({severity:'bad', message:'Mixing topology needs an analog mixing valve output.'});
  if (topology === 'mixing' && !supply) issues.push({severity:'bad', message:'Mixing topology needs a supply temperature sensor.'});
  if (topology === 'direct' && !buffer) issues.push({severity:'info', message:'Direct topology can work without buffer sensor; source will follow zone demand directly.'});
  if (!buffer) issues.push({severity:'info', message:'Buffer temperature is optional but recommended for source staging.'});
  if (source2 && !map('heat_source_2')) issues.push({severity:'warn', message:'Fallback source 2 is selected but not mapped.'});
  if (collector && !solarPump) issues.push({severity:'info', message:'Solar collector sensor is mapped without a solar pump output.'});
  if (solarPump && !collector) issues.push({severity:'info', message:'Solar pump is mapped without collector temperature.'});
  if (roomRh && !supply) issues.push({severity:'info', message:'Room humidity is mapped, but supply temperature is missing for dew-point protection.'});
  if (supplyRh && !roomRh) issues.push({severity:'info', message:'Supply humidity is mapped without room humidity.'});
  if (!outdoor) issues.push({severity:'info', message:'Outdoor temperature is optional but recommended for weather compensation.'});
  [...ioUse.entries()].forEach(([ioId, labels]) => {
    if (labels.length > 1) issues.push({severity:'warn', message:`The same IO is reused for ${labels.join(', ')}.`});
  });

  const readiness = issues.some(i=>i.severity==='bad') ? 'Needs fixes' : (issues.some(i=>i.severity==='warn') ? 'Check mappings' : 'Ready');
  return { topology, source1, source2, valve, supply, buffer, mainPump, flow, outdoor, collector, solarPump, roomRh, supplyRh, resistance, zones, issues, readiness };
}

function renderHydronicCommissioningSummary(currentMappings={}) {
  const a = analyzeHydronicMappings(currentMappings);
  const zonePills = a.zones.length
    ? a.zones.map(z => `<span class="thermo-zone-pill"><strong>Z${z.idx}</strong><span class="mini">${z.thermostat ? ioLabelById(z.thermostat) : 'No thermostat'} · ${z.pump ? ioLabelById(z.pump) : 'No pump'}</span></span>`).join('')
    : `<span class="thermo-zone-pill"><strong>No zones</strong><span class="mini">Map one or more thermostat + pump pairs.</span></span>`;
  const helperPills = [
    a.source1 ? `<span class="thermo-zone-pill"><strong>Source 1</strong><span class="mini">${ioLabelById(a.source1)}</span></span>` : '',
    a.source2 ? `<span class="thermo-zone-pill"><strong>Source 2</strong><span class="mini">${ioLabelById(a.source2)}</span></span>` : '',
    a.valve ? `<span class="thermo-zone-pill"><strong>Valve</strong><span class="mini">${ioLabelById(a.valve)}</span></span>` : '',
    a.supply ? `<span class="thermo-zone-pill"><strong>Supply</strong><span class="mini">${ioLabelById(a.supply)}</span></span>` : '',
    a.buffer ? `<span class="thermo-zone-pill"><strong>Buffer</strong><span class="mini">${ioLabelById(a.buffer)}</span></span>` : '',
    a.outdoor ? `<span class="thermo-zone-pill"><strong>Outdoor</strong><span class="mini">${ioLabelById(a.outdoor)}</span></span>` : '',
    a.roomRh ? `<span class="thermo-zone-pill"><strong>Room RH</strong><span class="mini">${ioLabelById(a.roomRh)}</span></span>` : '',
    a.flow ? `<span class="thermo-zone-pill"><strong>Flow</strong><span class="mini">${ioLabelById(a.flow)}</span></span>` : ''
  ].filter(Boolean).join('') || `<span class="thermo-zone-pill"><strong>Helpers</strong><span class="mini">Outdoor / RH / flow / buffer are optional.</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => `<div class="thermo-issue sev-${i.severity === 'bad' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}"><strong>${i.severity === 'bad' ? 'Fix' : i.severity === 'warn' ? 'Check' : 'Info'}:</strong> ${escapeHTML(i.message)}</div>`).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> Hydronic mapping looks clean so far.</div></div>`;
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this hydronic setup.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Topology</div><div class="thermo-stat-v">${a.topology === 'mixing' ? 'Mixing valve' : 'Direct'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Zones</div><div class="thermo-stat-v">${a.zones.length}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Valve</div><div class="thermo-stat-v">${a.topology === 'mixing' ? (a.valve ? 'Mapped' : 'Required') : 'Not needed'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Supply</div><div class="thermo-stat-v">${a.topology === 'mixing' ? (a.supply ? 'Mapped' : 'Required') : (a.supply ? 'Mapped' : 'Optional')}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Buffer</div><div class="thermo-stat-v">${a.buffer ? 'Mapped' : 'Optional'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Cooling RH</div><div class="thermo-stat-v">${a.roomRh ? 'Ready' : 'Optional'}</div></div>
      </div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Zone thermostat + pump pairs</div>
      <div class="thermo-zone-sum">${zonePills}</div>
      <div class="thermo-summary-sub" style="margin:6px 0 4px">Sources / helpers</div>
      <div class="thermo-zone-sum">${helperPills}</div>
      ${issues}
    </div>`;
}

function updateHydronicCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('hydronicCommissioningSummary');
  if (!box) return;
  box.innerHTML = renderHydronicCommissioningSummary(currentMappings || collectCurrentWizardMappings());
}

function renderHydronicSummary(inst, settings, liveWrap) {
  const live = liveWrap?.state || liveWrap || {};
  const maps = inst.mappings || [];
  const mapped = key => maps.some(m => m.input_key === key && m.io_id);
  const topology = String(settings?.topology || live.topology || (mapped('mixing_valve') ? 'mixing' : 'direct')).toUpperCase();
  const status = String(live.status || 'idle').toUpperCase();
  const mode = String(live.mode || settings?.mode || 'heating').toUpperCase();
  const valve = live.valve_pct != null ? `${Math.round(Number(live.valve_pct))}%` : '—';
  const calling = Number(live.calling_zones || 0);
  const zones = Number(live.configured_zones || maps.filter(m => /^zone_\d+_pump$/.test(String(m.input_key||'')) && m.io_id).length || 0);
  const tempSupply = live.temp_supply != null ? Number(live.temp_supply).toFixed(1) + '°C' : '—';
  const tempBuffer = live.temp_buffer != null ? Number(live.temp_buffer).toFixed(1) + '°C' : '—';
  const sp = live.computed_supply_sp != null ? Number(live.computed_supply_sp).toFixed(1) + '°C' : '—';
  const outdoor = live.temp_outdoor != null ? Number(live.temp_outdoor).toFixed(1) + '°C' : '—';
  const rh = live.humidity_room != null ? Math.round(Number(live.humidity_room)) + '%' : '—';
  const warns = [];
  if (!mapped('heat_source_1')) warns.push('No source 1');
  if (!mapped('zone_1_thermostat')) warns.push('No zone 1 thermostat');
  if (!mapped('zone_1_pump')) warns.push('No zone 1 pump');
  if (topology === 'MIXING' && !mapped('mixing_valve')) warns.push('Mixing valve not mapped');
  if (topology === 'MIXING' && !mapped('temp_supply')) warns.push('Supply sensor missing');
  const pills = [
    renderBadge(status, status === 'RUNNING' ? '#22d97a' : (status === 'BLOCKED' ? '#f59e0b' : 'var(--muted2)'), status === 'RUNNING' ? 'rgba(34,217,122,.35)' : (status === 'BLOCKED' ? 'rgba(245,158,11,.35)' : 'var(--line)')),
    renderBadge(topology, '#ff9a3a', 'rgba(255,154,58,.28)'),
    renderBadge(mode, '#1d8cff', 'rgba(29,140,255,.28)'),
    renderBadge(`ZONES ${zones}`, 'var(--text)', 'var(--line)'),
    renderBadge(`CALL ${calling}`, '#22d97a', 'rgba(34,217,122,.28)'),
    topology === 'MIXING' ? renderBadge(`VALVE ${valve}`, 'var(--text)', 'var(--line)') : '',
    live.src1_fault ? renderBadge('HP1 FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : '',
    live.src2_fault ? renderBadge('HP2 FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : '',
    live.flow_fault ? renderBadge('FLOW FAULT', '#ff6b6b', 'rgba(255,107,107,.35)') : '',
    live.condensation_lock ? renderBadge('COND LOCK', '#f59e0b', 'rgba(245,158,11,.35)') : ''
  ].filter(Boolean);
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${pills.join('')}</div>`;
  if (live.last_reason) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge(String(live.last_reason).slice(0,90), 'var(--muted)', 'var(--line)')}</div>`;
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${renderBadge('SUP ' + tempSupply, 'var(--text)', 'var(--line)')}${renderBadge('BUF ' + tempBuffer, 'var(--text)', 'var(--line)')}${renderBadge('SP ' + sp, 'var(--text)', 'var(--line)')}${renderBadge('OUT ' + outdoor, 'var(--muted)', 'var(--line)')}${renderBadge('RH ' + rh, 'var(--muted)', 'var(--line)')}</div>`;
  if (warns.length) html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px">${warns.map(w => renderBadge('⚠ ' + w, '#f59e0b', 'rgba(245,158,11,.35)')).join('')}</div>`;
  return html;
}

registerModule('hydronic_manager', {
  hasAuto: false,
  summaryBoxId: 'hydronicCommissioningSummary',
  updateCommissioningSummary(m) { updateHydronicCommissioningSummary(m); },
  renderSummary(inst, s, live) { return renderHydronicSummary(inst, s, live); },
});
