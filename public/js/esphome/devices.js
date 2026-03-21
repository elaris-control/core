// ── Installer devices / saved configs ─────────────────────────────────────
var savedConfigs = [];
var installerDevices = [];
var installerDevicesRaw = [];
if (typeof window.selectedInstallerDeviceId === 'undefined') window.selectedInstallerDeviceId = null;


function updateBoardSelectionUX() {
  var sel = document.getElementById('boardSelect');
  var help = document.getElementById('boardSelectHelp');
  if (!sel || !help) return;
  var reflash = !!(typeof window !== 'undefined' && window.selectedInstallerDeviceId);
  sel.disabled = reflash;
  sel.style.opacity = reflash ? '.85' : '1';
  if (reflash) {
    help.innerHTML = 'Reflash mode uses the board profile already attached to the selected installer card. To change board family, clear the reflash target first. Use <strong>Browse ESPHome Catalog</strong> or <strong>Import YAML</strong> to install more board profiles into the ELARIS catalog.';
  } else {
    help.innerHTML = 'This list shows board profiles already installed in the ELARIS catalog. It is not the full live devices.esphome.io list — use <strong>Browse ESPHome Catalog</strong> or <strong>Import YAML</strong> to add more profiles.';
  }
}

function installerDeviceIdentityKeys(d) {
  if (!d) return [];
  var keys = [];
  function push(kind, value) {
    var v = String(value || '').trim().toLowerCase();
    if (v) keys.push(kind + ':' + v);
  }
  push('ip', d.ip_address);
  push('ip', d.target_ip);
  push('serial', d.serial_port);
  push('serial', d.target_port);
  push('host', d.hostname);
  push('mqtt', d.mqtt_topic_root);
  push('mac', d.mac_address);
  var strongCount = keys.length;
  if (!strongCount) {
    push('name', d.name);
    push('friendly', d.friendly_name);
  }
  return Array.from(new Set(keys));
}

function installerDeviceFingerprint(d) {
  var keys = installerDeviceIdentityKeys(d);
  return keys[0] || ('row:' + String((d && d.id) || ''));
}

var INSTALLER_ONLINE_STALE_MS = 15 * 60 * 1000;
var INSTALLER_DEFAULT_STALE_MS = 10 * 60 * 1000;

function installerDeviceStaleThresholdMs(row) {
  var status = String((row && row.status) || '').toLowerCase();
  return status === 'online' ? INSTALLER_ONLINE_STALE_MS : INSTALLER_DEFAULT_STALE_MS;
}

function installerDeviceIsStale(row) {
  if (!row || !row.last_seen_at) return false;
  var ts = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(ts)) return false;
  return (Date.now() - ts) > installerDeviceStaleThresholdMs(row);
}

function installerRecencyBonus(ts) {
  var ms = new Date(ts || '').getTime();
  if (!Number.isFinite(ms)) return 0;
  var ageMin = (Date.now() - ms) / 60000;
  if (ageMin <= 2) return 18;
  if (ageMin <= 10) return 12;
  if (ageMin <= 60) return 6;
  if (ageMin <= 360) return 2;
  return 0;
}

function pickBetterInstallerDevice(a, b) {
  if (!a) return b;
  if (!b) return a;
  function score(x) {
    var s = 0;
    var status = String(x.status || '').toLowerCase();
    var stale = installerDeviceIsStale(x);
    if (status === 'online') s += stale ? 8 : 72;
    else if (status === 'flashed') s += 52;
    else if (status === 'generated' || status === 'queued' || status === 'running') s += 40;
    else if (status === 'error') s -= 6;
    if (String(x.job_status || '').toLowerCase() === 'running') s += 12;
    else if (String(x.job_status || '').toLowerCase() === 'queued') s += 8;
    else if (String(x.job_status || '').toLowerCase() === 'success') s += 4;
    if (x.ip_address || x.target_ip) s += 10;
    if (x.serial_port || x.target_port) s += 8;
    if (x.hostname) s += 6;
    if (x.mac_address) s += 12;
    if (x.mqtt_topic_root) s += 6;
    if (x.last_seen_at) s += stale ? 1 : 14;
    s += installerRecencyBonus(x.updated_at || x.job_finished_at || x.created_at);
    return s;
  }
  var sa = score(a), sb = score(b);
  if (sb > sa) return b;
  if (sa > sb) return a;
  var aFresh = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
  var bFresh = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
  if (bFresh > aFresh) return b;
  if (aFresh > bFresh) return a;
  return Number(b.id || 0) > Number(a.id || 0) ? b : a;
}

