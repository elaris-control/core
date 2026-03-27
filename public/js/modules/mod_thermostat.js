// public/js/modules/mod_thermostat.js

function thermostatZoneKeys(zoneNo) {
  return [`zone_${zoneNo}_temp`,`zone_${zoneNo}_call`,`zone_${zoneNo}_output`,`zone_${zoneNo}_pump`];
}

function thermostatZoneDefs(zoneNo) {
  const keys = thermostatZoneKeys(zoneNo);
  return keys.map(key => (selectedDef?.inputs||[]).find(inp => inp.key === key)).filter(Boolean);
}

function thermostatZoneState(zoneNo, currentMappings={}) {
  const defs = thermostatZoneDefs(zoneNo);
  const mapped = defs.filter(inp => !!(currentMappings[inp.key] || (!editingId && suggestions[inp.key])));
  const active = zoneNo === 1 || mapped.length > 0;
  return { defs, active, mappedCount: mapped.length };
}

function thermostatSuggestedVisibleZones(currentMappings={}) {
  let highest = 1;
  for (let i = 1; i <= 6; i++) {
    const defs = thermostatZoneDefs(i);
    if (defs.some(inp => !!currentMappings[inp.key])) highest = i;
  }
  return Math.max(1, Math.min(6, highest));
}

function setThermostatVisibleZones(nextCount) {
  thermostatVisibleZones = Math.max(1, Math.min(6, Number(nextCount) || 1));
  const wizard = document.getElementById("wizard");
  if (wizard && wizard.classList.contains("show") && selectedDef?.id === 'thermostat') {
    const currentMappings = {};
    (selectedDef?.inputs || []).forEach((input) => {
      const sel = document.getElementById("map_" + input.key);
      if (sel?.value) currentMappings[input.key] = Number(sel.value);
    });
    renderWizardInputs(currentMappings);
  }
}

function renderThermostatWizardIntoDom(currentMappings={}, rowRenderer) {
  document.getElementById("wizardInputs").innerHTML = renderThermostatWizard(currentMappings, rowRenderer);
  updateThermostatCommissioningSummary(currentMappings);
}

function analyzeThermostatMappings(currentMappings={}) {
  const centralPump = Number(currentMappings.central_pump || 0) || null;
  const legacy = {
    temp_room: Number(currentMappings.temp_room || 0) || null,
    ac_relay: Number(currentMappings.ac_relay || 0) || null,
    temp_outdoor: Number(currentMappings.temp_outdoor || 0) || null,
  };
  const zones = [];
  const issues = [];
  const actuatorUsage = new Map();

  const noteActuator = (ioId, label) => {
    if (!ioId) return;
    if (!actuatorUsage.has(ioId)) actuatorUsage.set(ioId, []);
    actuatorUsage.get(ioId).push(label);
  };

  noteActuator(centralPump, 'Central pump');
  noteActuator(legacy.ac_relay, 'Legacy output');

  for (let i = 1; i <= 6; i++) {
    const zone = {
      n: i,
      temp: Number(currentMappings[`zone_${i}_temp`] || 0) || null,
      call: Number(currentMappings[`zone_${i}_call`] || 0) || null,
      output: Number(currentMappings[`zone_${i}_output`] || 0) || null,
      pump: Number(currentMappings[`zone_${i}_pump`] || 0) || null,
    };
    zone.configured = !!(zone.temp || zone.call || zone.output || zone.pump);
    zone.hasDemandSource = !!(zone.temp || zone.call);
    zone.hasActuator = !!(zone.output || zone.pump || centralPump);
    if (zone.configured) zones.push(zone);
    noteActuator(zone.output, `Zone ${i} output`);
    noteActuator(zone.pump, `Zone ${i} pump`);

    if (!zone.configured) continue;
    if (zone.call && zone.temp) {
      issues.push({ severity:'info', message:`Zone ${i} has both thermostat call and temperature. <strong>Thermostat call wins</strong>; the temperature stays as fallback/display.` });
    }
    if (zone.hasDemandSource && !zone.hasActuator) {
      issues.push({ severity:'bad', message:`Zone ${i} has a demand source but no output/pump and no central pump mapped.` });
    }
    if (!zone.hasDemandSource && (zone.output || zone.pump)) {
      issues.push({ severity:'warn', message:`Zone ${i} has actuator mappings but no temperature or thermostat call input.` });
    }
    if (!zone.output && !zone.pump && centralPump && zone.hasDemandSource) {
      issues.push({ severity:'info', message:`Zone ${i} relies only on the central pump. That is fine if actuation happens elsewhere.` });
    }
  }

  for (const [ioId, labels] of actuatorUsage.entries()) {
    if (labels.length > 1) {
      issues.push({ severity:'bad', message:`Same actuator mapped more than once: <strong>${ioFriendlyLabel(ioId)}</strong> used by ${labels.join(', ')}.` });
    }
  }

  if (!zones.length && !(legacy.temp_room || legacy.ac_relay)) {
    issues.push({ severity:'bad', message:'No thermostat zones configured yet. Map at least one zone input and one actuator.' });
  }

  if ((legacy.temp_room || legacy.ac_relay || legacy.temp_outdoor) && zones.length) {
    issues.push({ severity:'warn', message:'Legacy single-zone mappings are present together with zoned mappings. Keep Legacy only for older one-zone compatibility.' });
  }

  if ((legacy.temp_room || legacy.ac_relay) && !(legacy.temp_room && (legacy.ac_relay || centralPump))) {
    issues.push({ severity:'warn', message:'Legacy mapping is incomplete. A classic single-zone setup normally needs a room temperature and an output (or central pump).' });
  }

  const configuredZones = zones.length;
  const zonesWithCall = zones.filter(z => z.call).length;
  const zonesWithTemp = zones.filter(z => z.temp).length;
  const zonesWithOutput = zones.filter(z => z.output).length;
  const zonesWithPump = zones.filter(z => z.pump).length;
  const readiness = issues.some(i => i.severity === 'bad') ? 'Needs fixes' : (issues.some(i => i.severity === 'warn') ? 'Check warnings' : 'Ready to save');

  return { centralPump, legacy, zones, issues, configuredZones, zonesWithCall, zonesWithTemp, zonesWithOutput, zonesWithPump, readiness };
}

