var _nativeImportRows = [];
var _nativeImportSites = [];
var _nativeImportBoards = [];
var _nativeImportLoaded = false;
var _nativeSession = null;

function nativeImportDefaultRow() {
  return { entity_class: 'DO', key: '', name: '', source: '', entity_type: '', entity_id: '', metadata: null };
}

function nativeNormalizeRow(row) {
  var base = nativeImportDefaultRow();
  return {
    ...base,
    ...(row || {}),
    entity_class: String((row && row.entity_class) || base.entity_class).trim().toUpperCase() || 'AI',
    key: String((row && row.key) || '').trim(),
    name: String((row && row.name) || '').trim(),
    source: String((row && (row.source || row.port_id || row.bus_id || row.entity_id)) || '').trim(),
    entity_type: String((row && (row.entity_type || row.type)) || '').trim().toLowerCase(),
    entity_id: String((row && (row.entity_id || row.source)) || '').trim(),
    metadata: row && row.metadata != null ? row.metadata : null,
  };
}

function nativeRowsFromEntities(entities) {
  return (Array.isArray(entities) ? entities : []).map(function(row) {
    return nativeNormalizeRow(row);
  });
}

function nativeImportEnsureRows() {
  if (!_nativeImportRows.length) _nativeImportRows = [nativeImportDefaultRow()];
}

function nativeSessionIdentityPayload() {
  var payload = nativeImportCollectPayload();
  return {
    site_id: payload.site_id,
    device_id: (_nativeSession && _nativeSession.device_id) ? Number(_nativeSession.device_id) : undefined,
    device_name: payload.device_name,
    friendly_name: payload.friendly_name,
    board_profile_id: payload.board_profile_id,
    ip_address: payload.ip_address,
    hostname: payload.hostname,
    api_host: payload.api_host,
    api_port: payload.api_port,
    // encryption_key intentionally omitted — stored server-side after connect
    mqtt_topic_root: payload.mqtt_topic_root,
  };
}

function nativeAdoptSession(session, opts) {
  _nativeSession = session || null;
  var options = opts || {};
  if (!session) {
    _nativeImportRows = [];
    nativeImportEnsureRows();
    renderNativeImportRows();
    nativeRefreshCommandPanel();
    nativeRenderStateBrowser();
    return;
  }
  if (Array.isArray(session.entities) && session.entities.length) {
    _nativeImportRows = nativeRowsFromEntities(session.entities);
    nativeImportEnsureRows();
    renderNativeImportRows();
  }
  if (options.fillInputs) {
    try {
      if (session.device_name && document.getElementById('nativeImportDeviceName')) document.getElementById('nativeImportDeviceName').value = session.device_name;
      if (session.friendly_name && document.getElementById('nativeImportFriendlyName')) document.getElementById('nativeImportFriendlyName').value = session.friendly_name;
      if (session.board_profile_id && document.getElementById('nativeImportBoard')) document.getElementById('nativeImportBoard').value = session.board_profile_id;
      var payload = session.payload || {};
      var ip = payload.ip_address || payload.api_host || '';
      var host = payload.hostname || '';
      if (ip && document.getElementById('nativeImportIp')) document.getElementById('nativeImportIp').value = ip;
      if (host && document.getElementById('nativeImportHostname')) document.getElementById('nativeImportHostname').value = host;
      if ((payload.api_host || ip) && document.getElementById('nativeImportApiHost')) document.getElementById('nativeImportApiHost').value = payload.api_host || ip;
      if (payload.api_port && document.getElementById('nativeImportApiPort')) document.getElementById('nativeImportApiPort').value = payload.api_port;
    } catch (_) {}
  }
  nativeRefreshCommandPanel();
  nativeRenderStateBrowser();
}


function nativeSessionBadgeHtml(session) {
  if (!session) return '';
  if (session.connected && session.live_stream) return '<span class="pill pill-ok">Native live connected</span>';
  if (session.requires_encryption || (session.device_info && session.device_info.encryption_required) || /requires encryption/i.test(String(session.error || ''))) return '<span class="pill pill-warn">Encryption required</span>';
  if (session.probe && session.probe.reachable) return '<span class="pill pill-info">Native reachable</span>';
  if (session.state) return '<span class="pill">' + escHtml(String(session.state).replace(/_/g,' ')) + '</span>';
  return '';
}

