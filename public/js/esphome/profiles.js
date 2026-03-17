var _profileManagerRows = [];
var _profileEditorLoaded = null;

function toggleProfileManager() {
  var panel = document.getElementById('profileManagerPanel');
  var showing = panel.style.display !== 'none';
  if (!showing) closeEspPanels('profileManagerPanel');
  panel.style.display = showing ? 'none' : '';
  if (!showing) { if (!_profileEditorLoaded) newProfileEditor(); profileManagerRefresh(); }
}

async function profileManagerRefresh() {
  var list = document.getElementById('profileManagerList');
  if (list) list.innerHTML = '<div style="font-size:12px;color:var(--muted)">Loading profiles…</div>';
  try {
    var r = await api('/esphome/catalog');
    _profileManagerRows = (r.boards || []).slice();
    renderProfileManagerList();
  } catch (e) {
    if (list) list.innerHTML = '<div style="font-size:12px;color:var(--bad)">Failed: ' + escHtml(e.message) + '</div>';
  }
}

function profileSourceLabel(source) {
  if (source === 'bundled_js_seed') return 'Official';
  if (source === 'yaml_import') return 'YAML Import';
  if (source === 'profile_editor') return 'Custom';
  if (source === 'bundled_override') return 'Override';
  return source || 'Catalog';
}

function renderProfileManagerList() {
  var list = document.getElementById('profileManagerList');
  if (!list) return;
  var q = String((document.getElementById('profileSearch') || {}).value || '').trim().toLowerCase();
  var rows = _profileManagerRows.filter(function(row) {
    if (!q) return true;
    return [row.label, row.id, row.board, row.platform, profileSourceLabel(row.source)]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  });
  if (!rows.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted)">No profiles match.</div>';
    return;
  }
  list.innerHTML = rows.map(function(row) {
    var caps = (row.capabilities || []).filter(function(c) {
      return /^port_|^bus_|^(relay|di|analog|ao|ds18b20|dht|dht11|pulse_counter)$/.test(c.key || c.capability_key || '');
    }).slice(0, 6).map(function(c) {
      var key = c.key || c.capability_key || '';
      return '<span style="display:inline-flex;padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:10px">' + escHtml(key) + ':' + escHtml(c.count != null ? c.count : c.channel_count) + '</span>';
    }).join(' ');
    return '<button class="btn" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px;border-color:' + (_profileEditorLoaded && _profileEditorLoaded.id === row.id ? 'var(--blue)' : 'var(--line)') + '" onclick="loadProfileForEdit(\'' + escHtml(row.id) + '\')">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
      + '<div><div style="font-weight:800">' + escHtml(row.label) + '</div><div style="font-size:11px;color:var(--muted2)">' + escHtml(row.id) + ' · ' + escHtml(row.board || '—') + '</div></div>'
      + '<span style="font-size:10px;padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted2)">' + escHtml(profileSourceLabel(row.source)) + '</span></div>'
      + (caps ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' + caps + '</div>' : '')
      + '</button>';
  }).join('');
}

function newProfileEditor() {
  _profileEditorLoaded = { id: '', source: 'profile_editor' };
  setProfileEditorPayload({
    id: '',
    label: '',
    platform: 'esp32',
    board: 'esp32dev',
    frameworkDefault: 'arduino',
    supports: { usb: true, ota: true, wifi: true, ethernet: false },
    notes: ['Custom board profile'],
    boardPorts: [
      { id: 'DO1', label: 'DO1', group: 'do', pin: 'GPIO26', protocols: ['do'], supports: [], aliases: ['OUT1'], hint: 'Relay output 1.' },
      { id: 'DI1', label: 'DI1', group: 'di', pin: 'GPIO36', protocols: ['gpio', 'di'], supports: ['pulse_counter'], aliases: ['IN1'], hint: 'Digital input 1.' },
      { id: 'HT1', label: 'HT1', group: 'ht', pin: 'GPIO32', protocols: ['onewire', 'gpio'], supports: ['ds18b20', 'dht11', 'dht'], shared_bus: true, multi_instance: true, hint: 'Shared temperature port.' },
    ],
    boardBuses: [
      { id: 'bus_a', label: 'I²C Bus A', protocol: 'i2c', sda: 'GPIO21', scl: 'GPIO22', supports: ['bh1750', 'sht3x'], addresses: ['0x23', '0x5c', '0x44', '0x45'], hint: 'Shared I²C bus.' }
    ],
    pinRules: { reserved: [], inputOnly: [34,35,36,39], noPullup: [34,35,36,39], flashPins: [6,7,8,9,10,11], strapping: [0,2,5,12,15] },
    entityDefaults: [],
  }, { source: 'profile_editor' });
}

async function loadProfileForEdit(id) {
  try {
    var r = await api('/esphome/catalog/export/' + encodeURIComponent(id));
    if (!r.ok || !r.profile) throw new Error(r.error || 'profile_not_found');
    _profileEditorLoaded = { id: r.profile.id, source: r.profile.source || '' };
    setProfileEditorPayload(r.profile.definition || {}, r.profile);
    renderProfileManagerList();
  } catch (e) {
    alert('Cannot load profile: ' + e.message);
  }
}

