var _nativeImportRows = [];
var _nativeImportSites = [];
var _nativeImportBoards = [];
var _nativeImportLoaded = false;

function nativeImportDefaultRow() {
  return { entity_class: 'DO', key: '', name: '', source: '' };
}

function nativeImportEnsureRows() {
  if (!_nativeImportRows.length) _nativeImportRows = [nativeImportDefaultRow()];
}

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
  _nativeImportRows.push(Object.assign(nativeImportDefaultRow(), prefill || {}));
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
}

function renderNativeImportRows() {
  var wrap = document.getElementById('nativeImportRows');
  if (!wrap) return;
  nativeImportEnsureRows();
  wrap.innerHTML = '<div class="entity-header" style="grid-template-columns:120px 1fr 1fr 1fr auto"><span>Class</span><span>Key</span><span>Label</span><span>Port / Source</span><span></span></div>' + _nativeImportRows.map(function(row, idx) {
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
      + '</div>';
  }).join('');
}

function nativeImportCollectPayload() {
  var deviceName = String((document.getElementById('nativeImportDeviceName') || {}).value || '').trim();
  var friendlyName = String((document.getElementById('nativeImportFriendlyName') || {}).value || '').trim();
  var rows = _nativeImportRows.map(function(row) {
    return {
      entity_class: String(row.entity_class || 'AI').trim().toUpperCase(),
      key: String(row.key || '').trim(),
      name: String(row.name || '').trim(),
      source: String(row.source || '').trim(),
    };
  }).filter(function(row) { return row.key || row.name; });
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