function nativeSessionSummaryHtml(session) {
  if (!session) return 'No native session yet.';
  var parts = [];
  var badge = nativeSessionBadgeHtml(session);
  if (badge) parts.push(badge);
  var entities = Number(session.entity_count || (Array.isArray(session.entities) ? session.entities.length : 0) || 0);
  if (session.connected && session.live_stream) {
    parts.push('Live stream active');
    if (entities) parts.push('entities ' + escHtml(String(entities)));
    return parts.join(' · ');
  }
  if (session.requires_encryption || (session.device_info && session.device_info.encryption_required) || /requires encryption/i.test(String(session.error || ''))) {
    if (session.probe && session.probe.reachable) parts.push('Host reachable on native API');
    if (entities) parts.push('fallback discovery loaded ' + escHtml(String(entities)) + ' entities');
    return parts.join(' · ');
  }
  if (session.probe && session.probe.reachable) {
    parts.push('Probe OK');
    if (entities) parts.push('fallback discovery loaded ' + escHtml(String(entities)) + ' entities');
    return parts.join(' · ');
  }
  if (session.error) parts.push(escHtml(String(session.error)));
  return parts.join(' · ');
}

function nativeLoadSessionFromOutside(session) {
  nativeAdoptSession(session || null, { fillInputs: true });
  var panel = document.getElementById('nativeImportPanel');
  if (panel && panel.style.display === 'none') toggleNativeImportPanel();
}
if (typeof window !== 'undefined') window.nativeImportLoadSession = nativeLoadSessionFromOutside;

function toggleNativeImportPanel() {
  var panel = document.getElementById('nativeImportPanel');
  if (!panel) return;
  var showing = panel.style.display !== 'none';
  if (!showing) closeEspPanels('nativeImportPanel');
  panel.style.display = showing ? 'none' : '';
  if (!showing) {
    nativeImportEnsureRows();
    renderNativeImportRows();
    loadNativeImportLookups();
    nativeRefreshCommandPanel();
  }
  renderEspModeBanner();
}

async function loadNativeImportLookups() {
  var msg = document.getElementById('nativeImportMsg');
  if (msg && !_nativeImportLoaded) msg.textContent = 'Loading sites and board profiles…';
  try {
    var results = await Promise.allSettled([
      api('/sites'),
      api('/esphome/catalog'),
      api('/integrations')
    ]);
    _nativeImportSites = results[0].status === 'fulfilled' ? (results[0].value.sites || []) : [];
    _nativeImportBoards = results[1].status === 'fulfilled' ? (results[1].value.boards || []) : [];
    var integrations = results[2].status === 'fulfilled' ? (results[2].value.integrations || []) : [];
    var supportsNative = integrations.some(function(x) { return x.key === 'esphome' && x.supportsNativeApi; });
    populateNativeImportSiteSelect();
    populateNativeImportBoardSelect();
    renderNativeImportCapability(supportsNative);
    _nativeImportLoaded = true;
    if (msg) msg.textContent = supportsNative ? 'Read-only external native import is ready.' : 'Registry loaded. Native import support not advertised yet.';
    nativeRefreshCommandPanel();
    nativeRenderStateBrowser();
  } catch (e) {
    if (msg) msg.textContent = 'Lookup load failed: ' + e.message;
  }
}

function populateNativeImportSiteSelect() {
  var el = document.getElementById('nativeImportSite');
  if (!el) return;
  var current = String(el.value || '');
  var options = _nativeImportSites.map(function(site) {
    return '<option value="' + escHtml(site.id) + '">' + escHtml(site.name || ('Site ' + site.id)) + '</option>';
  }).join('');
  el.innerHTML = options || '<option value="1">Site 1</option>';
  if (current && Array.from(el.options).some(function(o) { return String(o.value) === current; })) el.value = current;
}

function populateNativeImportBoardSelect() {
  var el = document.getElementById('nativeImportBoard');
  if (!el) return;
  var current = String(el.value || '');
  var options = '<option value="">Generic external native</option>' + _nativeImportBoards.map(function(row) {
    var label = (row.label || row.id || 'Board') + ' · ' + (row.id || '');
    return '<option value="' + escHtml(row.id || '') + '">' + escHtml(label) + '</option>';
  }).join('');
  el.innerHTML = options;
  if (current && Array.from(el.options).some(function(o) { return String(o.value) === current; })) el.value = current;
}

function renderNativeImportCapability(ok) {
  var el = document.getElementById('nativeImportCapability');
  if (!el) return;
  el.innerHTML = ok
    ? ('<div style="display:flex;flex-wrap:wrap;gap:8px">' +
       summaryPill('Adapter: esphome', '#1d8cff', 'rgba(29,140,255,.28)') +
       summaryPill('Mode: external_native', '#1d8cff', 'rgba(29,140,255,.28)') +
       summaryPill('Source: native_api', '#1d8cff', 'rgba(29,140,255,.28)') +
       summaryPill('Read-only', '#f59e0b', 'rgba(245,158,11,.35)') + '</div>')
    : '<div style="font-size:11px;color:var(--warn)">Adapter registry did not confirm native support, but you can still try the import route if the backend patch is present.</div>';
}

function nativeImportAddRow(prefill) {
  _nativeImportRows.push(nativeNormalizeRow(prefill || {}));
  renderNativeImportRows();
}

