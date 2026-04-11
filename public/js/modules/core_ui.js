// public/js/modules/core_ui.js
// Extracted core UI/rendering helpers for Modules page.

function moduleSettingsEndpoint(instOrId) {
  const id = typeof instOrId === "object" ? instOrId?.id : instOrId;
  return `/automation/settings/${id}`;
}

function moduleLogEndpoint(instOrId) {
  const id = typeof instOrId === "object" ? instOrId?.id : instOrId;
  return `/api/automation/log/${id}`;
}

function getMapDisplayValue(map) {
  return map?.io_name || (map?.io_key ? `${map.group_name}.${map.io_key}` : null);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function makeSafeClassToken(value, fallback = 'generic') {
  const token = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
}

function renderMapItem(label, value, key, opts={}) {
  const rich = !!opts.rich;
  const cls = `map-val ${value ? "" : "unmapped"}${rich ? " rich" : ""}`;
  return `<div class="map-item">
    <span class="map-key">${escapeHTML(label || key || '')}</span>
    <span class="${cls}">${value || "— not set —"}</span>
  </div>`;
}

function renderCompactBadge(label, value, extraClass = "") {
  return `<span class="compact-badge ${escapeHTML(extraClass)}"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></span>`;
}

function stateOn(v) {
  return v === true || v === 1 || v === "1" || String(v || "").toUpperCase() === "ON" || String(v || "").toUpperCase() === "TRUE";
}

function renderInstanceMapRows(inst, def, maps) {
  if (inst?.module_id === 'thermostat' && def) {
    const byKey = (key) => maps.find(x => x.input_key === key);
    const compactValue = (key) => getMapDisplayValue(byKey(key));
    const compactParts = [];
    const zoneSummaries = [];
    const liveValues = inst?._liveStatus?.values || {};

    const centralVal = compactValue('central_pump');
    if (centralVal) {
      const centralLive = stateOn(liveValues.central_pump);
      const centralDisplay = renderCompactBadge('map', centralVal) + renderCompactBadge('live', centralLive ? 'ON' : 'OFF', centralLive ? 'live-on' : 'live-off');
      compactParts.push(renderMapItem('Central Pump', centralDisplay, 'central_pump', { rich:true }));
    }

    const legacyKeys = ['temp_room','ac_relay','temp_outdoor'];
    const legacyPairs = legacyKeys.map(key => {
      const input = (def.inputs||[]).find(i => i.key === key);
      const val = compactValue(key);
      return val ? `${input?.short_label || input?.label || key}: ${val}` : null;
    }).filter(Boolean);

    let activeZoneCount = 0;
    for (let i = 1; i <= 6; i++) {
      const tempVal = compactValue(`zone_${i}_temp`);
      const callVal = compactValue(`zone_${i}_call`);
      const outVal  = compactValue(`zone_${i}_output`);
      const pumpVal = compactValue(`zone_${i}_pump`);
      const pieces = [];
      if (tempVal) pieces.push(renderCompactBadge('temp', tempVal));
      if (callVal) pieces.push(renderCompactBadge('call', callVal));
      if (outVal) pieces.push(renderCompactBadge('out', outVal));
      if (pumpVal) pieces.push(renderCompactBadge('pump', pumpVal));
      if (pieces.length) {
        activeZoneCount += 1;
        zoneSummaries.push(renderMapItem(`Zone ${i}`, pieces.join(''), `zone_${i}`, { rich:true }));
      }
    }

    if (activeZoneCount) {
      compactParts.unshift(renderMapItem('Configured Zones', String(activeZoneCount), 'zones_count'));
    }

    const fullSections = [];
    if (centralVal) {
      const centralLive = stateOn(liveValues.central_pump);
      const centralFull = renderCompactBadge('map', centralVal) + renderCompactBadge('live', centralLive ? 'ON' : 'OFF', centralLive ? 'live-on' : 'live-off');
      fullSections.push(`<div class="sp-title" style="margin-bottom:6px">Shared</div>${renderMapItem('Central Pump', centralFull, 'central_pump', { rich:true })}`);
    }
    if (legacyPairs.length) {
      const legacyRows = legacyKeys.map(key => {
        const input = (def.inputs||[]).find(i => i.key === key);
        const val = compactValue(key);
        if (!val) return '';
        return renderMapItem(input?.label || key, val, key);
      }).filter(Boolean).join('');
      fullSections.push(`<div class="sp-title" style="margin:10px 0 6px">Legacy / Single Zone</div>${legacyRows}`);
    }
    if (zoneSummaries.length) {
      const zoneGroups = [];
      for (let i = 1; i <= 6; i++) {
        const zoneKeys = [`zone_${i}_temp`,`zone_${i}_call`,`zone_${i}_output`,`zone_${i}_pump`];
        const rows = zoneKeys.map(key => {
          const input = (def.inputs||[]).find(inp => inp.key === key);
          const val = compactValue(key);
          if (!val) return '';
          return renderMapItem(input?.label || key, val, key);
        }).filter(Boolean).join('');
        if (rows) zoneGroups.push(`<div class="sp-title" style="margin:10px 0 6px">Zone ${i}</div>${rows}`);
      }
      fullSections.push(zoneGroups.join(''));
    }

    const summaryHtml = [
      ...compactParts,
      ...zoneSummaries,
      ...(legacyPairs.length && !activeZoneCount ? [renderMapItem('Legacy', legacyPairs.join(' • '), 'legacy')] : [])
    ].join('');

    if (summaryHtml) {
      const detailsHtml = fullSections.length ? `
        <details class="thermo-compact-details" style="margin-top:8px">
          <summary style="cursor:pointer;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase">Show full mappings</summary>
          <div style="margin-top:8px">${fullSections.join('')}</div>
        </details>` : '';
      return `${summaryHtml}${detailsHtml}`;
    }
  }

  const mapInputs = (def?.dynamic && maps.length)
    ? maps.map(m => ({ key: m.input_key }))
    : (def?.inputs||[]);
  return mapInputs.map(input => {
    const m   = maps.find(x => x.input_key===input.key);
    const val = getMapDisplayValue(m);
    return renderMapItem(input.label || input.key, val, input.key);
  }).join("");
}

function ioLabelById(ioId) {
  const io = siteIO.find(x => Number(x.id) === Number(ioId));
  if (!io) return `IO ${Number(ioId)}`;
  return escapeHTML(`${io.device_id}·${io.group_name}.${io.key}`) + (io.name && io.name !== io.key ? ` (${escapeHTML(io.name)})` : '');
}

function ioFriendlyLabel(ioId) {
  const io = siteIO.find(x => Number(x.id) === Number(ioId));
  if (!io) return `IO ${Number(ioId)}`;
  return escapeHTML(io.name && io.name !== io.key ? io.name : io.key);
}

function renderInstances() {
  const q = (document.getElementById("search")?.value||"").toLowerCase().trim();
  const list = !q ? instances : instances.filter(i =>
    (i.name||"").toLowerCase().includes(q) ||
    (i.module_id||"").toLowerCase().includes(q)
  );
  const box = document.getElementById("instGrid");
  if (!list.length) {
    box.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:14px">No modules found.</div>`;
    return;
  }

  box.innerHTML = list.map(inst => {
    const def  = inst.definition || {};
    const testMode = String(inst.settings?.test_mode ?? inst.setpoints?.test_mode ?? '0') === '1';
    const mapRows  = renderInstanceMapRows(inst, def, inst.mappings || []);
    const color = def?.color || "var(--blue)";
    return `
    <div class="inst-card" style="border-color:${color}">
      <div class="inst-top">
        <div class="inst-head">
          <div class="inst-icon" style="background:${color}22;border-color:${color}44;color:${color}">
            ${def?.icon||"📦"}
          </div>
          <div style="min-width:0">
            <div class="inst-title-row">
              <div class="inst-name">${escapeHTML(inst.name||"Unnamed module")}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${inst.site_name ? `<span class="site-badge">📍 ${escapeHTML(inst.site_name)}</span>` : ""}
                ${testMode ? `<span class="site-badge" style="border-color:rgba(255,201,71,.35);color:#ffd978;background:rgba(255,201,71,.08)">🧪 test mode</span>` : ""}
                ${inst.module_id === 'custom' ? `<span class="site-badge" style="border-color:rgba(90,170,255,.35);color:#9dd1ff;background:rgba(90,170,255,.08)">auto</span>` : ""}
              </div>
              <div class="inst-module-label">${escapeHTML(def?.name||inst.module_id||'')}</div>
            </div>
          </div>
        </div>
        <div class="inst-actions">
          <button class="btn btn-sm" onclick="editInstance(${inst.id})">✎</button>
          <button class="btn btn-sm btn-danger" onclick="deleteInstance(${Number(inst.id)},${escapeHTML(JSON.stringify(String(inst.name||'')))})">✕</button>
        </div>
      </div>
      <div class="map-list" id="maps_${inst.id}">${mapRows}</div>
      <div id="sp_${inst.id}"><div style="color:var(--muted);font-size:11px;padding:6px 0">Loading…</div></div>
      <div id="log_${inst.id}"></div>
    </div>`;
  }).join("");

  instances.forEach(inst => enrichCard(inst));
}

async function enrichCard(inst) {
  const def = inst.definition;
  if (!def?.setpoints?.length && !ModuleRegistry[inst.module_id]?.enrichCard) {
    document.getElementById(`sp_${inst.id}`).innerHTML = "";
    return;
  }

  let settings = {};
  try {
    const d = await api(moduleSettingsEndpoint(inst));
    settings = d.settings || d.setpoints || {};
  } catch {}

  const spEl = document.getElementById(`sp_${inst.id}`);
  if (!spEl) return;

  try {
    inst._liveStatus = await api(`/api/automation/status/${inst.id}`);
  } catch {}
  if (inst.module_id === 'solar') {
    try { inst._liveStatus = await api(`/api/automation/solar/${inst.id}/status`); } catch {}
  }
  try {
    const mapsEl = document.getElementById(`maps_${inst.id}`);
    if (mapsEl) mapsEl.innerHTML = renderInstanceMapRows(inst, def, inst.mappings || []);
  } catch {}

  if (ModuleRegistry[inst.module_id]?.enrichCard) {
    await ModuleRegistry[inst.module_id].enrichCard(inst, settings, spEl);
  } else if (def?.setpoints?.length) {
    const mappedKeys = new Set(
      (inst.mappings || []).filter(m => m.io_id).map(m => m.input_key)
    );

    const groups = def.groups;
    let innerHTML = "";

      if (groups?.length) {
        innerHTML = groups.map(grp => {
          if (grp.requires && !mappedKeys.has(grp.requires)) return "";
          if (Array.isArray(grp.requiresAny) && grp.requiresAny.length && !grp.requiresAny.some(k => mappedKeys.has(k))) return "";
          if (grp.requires_absent && mappedKeys.has(grp.requires_absent)) return "";

          const sps = def.setpoints.filter(sp => (sp.group || "basic") === grp.id);
        if (!sps.length) return "";

        const rows = sps.map(sp => renderSetpointRow(inst.id, sp, settings)).join("");
        return `
          <details class="sp-group" ${grp.open ? "open" : ""}>
            <summary>${escapeHTML(grp.label || grp.id || 'Group')}</summary>
            ${rows}
          </details>`;
      }).join("");
    } else {
      innerHTML = def.setpoints.map(sp => renderSetpointRow(inst.id, sp, settings)).join("");
    }

    const summaryHtml = ModuleRegistry[inst.module_id]?.renderSummary?.(inst, settings, inst._liveStatus) || '';
    spEl.innerHTML = `
      <div class="sp-panel">
        <div class="sp-title">⚙️ Setpoints</div>
        ${summaryHtml}
        ${innerHTML}
      </div>`;
  } else {
    spEl.innerHTML = "";
  }

  try {
    const d = await api(moduleLogEndpoint(inst));
    const log = (d.log||[]).slice(0,4);
    const logEl = document.getElementById(`log_${inst.id}`);
    if (logEl && log.length) {
      logEl.innerHTML = `<div class="sp-panel" style="margin-top:8px">
        <details class="sp-log">
          <summary><span>📋 Recent Events</span><span class="sp-log-count">${log.length}</span></summary>
          <div class="sp-log-body">
        ${log.map(l => {
          const actionText = String(l.action || '');
          const actionClass = makeSafeClassToken(actionText, 'generic');
          const actionLabel = typeof formatActionLabel === 'function' ? formatActionLabel(actionText) : actionText;
          const reasonLabel = typeof formatReasonLabel === 'function' ? formatReasonLabel(l.reason) : String(l.reason || '');
          return `<div class="log-row">
            <span class="log-ts">${new Date(l.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
            <div class="log-main">
              <span class="log-action action-${actionClass}" title="${escapeHtml(actionText)}">${escapeHtml(actionLabel)}</span>
              <span class="log-reason" title="${escapeHtml(String(l.reason || ''))}">${escapeHtml(reasonLabel)}</span>
            </div>
          </div>`;
        }).join("")}
          </div>
        </details>
      </div>`;
    }
  } catch {}
}

function renderBadge(text, color, border) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.04);border:1px solid ${border||'var(--line)'};border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700;color:${color||'var(--text)'}">${escapeHTML(String(text ?? ''))}</span>`;
}

function renderSetpointRow(instId, sp, settings) {
  const val = settings[sp.key] ?? sp.default ?? "";
  const help = sp.help ? `<div class="sp-help" style="font-size:11px;color:var(--muted);margin-top:4px">${escapeHTML(sp.help)}</div>` : "";
  const label = escapeHTML(sp.label || sp.key || 'Setpoint');
  const inputId = `sp_${instId}_${sp.key}`;
  if (sp.type === "select") {
    const options = (sp.options || []).map(o => typeof o === 'object' ? o : { value: o, label: o });
    return `<div class="sp-row">
      <span class="sp-label">${label}</span>
      <div class="sp-ctrl">
        <select class="sp-select" id="${inputId}" onchange="saveSP(${instId},'${sp.key}',this.value)">
          ${options.map(o=>`<option value="${escapeHTML(String(o.value))}" ${String(val)===String(o.value)?"selected":""}>${escapeHTML(o.label)}</option>`).join("")}
        </select>
      </div>
      ${help}
    </div>`;
  }
  if (sp.type === "time") {
    return `<div class="sp-row">
      <span class="sp-label">${label}</span>
      <div class="sp-ctrl">
        <input type="time" class="sp-input" style="width:85px" id="${inputId}" value="${escapeHTML(String(val))}"
               onchange="saveSP(${instId},'${sp.key}',this.value)">
      </div>
      ${help}
    </div>`;
  }
  if (sp.type === "text") {
    return `<div class="sp-row">
      <span class="sp-label">${label}</span>
      <div class="sp-ctrl">
        <input class="sp-input" type="text" id="${inputId}" value="${escapeHTML(String(val))}">
        <button class="btn btn-xs sp-btn" onclick="saveSP(${instId},'${sp.key}',document.getElementById('${inputId}').value)">Save</button>
      </div>
      ${help}
    </div>`;
  }
  return `<div class="sp-row">
    <span class="sp-label">${label}</span>
    <div class="sp-ctrl">
      <input class="sp-input" type="number" step="${escapeHTML(String(sp.step||1))}" id="${inputId}" value="${escapeHTML(String(val))}">
      <span class="sp-unit">${escapeHTML(sp.unit||"")}</span>
      <button class="btn btn-xs sp-btn" onclick="saveSP(${instId},'${sp.key}',document.getElementById('${inputId}').value)">Save</button>
    </div>
    ${help}
  </div>`;
}

async function saveSP(instId, key, value) {
  try {
    await api(moduleSettingsEndpoint(instId), {
      method:"PATCH", body: JSON.stringify({key, value})
    });
    toast("✓ Saved");
  } catch(e) { toast("Error: "+e.message,"err"); }
}

async function toggleModuleTestMode(instId, currentValue) {
  const next = String(currentValue) === '1' ? '0' : '1';
  try {
    await api(moduleSettingsEndpoint(instId), {
      method:"PATCH", body: JSON.stringify({ key:'test_mode', value: next })
    });
    toast(next === '1' ? '✓ Test mode enabled' : '✓ Test mode disabled');
    await loadInstances();
  } catch(e) {
    toast("Error: " + e.message, "err");
  }
}