function mergeInstallerDeviceRows(rows) {
  var merged = [];
  var groups = [];
  (rows || []).forEach(function(row) {
    var keys = installerDeviceIdentityKeys(row);
    var groupIndexes = [];
    groups.forEach(function(group, idx) {
      for (var i = 0; i < keys.length; i++) {
        if (group.keySet.has(keys[i])) { groupIndexes.push(idx); break; }
      }
    });
    if (!groupIndexes.length) {
      var keySet = new Set(keys.length ? keys : [installerDeviceFingerprint(row)]);
      groups.push({ rows: [Object.assign({}, row)], keySet: keySet });
      return;
    }
    var base = groups[groupIndexes[0]];
    base.rows.push(Object.assign({}, row));
    keys.forEach(function(k) { base.keySet.add(k); });
    for (var gi = groupIndexes.length - 1; gi >= 1; gi--) {
      var other = groups[groupIndexes[gi]];
      other.rows.forEach(function(r) { base.rows.push(r); });
      other.keySet.forEach(function(k) { base.keySet.add(k); });
      groups.splice(groupIndexes[gi], 1);
    }
  });
  groups.forEach(function(group) {
    var out = null;
    group.rows.forEach(function(row) {
      if (!out) { out = Object.assign({}, row); return; }
      var keep = pickBetterInstallerDevice(out, row);
      var other = keep === out ? row : out;
      out = Object.assign({}, other, keep);
      if (!out.friendly_name) out.friendly_name = other.friendly_name;
      if (!out.name) out.name = other.name;
      if (!out.board_profile_id) out.board_profile_id = other.board_profile_id;
      if (!out.ip_address) out.ip_address = other.ip_address || other.target_ip || '';
      if (!out.target_ip) out.target_ip = other.target_ip || other.ip_address || '';
      if (!out.serial_port) out.serial_port = other.serial_port || other.target_port || '';
      if (!out.target_port) out.target_port = other.target_port || other.serial_port || '';
      if (!out.hostname) out.hostname = other.hostname || '';
      if (!out.mqtt_topic_root) out.mqtt_topic_root = other.mqtt_topic_root || '';
      if (!out.mac_address) out.mac_address = other.mac_address || '';
    });
    if (out) {
      out._mergedCount = group.rows.length;
      out._mergedNames = Array.from(new Set(group.rows.map(function(r) { return String(r.friendly_name || r.name || '').trim(); }).filter(Boolean)));
      merged.push(out);
    }
  });
  merged.sort(function(a, b) { return Number(b.id || 0) - Number(a.id || 0); });
  return merged;
}

function parseJsonMaybe(raw, fallback) {
  if (raw == null || raw === '') return fallback == null ? null : fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (_) { return fallback == null ? null : fallback; }
}

function nativeRuntimeMetaFromRow(row) {
  var parsed = parseJsonMaybe(row && row.last_validation_json, {}) || {};
  return parsed && parsed.native_runtime ? parsed.native_runtime : null;
}

function nativeCardStatusHtml(row) {
  if (!isExternalNativeDevice(row)) return '';
  var meta = nativeRuntimeMetaFromRow(row) || {};
  var encryptedRequired = !!meta.encryption_required || /requires encryption/i.test(String(meta.last_stream_error || ''));
  var hasEntities = Number(meta.last_native_entity_count || 0) > 0;
  if (meta.status === 'online' && meta.last_stream_connected_at) return '<span class="pill pill-ok">Native live connected</span>';
  if (encryptedRequired) return '<span class="pill pill-warn">Encryption required</span>';
  if (meta.last_probe && meta.last_probe.reachable) return '<span class="pill pill-info">Native reachable</span>';
  if (hasEntities) return '<span class="pill">Fallback discovery</span>';
  return '<span class="pill">Native pending</span>';
}