function nativeImportRemoveRow(idx) {
  _nativeImportRows.splice(idx, 1);
  nativeImportEnsureRows();
  renderNativeImportRows();
}

function nativeImportPatchRow(idx, field, value) {
  if (!_nativeImportRows[idx]) return;
  _nativeImportRows[idx][field] = value;
  nativeRefreshCommandPanel();
}

function renderNativeImportRows() {
  var wrap = document.getElementById('nativeImportRows');
  if (!wrap) return;
  nativeImportEnsureRows();
  wrap.innerHTML = '<div class="entity-header" style="grid-template-columns:120px 1fr 1fr 1fr auto"><span>Class</span><span>Key</span><span>Label</span><span>Port / Source</span><span></span></div>' + _nativeImportRows.map(function(row, idx) {
    row = nativeNormalizeRow(row);
    var metaHint = row.entity_type ? ('<div style="grid-column:2 / span 3;font-size:10px;color:var(--muted);margin-top:2px">' + escHtml(row.entity_type + (row.entity_id ? (' · ' + row.entity_id) : '')) + '</div>') : '';
    return '<div class="entity-item" style="grid-template-columns:120px 1fr 1fr 1fr auto">'
      + '<select onchange="nativeImportPatchRow(' + idx + ',\'entity_class\', this.value)">'
      + '<option value="DO"' + (row.entity_class === 'DO' ? ' selected' : '') + '>DO</option>'
      + '<option value="DI"' + (row.entity_class === 'DI' ? ' selected' : '') + '>DI</option>'
      + '<option value="AI"' + (row.entity_class === 'AI' ? ' selected' : '') + '>AI</option>'
      + '<option value="AO"' + (row.entity_class === 'AO' ? ' selected' : '') + '>AO</option>'
      + '</select>'
      + '<input value="' + escHtml(row.key || '') + '" placeholder="e.g. x01 / temp / relay1" oninput="nativeImportPatchRow(' + idx + ',\'key\', this.value)">'
      + '<input value="' + escHtml(row.name || '') + '" placeholder="Label shown in ELARIS" oninput="nativeImportPatchRow(' + idx + ',\'name\', this.value)">'
      + '<input value="' + escHtml(row.source || '') + '" placeholder="Optional source hint: HT1 / Y01 / GPIO32" oninput="nativeImportPatchRow(' + idx + ',\'source\', this.value)">'
      + '<button type="button" class="entity-remove" title="Remove" onclick="nativeImportRemoveRow(' + idx + ')">&#215;</button>'
      + metaHint
      + '</div>';
  }).join('');
  nativeRefreshCommandPanel();
}

function nativeImportCollectPayload() {
  var deviceName = String((document.getElementById('nativeImportDeviceName') || {}).value || '').trim();
  var friendlyName = String((document.getElementById('nativeImportFriendlyName') || {}).value || '').trim();
  var rows = _nativeImportRows.map(function(row) {
    row = nativeNormalizeRow(row);
    return {
      entity_class: String(row.entity_class || 'AI').trim().toUpperCase(),
      key: String(row.key || '').trim(),
      name: String(row.name || '').trim(),
      source: String(row.source || '').trim(),
      entity_type: String(row.entity_type || '').trim(),
      entity_id: String(row.entity_id || '').trim(),
      metadata: row.metadata || null,
    };
  }).filter(function(row) { return row.key || row.name || row.entity_id; });
  return {
    site_id: Number((document.getElementById('nativeImportSite') || {}).value || 1),
    device_name: deviceName,
    friendly_name: friendlyName || deviceName,
    board_profile_id: String((document.getElementById('nativeImportBoard') || {}).value || '').trim(),
    ip_address: String((document.getElementById('nativeImportIp') || {}).value || '').trim(),
    hostname: String((document.getElementById('nativeImportHostname') || {}).value || '').trim(),
    api_host: String((document.getElementById('nativeImportApiHost') || {}).value || '').trim(),
    api_port: Number((document.getElementById('nativeImportApiPort') || {}).value || 6053),
    encryption_key: String((document.getElementById('nativeImportEncryption') || {}).value || '').trim(),
    mqtt_topic_root: String((document.getElementById('nativeImportMqttRoot') || {}).value || '').trim(),
    entities: rows,
  };
}

function nativeSessionEntities() {
  if (_nativeSession && Array.isArray(_nativeSession.entities) && _nativeSession.entities.length) return nativeRowsFromEntities(_nativeSession.entities);
  return nativeRowsFromEntities(_nativeImportRows.filter(function(row) { return row && (row.entity_id || row.entity_type); }));
}

function nativeCommandSupportsType(type) {
  var t = String(type || '').trim().toLowerCase();
  return t === 'switch' || t === 'light' || t === 'cover' || t === 'select' || t === 'climate' || t === 'fan' || t === 'number' || t === 'lock' || t === 'media_player';
}