function setProfileEditorPayload(def, meta) {
  meta = meta || {};
  document.getElementById('peId').value = def.id || '';
  document.getElementById('peLabel').value = def.label || '';
  document.getElementById('peBoard').value = def.board || 'esp32dev';
  document.getElementById('pePlatform').value = def.platform || 'esp32';
  document.getElementById('peFramework').value = def.frameworkDefault || def.framework_default || 'arduino';
  document.getElementById('peSupportsUsb').checked = !(def.supports && def.supports.usb === false);
  document.getElementById('peSupportsOta').checked = !(def.supports && def.supports.ota === false);
  document.getElementById('peSupportsWifi').checked = !(def.supports && def.supports.wifi === false);
  document.getElementById('peSupportsEth').checked = !!(def.supports && def.supports.ethernet);
  document.getElementById('peSource').textContent = profileSourceLabel(meta.source || 'profile_editor');
  document.getElementById('peNotes').value = (def.notes || []).join('\n');
  document.getElementById('peBoardPorts').value = JSON.stringify(def.boardPorts || [], null, 2);
  document.getElementById('peBoardBuses').value = JSON.stringify(def.boardBuses || [], null, 2);
  document.getElementById('peEntityDefaults').value = JSON.stringify(def.entityDefaults || [], null, 2);
  document.getElementById('pePinRules').value = JSON.stringify(def.pinRules || {}, null, 2);
  document.getElementById('peEthernet').value = def.ethernet ? JSON.stringify(def.ethernet, null, 2) : '';
  document.getElementById('pePcf8574').value = def.pcf8574 ? JSON.stringify(def.pcf8574, null, 2) : '';
  document.getElementById('peI2c').value = def.i2c ? JSON.stringify(def.i2c, null, 2) : '';
  document.getElementById('peMsg').textContent = '';
  updateProfileEditorButtons();
}

function updateProfileEditorButtons() {
  var source = (_profileEditorLoaded && _profileEditorLoaded.source) || '';
  var deleteBtn = document.getElementById('peDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = source === 'bundled_js_seed' ? 'none' : '';
}

function cloneProfileEditor() {
  var payload = collectProfileEditorPayload(true);
  if (!payload) return;
  payload.id = (payload.id || 'custom_board') + '_custom';
  payload.label = (payload.label || 'Custom board') + ' Clone';
  _profileEditorLoaded = { id: payload.id, source: 'profile_editor' };
  setProfileEditorPayload(payload, { source: 'profile_editor' });
}

function parseEditorJson(id, fallback) {
  var raw = document.getElementById(id).value.trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function collectProfileEditorPayload(silent) {
  try {
    return {
      id: document.getElementById('peId').value.trim(),
      label: document.getElementById('peLabel').value.trim(),
      board: document.getElementById('peBoard').value.trim(),
      platform: document.getElementById('pePlatform').value.trim(),
      frameworkDefault: document.getElementById('peFramework').value.trim(),
      supports: {
        usb: document.getElementById('peSupportsUsb').checked,
        ota: document.getElementById('peSupportsOta').checked,
        wifi: document.getElementById('peSupportsWifi').checked,
        ethernet: document.getElementById('peSupportsEth').checked,
      },
      notes: document.getElementById('peNotes').value.trim().split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean),
      boardPorts: parseEditorJson('peBoardPorts', []),
      boardBuses: parseEditorJson('peBoardBuses', []),
      entityDefaults: parseEditorJson('peEntityDefaults', []),
      pinRules: parseEditorJson('pePinRules', {}),
      ethernet: parseEditorJson('peEthernet', null),
      pcf8574: parseEditorJson('pePcf8574', []),
      i2c: parseEditorJson('peI2c', null),
    };
  } catch (e) {
    if (!silent) document.getElementById('peMsg').textContent = 'JSON error: ' + e.message;
    return null;
  }
}

async function saveProfileEditor() {
  var payload = collectProfileEditorPayload();
  if (!payload) return;
  if (!payload.id || !payload.label) {
    document.getElementById('peMsg').textContent = 'ID and Label are required.';
    return;
  }
  document.getElementById('peMsg').textContent = 'Saving…';
  try {
    var allowOverride = !!(_profileEditorLoaded && _profileEditorLoaded.source === 'bundled_override');
    var r = await api('/esphome/catalog/save-profile', {
      method: 'POST',
      body: JSON.stringify({ profile: payload, allow_override: allowOverride })
    });
    if (!r.ok) throw new Error(r.hint ? (r.error + ' — ' + r.hint) : r.error);
    document.getElementById('peMsg').textContent = 'Saved ' + r.label;
    await checkSetup();
    await profileManagerRefresh();
    await loadProfileForEdit(r.id);
  } catch (e) {
    document.getElementById('peMsg').textContent = 'Error: ' + e.message;
  }
}

async function deleteProfileEditor() {
  var id = document.getElementById('peId').value.trim();
  if (!id) return;
  if (!confirm('Delete board profile "' + id + '"?')) return;
  document.getElementById('peMsg').textContent = 'Deleting…';
  try {
    var r = await api('/esphome/catalog/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) throw new Error(r.error || 'delete_failed');
    document.getElementById('peMsg').textContent = 'Deleted.';
    newProfileEditor();
    await checkSetup();
    await profileManagerRefresh();
  } catch (e) {
    document.getElementById('peMsg').textContent = 'Error: ' + e.message;
  }
}

function exportProfileEditor() {
  var payload = collectProfileEditorPayload();
  if (!payload) return;
  var source = (_profileEditorLoaded && _profileEditorLoaded.source) || 'profile_editor';
  var blob = new Blob([JSON.stringify({
    id: payload.id,
    label: payload.label,
    platform: payload.platform,
    board: payload.board,
    framework_default: payload.frameworkDefault,
    source: source,
    notes: payload.notes,
    definition: payload,
  }, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (payload.id || 'board_profile') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