function nativeCardSubtext(row) {
  if (!isExternalNativeDevice(row)) return '';
  var meta = nativeRuntimeMetaFromRow(row) || {};
  var entities = Number(meta.last_native_entity_count || 0) || 0;
  if (meta.status === 'online' && meta.last_stream_connected_at) return 'Live stream active' + (entities ? (' • ' + entities + ' entities') : '');
  if ((meta.last_probe && meta.last_probe.reachable) && (/requires encryption/i.test(String(meta.last_stream_error || '')) || meta.encryption_required)) return 'Host reachable • encryption key required' + (entities ? (' • fallback entities ' + entities) : '');
  if (meta.last_probe && meta.last_probe.reachable) return 'Probe OK' + (entities ? (' • fallback entities ' + entities) : '');
  if (entities) return 'Fallback discovery loaded ' + entities + ' entities';
  return '';
}

function integrationPill(row) {
  var key = String((row && row.integration_key) || 'esphome').trim().toLowerCase();
  return summaryPill('Adapter: ' + (key || 'unknown'), '#1d8cff', 'rgba(29,140,255,.20)');
}

function ownershipPill(row) {
  var mode = String((row && row.ownership_mode) || 'managed_internal').toLowerCase();
  var readOnly = Number((row && row.read_only) || 0) === 1;
  if (mode === 'external_native') return summaryPill(readOnly ? 'External native · read-only' : 'External native', '#1d8cff', 'rgba(29,140,255,.28)');
  if (mode === 'external_readonly' || readOnly) return summaryPill('External read-only', '#f59e0b', 'rgba(245,158,11,.28)');
  return summaryPill('ELARIS managed', '#22d97a', 'rgba(34,217,122,.28)');
}

function configSourcePill(row) {
  var src = String((row && row.config_source) || '').toLowerCase();
  if (src === 'use_my_yaml_overlay') return summaryPill('Use My YAML overlay', '#22d97a', 'rgba(34,217,122,.20)');
  if (src === 'ota_managed_edit') return summaryPill('Managed OTA edit', '#1d8cff', 'rgba(29,140,255,.20)');
  if (src === 'external_yaml') return summaryPill('External YAML', '#f59e0b', 'rgba(245,158,11,.28)');
  if (src === 'native_api') return summaryPill('Native API', '#1d8cff', 'rgba(29,140,255,.28)');
  if (src === 'saved_config') return summaryPill('Saved config', 'var(--text)', 'var(--line)');
  return summaryPill('Board profile', '#1d8cff', 'rgba(29,140,255,.28)');
}

function statusChip(status, row) {
  var s = String(status || '').toLowerCase();
  if (s === 'online') {
    var stale = installerDeviceIsStale(row);
    return stale
      ? '<span class="pill" style="color:#f59e0b;border-color:rgba(245,158,11,.35)">Online (quiet)</span>'
      : '<span class="pill pill-ok">Online</span>';
  }
  if (s === 'running' || s === 'queued') return '<span class="pill pill-info">Running</span>';
  if (s === 'error') return '<span class="pill pill-err">Error</span>';
  if (s === 'flashed' && !row.last_seen_at) return '<span class="pill pill-warn">Waiting for first announce</span>';
  if (s === 'flashed') return '<span class="pill pill-info">Flashed</span>';
  return '<span class="pill">' + escHtml(status || 'new') + '</span>';
}


function formatInstallerSeenText(row) {
  if (!row) return 'No activity yet';
  var status = String(row.status || '').toLowerCase();
  if (status === 'running') return 'Flash job running…';
  if (row.last_seen_at) {
    var label = (status === 'online' && !installerDeviceIsStale(row)) ? 'Online since' : 'Last seen';
    return label + ' ' + String(row.last_seen_at).replace('T',' ').slice(0,19);
  }
  if (row.updated_at) return 'Updated ' + String(row.updated_at).replace('T',' ').slice(0,19);
  return 'Waiting for MQTT/config announce';
}

function showSelectedCardBanner(d) {
  var el = document.getElementById('selectedCardBanner');
  if (!el) return;
  if (!d) { el.style.display = 'none'; el.innerHTML = ''; renderEspModeBanner(); return; }
  el.style.display = '';
  el.innerHTML = '<strong>Reflash target:</strong> ' + escHtml(d.friendly_name || d.name || ('Device #' + d.id))
    + ' &nbsp;•&nbsp; ' + escHtml(d.board_profile_id || '—')
    + ((d.ip_address || d.target_ip) ? ' &nbsp;•&nbsp; ' + escHtml(d.ip_address || d.target_ip) : '')
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + integrationPill(d) + ownershipPill(d) + configSourcePill(d) + '</div>'
    + '<div style="margin-top:6px;font-size:11px">This wizard overwrites the generated YAML/config for the selected card. In this patch, the selected card is treated as the managed internal device path.</div>';
  renderEspModeBanner();
}