function nativeCommandOptionsForEntity(entity) {
  var type = String(entity && entity.entity_type || '').trim().toLowerCase();
  if (type === 'switch') return [
    { value: 'on', label: 'Turn on' },
    { value: 'off', label: 'Turn off' }
  ];
  if (type === 'light') return [
    { value: 'on', label: 'Turn on / set light' },
    { value: 'off', label: 'Turn off' }
  ];
  if (type === 'cover') return [
    { value: 'open', label: 'Open' },
    { value: 'close', label: 'Close' },
    { value: 'stop', label: 'Stop' },
    { value: 'position', label: 'Set position %' }
  ];
  if (type === 'select') return [
    { value: 'select', label: 'Set option' }
  ];
  if (type === 'climate') return [
    { value: 'off', label: 'Set mode: off' },
    { value: 'heat', label: 'Set mode: heat' },
    { value: 'cool', label: 'Set mode: cool' },
    { value: 'heat_cool', label: 'Set mode: heat_cool' },
    { value: 'auto', label: 'Set mode: auto' },
    { value: 'fan_only', label: 'Set mode: fan_only' },
    { value: 'dry', label: 'Set mode: dry' },
    { value: 'set', label: 'Adjust temperatures only' }
  ];
  if (type === 'fan') return [
    { value: 'on', label: 'Turn on / set fan' },
    { value: 'off', label: 'Turn off' },
    { value: 'set', label: 'Adjust speed / direction' }
  ];
  if (type === 'number') return [
    { value: 'set', label: 'Set value' }
  ];
  if (type === 'lock') return [
    { value: 'lock', label: 'Lock' },
    { value: 'unlock', label: 'Unlock' },
    { value: 'open', label: 'Open' }
  ];
  if (type === 'media_player') return [
    { value: 'play', label: 'Play' },
    { value: 'pause', label: 'Pause' },
    { value: 'stop', label: 'Stop' },
    { value: 'mute', label: 'Mute' },
    { value: 'unmute', label: 'Unmute' },
    { value: 'toggle', label: 'Toggle' }
  ];
  return [];
}

function nativeSelectedCommandEntity() {
  var el = document.getElementById('nativeCommandEntity');
  var selected = String(el && el.value || '').trim();
  if (!selected) return null;
  return nativeSessionEntities().find(function(row) {
    return String(row.entity_id || row.source || row.key || '').trim() === selected;
  }) || null;
}

function nativeRefreshCommandPanel() {
  var statusEl = document.getElementById('nativeCommandStatus');
  var msgEl = document.getElementById('nativeCommandMsg');
  var entityEl = document.getElementById('nativeCommandEntity');
  if (!statusEl || !msgEl || !entityEl) return;
  var entities = nativeSessionEntities().filter(function(row) { return nativeCommandSupportsType(row.entity_type); });
  var current = String(entityEl.value || '').trim();
  if (_nativeSession && (_nativeSession.connected || _nativeSession.probe || _nativeSession.state)) {
    statusEl.innerHTML = nativeSessionSummaryHtml(_nativeSession);
  } else {
    statusEl.textContent = 'Connect a native session first to enable live commands for switch, light, cover, select, climate, fan, number, lock and media player.';
  }
  entityEl.innerHTML = entities.length ? entities.map(function(row) {
    var label = (row.name || row.key || row.entity_id || 'entity') + ' · ' + (row.entity_type || 'unknown');
    var value = String(row.entity_id || row.source || row.key || '').trim();
    return '<option value="' + escHtml(value) + '">' + escHtml(label) + '</option>';
  }).join('') : '<option value="">No command-capable entities</option>';
  if (current && Array.from(entityEl.options).some(function(o) { return String(o.value) === current; })) entityEl.value = current;
  else if (entities[0]) entityEl.value = String(entities[0].entity_id || entities[0].source || entities[0].key || '');
  if (!(_nativeSession && _nativeSession.connected && _nativeSession.live_stream)) {
    msgEl.textContent = entities.length ? 'Entity list ready, but commands stay disabled until a live native session is connected.' : 'No command-capable entities available yet.';
  } else {
    msgEl.textContent = 'Choose an entity and send a native command.';
  }
  nativeCommandEntityChanged();
}

function nativeCommandEntityChanged() {
  var entity = nativeSelectedCommandEntity();
  var actionEl = document.getElementById('nativeCommandAction');
  var msgEl = document.getElementById('nativeCommandMsg');
  if (!actionEl) return;
  var options = nativeCommandOptionsForEntity(entity);
  actionEl.innerHTML = options.length ? options.map(function(opt) {
    return '<option value="' + escHtml(opt.value) + '">' + escHtml(opt.label) + '</option>';
  }).join('') : '<option value="">No actions</option>';
  if (entity && msgEl && entity.metadata && Array.isArray(entity.metadata.options) && entity.entity_type === 'select') {
    msgEl.textContent = 'Available select options: ' + entity.metadata.options.join(', ');
  }
  nativeCommandActionChanged();
}