function renderThermostatCommissioningSummary(currentMappings={}) {
  const a = analyzeThermostatMappings(currentMappings);
  const zonePills = a.zones.map(z => {
    const parts = [];
    if (z.call) parts.push('CALL');
    if (z.temp) parts.push('TEMP');
    if (z.output) parts.push('OUT');
    if (z.pump) parts.push('PUMP');
    return `<span class="thermo-zone-pill"><strong>Z${z.n}</strong><span class="mini">${parts.join(' • ') || 'EMPTY'}</span></span>`;
  }).join('') || `<span class="thermo-zone-pill"><strong>No zones yet</strong><span class="mini">Map Zone 1 to start</span></span>`;
  const issues = a.issues.length
    ? `<div class="thermo-issues">${a.issues.map(i => { const sev = ['bad','warn','info'].includes(i.severity) ? i.severity : 'info'; return `<div class="thermo-issue sev-${sev}"><strong>${sev === 'bad' ? 'Fix' : sev === 'warn' ? 'Check' : 'Info'}:</strong> ${i.message}</div>`; }).join('')}</div>`
    : `<div class="thermo-issues"><div class="thermo-issue sev-info"><strong>Ready:</strong> This thermostat setup looks clean so far.</div></div>`;
  const legacyMode = (a.legacy.temp_room || a.legacy.ac_relay || a.legacy.temp_outdoor) ? 'Legacy mapped' : 'Unused';
  return `
    <div class="thermo-summary">
      <div class="thermo-summary-head">
        <div>
          <div class="thermo-summary-title">Commissioning summary</div>
          <div class="thermo-summary-sub">Quick check before you save this thermostat mapping.</div>
        </div>
        <div class="compact-badge ${a.issues.some(i => i.severity === 'bad') ? 'live-off' : 'live-on'}"><span class="k">Status</span><span class="v">${a.readiness}</span></div>
      </div>
      <div class="thermo-sum-grid">
        <div class="thermo-stat"><div class="thermo-stat-k">Configured zones</div><div class="thermo-stat-v">${a.configuredZones}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Zones with call</div><div class="thermo-stat-v">${a.zonesWithCall}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Zones with temp</div><div class="thermo-stat-v">${a.zonesWithTemp}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Zone outputs</div><div class="thermo-stat-v">${a.zonesWithOutput}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Zone pumps</div><div class="thermo-stat-v">${a.zonesWithPump}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Central pump</div><div class="thermo-stat-v">${a.centralPump ? ioFriendlyLabel(a.centralPump) : 'Not mapped'}</div></div>
        <div class="thermo-stat"><div class="thermo-stat-k">Legacy</div><div class="thermo-stat-v">${legacyMode}</div></div>
      </div>
      <div class="thermo-zone-sum">${zonePills}</div>
      ${issues}
    </div>`;
}

function updateThermostatCommissioningSummary(currentMappings=null) {
  const box = document.getElementById('thermoCommissioningSummary');
  if (!box) return;
  const mappings = currentMappings || collectCurrentWizardMappings();
  box.innerHTML = renderThermostatCommissioningSummary(mappings);
}

registerModule('thermostat', {
  hasAuto: true,
  updateCommissioningSummary(m) { updateThermostatCommissioningSummary(m); },
  renderSummary(inst, settings, live) { return ''; },
  renderWizardInputs(currentMappings, makeRow) {
    window.thermostatVisibleZones = thermostatSuggestedVisibleZones(currentMappings);
    renderThermostatWizardIntoDom(currentMappings, makeRow);
  },
});