function clearSelectedInstallerDevice() {
  try { window.selectedInstallerDeviceId = null; } catch (e) {}
  showSelectedCardBanner(null);
  updateBoardSelectionUX();
  renderEspModeBanner();
}

function optimisticUpdateInstallerDevice(payload, jobId) {
  var id = Number(payload && payload.existing_device_id || 0);
  if (!id || !Array.isArray(installerDevicesRaw)) return;
  var now = new Date().toISOString();
  installerDevicesRaw = installerDevicesRaw.map(function(row) {
    if (Number(row.id) !== id) return row;
    return Object.assign({}, row, {
      name: payload.device_name || row.name,
      friendly_name: payload.device_name || row.friendly_name || row.name,
      hostname: (payload.device_name || row.hostname || row.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      board_profile_id: payload.board_profile_id || row.board_profile_id,
      target_ip: payload.port && /^\/dev\//.test(payload.port) ? row.target_ip : (payload.port || row.target_ip),
      ip_address: payload.port && /^\/dev\//.test(payload.port) ? row.ip_address : (payload.port || row.ip_address),
      serial_port: payload.port && /^\/dev\//.test(payload.port) ? payload.port : row.serial_port,
      target_port: payload.port && /^\/dev\//.test(payload.port) ? payload.port : row.target_port,
      status: 'running',
      updated_at: now,
      job_status: 'running',
      integration_key: payload.integration_key || row.integration_key || 'esphome',
      ownership_mode: payload.ownership_mode || row.ownership_mode || 'managed_internal',
      config_source: payload.config_source || row.config_source || 'board_profile',
      read_only: Number(payload.read_only != null ? payload.read_only : (row.read_only || 0)),
      _flashJobId: jobId || row._flashJobId || null
    });
  });
  installerDevices = mergeInstallerDeviceRows(installerDevicesRaw);
  renderSavedPanel();
}

async function forgetInstallerDevice(id) {
  if (!id) return;
  var ok = confirm('Delete this ESPHome card from the registry? This forgets the card, generated YAML history and install jobs for that card.');
  if (!ok) return;
  try {
    await api('/esphome/devices/' + encodeURIComponent(id), { method: 'DELETE' });
    if (Number(window.selectedInstallerDeviceId || 0) === Number(id)) {
      window.selectedInstallerDeviceId = null;
      showSelectedCardBanner(null);
    }
    await loadInstallerDevices();
    renderEspModeBanner();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}
async function loadInstallerDevices() {
  try {
    var r = await api('/esphome/devices');
    if (r && r.runtime) {
      var onlineMin = Number(r.runtime.online_stale_minutes);
      var defaultMin = Number(r.runtime.default_stale_minutes);
      if (Number.isFinite(onlineMin) && onlineMin >= 1) INSTALLER_ONLINE_STALE_MS = Math.round(onlineMin * 60 * 1000);
      if (Number.isFinite(defaultMin) && defaultMin >= 1) INSTALLER_DEFAULT_STALE_MS = Math.round(defaultMin * 60 * 1000);
    }
    installerDevicesRaw = r.devices || [];
    installerDevices = mergeInstallerDeviceRows(installerDevicesRaw);
    renderSavedPanel();
    updateBoardSelectionUX();
    renderEspModeBanner();
  } catch {
    installerDevicesRaw = [];
    installerDevices = [];
    renderSavedPanel();
    updateBoardSelectionUX();
    renderEspModeBanner();
  }
}

async function loadSavedConfigs() {
  try {
    var r = await api('/esphome/configs');
    savedConfigs = r.configs || [];
    renderSavedPanel();
    renderEspModeBanner();
  } catch {
    savedConfigs = [];
    renderSavedPanel();
    renderEspModeBanner();
  }
}

function isExternalNativeDevice(row) {
  return String((row && row.ownership_mode) || '').toLowerCase() === 'external_native'
    || String((row && row.config_source) || '').toLowerCase() === 'native_api';
}

function setInstallerNativeStatus(id, html, isError) {
  var card = document.querySelector('[data-installer-device-id="' + Number(id) + '"]');
  if (!card) return;
  var msg = card.querySelector('.native-msg');
  if (!msg) return;
  msg.style.color = isError ? 'var(--danger, #e55)' : 'var(--muted2)';
  msg.innerHTML = html;
}

async function probeInstallerNative(id) {
  var d = installerDevices.find(function(x) { return Number(x.id) === Number(id); });
  if (!d) return;
  try {
    var out = await api('/integrations/esphome/native-probe', { method: 'POST', body: JSON.stringify({ device_id: Number(d.id), device_name: d.name || '', ip_address: d.ip_address || d.target_ip || '', hostname: d.hostname || '' }) });
    await loadInstallerDevices();
    var latency = Number(out && out.probe && out.probe.latency_ms);
    var ok = !!(out && out.reachable);
    var text = ok ? ('Native probe OK' + (Number.isFinite(latency) ? (' · ' + latency + ' ms') : '')) : ('Native probe failed: ' + String(out && out.probe && out.probe.error || 'unknown'));
    setInstallerNativeStatus(id, escHtml(text), !ok);
  } catch (e) {
    setInstallerNativeStatus(id, escHtml('Native probe failed: ' + (e.message || e)), true);
  }
}

function renderSavedPanel() {
  var panel = document.getElementById('savedPanel');
  var deviceList = document.getElementById('deviceList');
  var configWrap = document.getElementById('savedConfigsWrap');
  var list = document.getElementById('savedList');

  if (!installerDevices.length && !savedConfigs.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  if (installerDevices.length) {
    deviceList.innerHTML = installerDevices.map(function(d) {
      var subtitle = [];
      if (d.board_profile_id) subtitle.push(d.board_profile_id);
      if (d.ip_address) subtitle.push(d.ip_address);
      else if (d.target_ip) subtitle.push(d.target_ip);
      if (d.serial_port) subtitle.push(d.serial_port);
      else if (d.target_port) subtitle.push(d.target_port);
      if (d.hostname) subtitle.push(d.hostname);
      var title = d.friendly_name || d.name || ('Device #' + d.id);
      return '<div data-installer-device-id="' + Number(d.id) + '" style="min-width:280px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card)">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
          '<div style="min-width:0">' +
            '<div style="font-weight:800;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(title) + '</div>' +
            '<div style="color:var(--muted);font-size:10px;margin-top:2px">' + escHtml(subtitle.join(' • ') || 'No announce yet') + '</div>' +
          '</div>' +
          statusChip(d.status, d) +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
            '<div style="font-size:10px;color:var(--muted2)">' + escHtml(formatInstallerSeenText(d)) + (d._mergedCount > 1 ? (' • merged ' + d._mergedCount + ' records') : '') + '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
              '<button type="button" class="btn" style="padding:3px 8px;font-size:10px" onclick="loadDeviceRecord(' + Number(d.id) + ')">Use</button>' +
              (isExternalNativeDevice(d) ? '<button type="button" class="btn" style="padding:3px 8px;font-size:10px" onclick="probeInstallerNative(' + Number(d.id) + ')">Probe native</button><button type="button" class="btn" style="padding:3px 8px;font-size:10px" onclick="connectInstallerNative(' + Number(d.id) + ')">Connect</button>' : '') +
              '<button type="button" class="btn" style="padding:3px 8px;font-size:10px" onclick="forgetInstallerDevice(' + Number(d.id) + ')">Delete</button>' +
            '</div>' +
          '</div>' +
          (isExternalNativeDevice(d) ? ('<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' + nativeCardStatusHtml(d) + '<span style="font-size:10px;color:var(--muted2)">' + escHtml(nativeCardSubtext(d)) + '</span></div>') : '') +
          '<div class="native-msg" style="font-size:10px;min-height:14px"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    deviceList.innerHTML = '';
  }

  if (savedConfigs.length) {
    configWrap.style.display = '';
    list.innerHTML = savedConfigs.map(function(c, i) {
      return '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);font-size:12px">' +
        '<span style="font-weight:700">' + escHtml(c.device_name) + '</span>' +
        '<span style="color:var(--muted);font-size:10px">' + escHtml(c.board_profile_id || c.board_id || '') + '</span>' +
        integrationPill(c) + ownershipPill(c) + configSourcePill(c) +
        '<button class="btn" style="padding:2px 8px;font-size:10px" onclick="loadConfig(' + i + ')">Load</button>' +
        '<button class="entity-remove" onclick="deleteConfig(' + i + ')" title="Delete">&#215;</button>' +
      '</div>';
    }).join('');
  } else {
    configWrap.style.display = 'none';
    list.innerHTML = '';
  }
}

function loadDeviceRecord(id) {
  closeEspPanels();
  var d = installerDevices.find(function(x) { return Number(x.id) === Number(id); });
  if (!d) return;
  try {
    window.selectedInstallerDeviceId = Number(d.id) || null;
    localStorage.setItem('elaris_installer_board_profile_id', d.board_profile_id || '');
    localStorage.setItem('elaris_installer_device_name', d.name || d.friendly_name || '');
  } catch(e) {}
  if (d.name) { document.getElementById('deviceName').value = d.name; updateSafeName(); }
  if (d.board_profile_id) {
    var sel = document.getElementById('boardSelect');
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === d.board_profile_id) { sel.selectedIndex = j; break; }
    }
    onBoardChange();
  }
  document.getElementById('useOTA').checked = !d.serial_port && !!(d.ip_address || d.target_ip);
  onFlashModeChange();
  if (d.ip_address || d.target_ip) document.getElementById('otaIp').value = d.ip_address || d.target_ip || '';
  if (d.serial_port || d.target_port) document.getElementById('portSelect').value = d.serial_port || d.target_port || '';
  if (String(d.network_mode || '').toLowerCase() === 'ethernet') {
    document.getElementById('useEthernet').checked = true;
    onNetChange();
  }
  showSelectedCardBanner(d);
  renderEspModeBanner();
  goStep(2);
}

function loadConfig(i) {
  var c = savedConfigs[i];
  if (!c) return;
  try { window.selectedInstallerDeviceId = null; } catch(e) {}
  updateBoardSelectionUX();
  renderEspModeBanner();
  if (c.device_name) { document.getElementById('deviceName').value = c.device_name; updateSafeName(); }
  if (c.board_profile_id || c.board_id) {
    var sel = document.getElementById('boardSelect');
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === (c.board_profile_id || c.board_id)) { sel.selectedIndex = j; break; }
    }
    onBoardChange();
  }
  if (c.wifi_ssid) document.getElementById('wifiSsid').value = c.wifi_ssid;
  if (c.wifi_pass) document.getElementById('wifiPass').value = c.wifi_pass;
  if (c.mqtt_host) document.getElementById('mqttHost').value = c.mqtt_host;
  if (c.use_ethernet) { document.getElementById('useEthernet').checked = true; onNetChange(); }
  goStep(2);
}

async function deleteConfig(i) {
  var c = savedConfigs[i];
  if (!c) return;
  try { await api('/esphome/configs/' + encodeURIComponent(c.device_name), { method: 'DELETE' }); }
  catch {}
  savedConfigs.splice(i, 1);
  renderSavedPanel();
}

async function saveCurrentConfig() {
  try {
    if (!lastValidation || !lastValidation.ok) await buildYamlPreview();
    if (!lastValidation || !lastValidation.ok) throw new Error('Validation failed. Fix the errors before flashing.');
    var payload = buildPayload();
    await api('/esphome/configs', { method: 'POST', body: JSON.stringify(payload) });
    await loadSavedConfigs();
  } catch(e) { alert('Save failed: ' + e.message); }
}


async function connectInstallerNative(id) {
  var d = installerDevices.find(function(x) { return Number(x.id) === Number(id); });
  if (!d) return;
  try {
    var out = await api('/integrations/esphome/native-connect', { method: 'POST', body: JSON.stringify({ device_id: Number(d.id), device_name: d.name || '', ip_address: d.ip_address || d.target_ip || '', hostname: d.hostname || '', board_profile_id: d.board_profile_id || '' }) });
    await loadInstallerDevices();
    var session = out.session || {};
    try { if (typeof window.nativeImportLoadSession === 'function') window.nativeImportLoadSession(session); } catch (_) {}
    var ok = String(session.state || '') !== 'error';
    setInstallerNativeStatus(id, escHtml('Native session ' + String(session.state || 'connected') + ' · entities ' + String(session.entity_count || 0)), !ok);
  } catch (e) {
    setInstallerNativeStatus(id, escHtml('Native connect failed: ' + (e.message || e)), true);
  }
}