function nativeCommandActionChanged() {
  var fields = document.getElementById('nativeCommandFields');
  if (!fields) return;
  var entity = nativeSelectedCommandEntity();
  var action = String((document.getElementById('nativeCommandAction') || {}).value || '').trim().toLowerCase();
  if (!entity) {
    fields.innerHTML = '<div class="form-row"><label>Details</label><div class="form-hint">No command-capable entity is selected yet.</div></div>';
    return;
  }
  var type = String(entity.entity_type || '').trim().toLowerCase();
  if (type === 'light') {
    fields.innerHTML = ''
      + '<div class="form-row"><label>Brightness % (optional)</label><input type="number" id="nativeCommandBrightness" min="0" max="100" placeholder="0-100"></div>'
      + '<div class="form-row"><label>Transition ms (optional)</label><input type="number" id="nativeCommandTransition" min="0" placeholder="e.g. 500"></div>'
      + '<div class="form-row"><label>Effect (optional)</label><input type="text" id="nativeCommandEffect" placeholder="e.g. Rainbow"></div>';
    return;
  }
  if (type === 'cover' && action === 'position') {
    fields.innerHTML = '<div class="form-row"><label>Position %</label><input type="number" id="nativeCommandPosition" min="0" max="100" placeholder="0-100"></div>';
    return;
  }
  if (type === 'select') {
    var options = entity.metadata && Array.isArray(entity.metadata.options) ? entity.metadata.options : [];
    fields.innerHTML = options.length
      ? '<div class="form-row"><label>Option</label><select id="nativeCommandOption">' + options.map(function(opt) { return '<option value="' + escHtml(String(opt)) + '">' + escHtml(String(opt)) + '</option>'; }).join('') + '</select></div>'
      : '<div class="form-row"><label>Option</label><input type="text" id="nativeCommandOption" placeholder="Enter option"></div>';
    return;
  }
  if (type === 'climate') {
    fields.innerHTML = ''
      + '<div class="form-row"><label>Target temperature (optional)</label><input type="number" id="nativeCommandClimateTarget" step="0.1" placeholder="e.g. 22"></div>'
      + '<div class="form-row"><label>Target high (optional)</label><input type="number" id="nativeCommandClimateTargetHigh" step="0.1" placeholder="e.g. 24"></div>'
      + '<div class="form-row"><label>Target low (optional)</label><input type="number" id="nativeCommandClimateTargetLow" step="0.1" placeholder="e.g. 20"></div>'
      + '<div class="form-row"><label>Fan mode (optional)</label><input type="text" id="nativeCommandClimateFanMode" placeholder="auto / low / high"></div>'
      + '<div class="form-row"><label>Swing mode (optional)</label><input type="text" id="nativeCommandClimateSwingMode" placeholder="off / vertical / horizontal"></div>';
    return;
  }
  if (type === 'fan') {
    fields.innerHTML = ''
      + '<div class="form-row"><label>Speed level % (optional)</label><input type="number" id="nativeCommandFanSpeed" min="0" max="100" placeholder="0-100"></div>'
      + '<div class="form-row"><label>Direction (optional)</label><select id="nativeCommandFanDirection"><option value="">Unchanged</option><option value="forward">forward</option><option value="reverse">reverse</option></select></div>'
      + '<div class="form-row"><label>Oscillating (optional)</label><select id="nativeCommandFanOsc"><option value="">Unchanged</option><option value="true">true</option><option value="false">false</option></select></div>';
    return;
  }
  if (type === 'number') {
    fields.innerHTML = '<div class="form-row"><label>Value</label><input type="number" id="nativeCommandNumberValue" step="0.1" placeholder="Enter number"></div>';
    return;
  }
  if (type === 'lock') {
    fields.innerHTML = '<div class="form-row"><label>Code (optional)</label><input type="text" id="nativeCommandLockCode" placeholder="PIN / code if required"></div>';
    return;
  }
  if (type === 'media_player') {
    fields.innerHTML = ''
      + '<div class="form-row"><label>Volume % (optional)</label><input type="number" id="nativeCommandMediaVolume" min="0" max="100" placeholder="0-100"></div>'
      + '<div class="form-row"><label>Media URL (optional)</label><input type="text" id="nativeCommandMediaUrl" placeholder="http://example.com/audio.mp3"></div>';
    return;
  }
  fields.innerHTML = '<div class="form-row"><label>Details</label><div class="form-hint">This command only needs the selected action.</div></div>';
}

function nativeStateRows() {
  var byEntity = _nativeSession && _nativeSession.state_snapshot && _nativeSession.state_snapshot.by_entity ? _nativeSession.state_snapshot.by_entity : {};
  return Object.keys(byEntity || {}).map(function(key) { return byEntity[key]; }).sort(function(a, b) {
    var an = String(a && (a.entity_name || a.entity_key || a.entity_id) || '').toLowerCase();
    var bn = String(b && (b.entity_name || b.entity_key || b.entity_id) || '').toLowerCase();
    return an.localeCompare(bn);
  });
}

function nativeFormatStateValue(row) {
  if (!row) return '—';
  var payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  if (payload) {
    if (payload.state != null && typeof payload.state !== 'object') return String(payload.state);
    if (payload.value != null && typeof payload.value !== 'object') return String(payload.value);
    if (payload.option != null) return String(payload.option);
    if (payload.mode != null) return String(payload.mode);
    if (payload.command != null) return String(payload.command);
  }
  if (row.value != null && typeof row.value !== 'object') return String(row.value);
  return '—';
}

function nativeRenderStateBrowser() {
  var statusEl = document.getElementById('nativeStateBrowserStatus');
  var bodyEl = document.getElementById('nativeStateBrowserBody');
  var searchEl = document.getElementById('nativeStateBrowserSearch');
  if (!statusEl || !bodyEl) return;
  var rows = nativeStateRows();
  var query = String(searchEl && searchEl.value || '').trim().toLowerCase();
  var filtered = query ? rows.filter(function(row) {
    var hay = [row.entity_name, row.entity_key, row.entity_id, row.entity_type, nativeFormatStateValue(row)].join(' ').toLowerCase();
    return hay.indexOf(query) >= 0;
  }) : rows;
  if (_nativeSession && _nativeSession.connected && _nativeSession.live_stream) {
    statusEl.innerHTML = '<span style="color:var(--good)">Live state stream</span> ' + escHtml(String(rows.length)) + ' state rows';
  } else if (_nativeSession && _nativeSession.state_snapshot) {
    statusEl.innerHTML = '<span style="color:var(--warn)">Session snapshot only</span> ' + escHtml(String(rows.length)) + ' state rows';
  } else {
    statusEl.textContent = 'Connect or load a native session to inspect live entity states.';
  }
  if (!filtered.length) {
    bodyEl.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px">No native state rows yet.</div>';
    return;
  }
  bodyEl.innerHTML = '<div class="entity-header" style="grid-template-columns:1.2fr .7fr .7fr .8fr 1fr"><span>Entity</span><span>Type</span><span>Value</span><span>Updated</span><span>Details</span></div>' + filtered.map(function(row) {
    var details = row.payload && typeof row.payload === 'object' ? Object.keys(row.payload).filter(function(k) { return k !== 'entity' && k !== 'entityId'; }).slice(0, 5).map(function(k) { return k + ': ' + row.payload[k]; }).join(' · ') : '';
    return '<div class="entity-row" style="grid-template-columns:1.2fr .7fr .7fr .8fr 1fr">'
      + '<div><strong>' + escHtml(String(row.entity_name || row.entity_key || row.entity_id || 'entity')) + '</strong><div class="form-hint">' + escHtml(String(row.entity_id || row.entity_key || '')) + '</div></div>'
      + '<div>' + escHtml(String(row.entity_type || 'unknown')) + '</div>'
      + '<div>' + escHtml(nativeFormatStateValue(row)) + '</div>'
      + '<div>' + escHtml(String(row.ts || '—').replace('T',' ').replace('Z','')) + '</div>'
      + '<div class="form-hint">' + escHtml(details || '—') + '</div>'
      + '</div>';
  }).join('');
}

async function nativeLoadSessionList() {
  var msgEl = document.getElementById('nativeCommandMsg');
  try {
    if (msgEl) msgEl.textContent = 'Loading native sessions…';
    var out = await api('/integrations/esphome/native-sessions');
    var sessions = Array.isArray(out.sessions) ? out.sessions : [];
    var desired = nativeSessionIdentityPayload();
    var chosen = sessions.find(function(s) {
      return desired.device_name && s.device_name && String(s.device_name).toLowerCase() === String(desired.device_name).toLowerCase();
    }) || sessions.find(function(s) {
      return desired.api_host && s.payload && s.payload.api_host && String(s.payload.api_host).toLowerCase() === String(desired.api_host).toLowerCase();
    }) || null;
    nativeAdoptSession(chosen, { fillInputs: false });
    if (msgEl) {
      if (chosen) msgEl.textContent = 'Loaded native session ' + (chosen.device_name || chosen.session_key);
      else if (sessions.length > 0) msgEl.textContent = 'No matching session found. Connect first or check device name / host.';
      else msgEl.textContent = 'No native sessions found.';
    }
  } catch (e) {
    if (msgEl) msgEl.textContent = 'Failed to load sessions: ' + (e.message || String(e));
  }
}

async function nativeProbeImport() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.api_host && !payload.ip_address && !payload.hostname) throw new Error('missing_api_host');
    if (msg) msg.textContent = 'Probing native API host…';
    var out = await api('/integrations/esphome/native-probe', { method: 'POST', body: JSON.stringify(payload) });
    var probe = out.probe || {};
    if (msg) msg.innerHTML = out.reachable
      ? '<span style="color:var(--good)">✓ Native probe OK</span> ' + escHtml((probe.host || payload.api_host || payload.ip_address || payload.hostname) + ':' + (probe.port || payload.api_port || 6053)) + (Number.isFinite(Number(probe.latency_ms)) ? (' · ' + escHtml(String(probe.latency_ms)) + ' ms') : '')
      : '<span style="color:var(--bad)">Probe failed:</span> ' + escHtml(String(probe.error || 'unknown'));
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Probe failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeDiscoverAssist() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.board_profile_id && !payload.device_name) throw new Error('pick_board_or_existing_device_name');
    if (msg) msg.textContent = 'Building native discovery suggestions…';
    var out = await api('/integrations/esphome/discover-native', { method: 'POST', body: JSON.stringify(payload) });
    var entities = Array.isArray(out.entities) ? out.entities : [];
    if (!entities.length) throw new Error((out.warnings && out.warnings[0]) || 'no_entities');
    _nativeImportRows = nativeRowsFromEntities(entities);
    nativeImportEnsureRows();
    renderNativeImportRows();
    if (msg) msg.innerHTML = '<span style="color:var(--good)">✓ Suggestions ready</span> ' + escHtml(String(out.entity_count || entities.length)) + ' channel rows loaded' + (out.discovery_mode ? (' · ' + escHtml(out.discovery_mode)) : '');
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Discover failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeSyncAssist() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.device_name) throw new Error('missing_device_name');
    if (msg) msg.textContent = 'Re-syncing native card into pending approval…';
    var out = await api('/integrations/esphome/sync-native', { method: 'POST', body: JSON.stringify(payload) });
    if (msg) msg.innerHTML = '<span style="color:var(--good)">✓ Native re-sync complete</span> pending rows: ' + escHtml(String(out.pending_injected || 0));
    try { if (typeof loadInstallerDevices === 'function') await loadInstallerDevices(); } catch (e) {}
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Native re-sync failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function submitNativeImport() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.device_name) throw new Error('missing_device_name');
    if (!payload.entities.length) throw new Error('missing_entities');
    if (msg) msg.textContent = 'Importing external native device…';
    var out = await api('/integrations/esphome/import-native', { method: 'POST', body: JSON.stringify(payload) });
    var imported = Number(out.pending_injected || 0);
    if (msg) msg.innerHTML = '<span style="color:var(--good)">✓ Imported</span> ' + escHtml(payload.device_name) + ' as read-only external native. Pending IO rows: ' + escHtml(imported);
    try { if (typeof loadInstallerDevices === 'function') await loadInstallerDevices(); } catch (e) {}
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Import failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeConnectSession() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.api_host && !payload.ip_address && !payload.hostname) throw new Error('missing_api_host');
    if (msg) msg.textContent = 'Connecting native session…';
    var out = await api('/integrations/esphome/native-connect', { method: 'POST', body: JSON.stringify(payload) });
    var session = out.session || {};
    nativeAdoptSession(session, { fillInputs: true });
    if (msg) msg.innerHTML = nativeSessionSummaryHtml(session);
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Connect failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeRefreshSession() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.device_name && !payload.api_host && !payload.ip_address && !payload.hostname) throw new Error('missing_session_identity');
    if (msg) msg.textContent = 'Refreshing native session…';
    var out = await api('/integrations/esphome/native-refresh', { method: 'POST', body: JSON.stringify(payload) });
    var session = out.session || {};
    nativeAdoptSession(session, { fillInputs: false });
    if (msg) msg.innerHTML = nativeSessionSummaryHtml(session);
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Refresh failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeDisconnectSession() {
  var msg = document.getElementById('nativeImportMsg');
  try {
    var payload = nativeImportCollectPayload();
    if (!payload.device_name && !payload.api_host && !payload.ip_address && !payload.hostname) throw new Error('missing_session_identity');
    if (msg) msg.textContent = 'Disconnecting native session…';
    var out = await api('/integrations/esphome/native-disconnect', { method: 'POST', body: JSON.stringify(payload) });
    var session = out.session || {};
    nativeAdoptSession(session, { fillInputs: false });
    if (msg) msg.innerHTML = '<span style="color:var(--warn)">Native session disconnected</span> ' + escHtml(String(session.state || 'disconnected'));
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Disconnect failed:</span> ' + escHtml(e.message || String(e));
  }
}

async function nativeSendCommand() {
  var msg = document.getElementById('nativeCommandMsg');
  try {
    if (!(_nativeSession && _nativeSession.connected && _nativeSession.live_stream)) throw new Error('connect_live_native_session_first');
    var entity = nativeSelectedCommandEntity();
    if (!entity) throw new Error('native_command_entity_required');
    var action = String((document.getElementById('nativeCommandAction') || {}).value || '').trim().toLowerCase();
    var command = {
      entity_id: entity.entity_id || entity.source || '',
      entity_key: entity.key || '',
      entity_type: entity.entity_type || '',
      action: action,
    };
    if (entity.entity_type === 'light') {
      var brightnessEl = document.getElementById('nativeCommandBrightness');
      var transitionEl = document.getElementById('nativeCommandTransition');
      var effectEl = document.getElementById('nativeCommandEffect');
      if (brightnessEl && String(brightnessEl.value || '').trim()) command.brightness = Number(brightnessEl.value);
      if (transitionEl && String(transitionEl.value || '').trim()) command.transition_ms = Number(transitionEl.value);
      if (effectEl && String(effectEl.value || '').trim()) command.effect = String(effectEl.value).trim();
    } else if (entity.entity_type === 'cover' && action === 'position') {
      var posEl = document.getElementById('nativeCommandPosition');
      if (!posEl || !String(posEl.value || '').trim()) throw new Error('cover_position_required');
      command.position = Number(posEl.value);
    } else if (entity.entity_type === 'select') {
      var optEl = document.getElementById('nativeCommandOption');
      if (!optEl || !String(optEl.value || '').trim()) throw new Error('select_option_required');
      command.option = String(optEl.value).trim();
    } else if (entity.entity_type === 'climate') {
      var ct = document.getElementById('nativeCommandClimateTarget');
      var cth = document.getElementById('nativeCommandClimateTargetHigh');
      var ctl = document.getElementById('nativeCommandClimateTargetLow');
      var cfm = document.getElementById('nativeCommandClimateFanMode');
      var csm = document.getElementById('nativeCommandClimateSwingMode');
      if (ct && String(ct.value || '').trim()) command.target_temperature = Number(ct.value);
      if (cth && String(cth.value || '').trim()) command.target_temperature_high = Number(cth.value);
      if (ctl && String(ctl.value || '').trim()) command.target_temperature_low = Number(ctl.value);
      if (cfm && String(cfm.value || '').trim()) command.fan_mode = String(cfm.value).trim();
      if (csm && String(csm.value || '').trim()) command.swing_mode = String(csm.value).trim();
    } else if (entity.entity_type === 'fan') {
      var fs = document.getElementById('nativeCommandFanSpeed');
      var fd = document.getElementById('nativeCommandFanDirection');
      var fo = document.getElementById('nativeCommandFanOsc');
      if (fs && String(fs.value || '').trim()) command.speed_level = Number(fs.value);
      if (fd && String(fd.value || '').trim()) command.direction = String(fd.value).trim();
      if (fo && String(fo.value || '').trim()) command.oscillating = String(fo.value).trim();
    } else if (entity.entity_type === 'number') {
      var nv = document.getElementById('nativeCommandNumberValue');
      if (!nv || !String(nv.value || '').trim()) throw new Error('number_value_required');
      command.value = Number(nv.value);
    } else if (entity.entity_type === 'lock') {
      var lc = document.getElementById('nativeCommandLockCode');
      if (lc && String(lc.value || '').trim()) command.code = String(lc.value).trim();
    } else if (entity.entity_type === 'media_player') {
      var mv = document.getElementById('nativeCommandMediaVolume');
      var mu = document.getElementById('nativeCommandMediaUrl');
      if (mv && String(mv.value || '').trim()) command.volume = Number(mv.value);
      if (mu && String(mu.value || '').trim()) command.media_url = String(mu.value).trim();
    }
    if (msg) msg.textContent = 'Sending native command…';
    var payload = nativeSessionIdentityPayload();
    var out = await api('/integrations/esphome/native-command', { method: 'POST', body: JSON.stringify({ ...payload, command: command }) });
    var session = out.session || null;
    if (session) nativeAdoptSession(session, { fillInputs: false });
    var result = out.command_result || session && session.last_command_result || {};
    if (msg) msg.innerHTML = '<span style="color:var(--good)">✓ Native command sent</span> ' + escHtml(String(result.entity_name || entity.name || entity.key || entity.entity_id || 'entity')) + ' · ' + escHtml(String((result.request && (result.request.option || result.request.action || result.request.state)) || action || 'ok'));
  } catch (e) {
    if (msg) msg.innerHTML = '<span style="color:var(--bad)">Command failed:</span> ' + escHtml(e.message || String(e));
  }
}
