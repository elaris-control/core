// ── Use my YAML flow ─────────────────────────────────────────────────────
var _umyCurrentYaml = '';
var _umyAddedPeripherals = [];

function umyError(msg) {
  var term = document.getElementById('umyTerminal');
  if (term) {
    term.style.display = 'block';
    term.innerHTML += '<span class="tl-error">' + escHtml(msg) + '</span>\n';
  }
  alert(msg);
}

function umySelectedInstallerCard() {
  try {
    var id = Number((typeof window !== 'undefined' && window.selectedInstallerDeviceId) || 0);
    if (!id || !Array.isArray(installerDevices)) return null;
    return installerDevices.find(function(d) { return Number(d.id) === id; }) || null;
  } catch (e) {
    return null;
  }
}

function umyDetectNetwork(yamlText) {
  var text = String(yamlText || '');
  return {
    hasWifi: /^wifi:\s*(?:$|\n)/mi.test(text),
    hasEthernet: /^ethernet:\s*(?:$|\n)/mi.test(text),
  };
}

function umyApplyContextDefaults() {
  var card = umySelectedInstallerCard();
  if (!card) return;
  var nameEl = document.getElementById('umyDeviceName');
  var portEl = document.getElementById('umyPort');
  var ssidEl = document.getElementById('umyWifiSsid');
  var passEl = document.getElementById('umyWifiPass');
  if (nameEl && !nameEl.value.trim()) nameEl.value = card.name || card.friendly_name || '';
  if (portEl && !portEl.value.trim()) portEl.value = card.ip_address || card.target_ip || card.serial_port || card.target_port || '';
  if (card.network_mode === 'ethernet') {
    if (ssidEl) ssidEl.disabled = true;
    if (passEl) passEl.disabled = true;
  }
}

function umySetFlashButton(mode) {
  var btn = document.getElementById('umyFlashBtn');
  if (!btn) return;
  if (mode === 'running') {
    btn.innerHTML = '&#9203; Flashing…';
    btn.disabled = true;
    btn.onclick = function(){};
  } else if (mode === 'done') {
    btn.innerHTML = '&#10003; Open Installer';
    btn.disabled = false;
    btn.onclick = function() { try { location.href = (typeof installerContextUrl === 'function') ? installerContextUrl() : '/installer.html'; } catch(e) { location.href = '/installer.html'; } };
  } else if (mode === 'retry') {
    btn.innerHTML = '&#9889; Flash Again';
    btn.disabled = false;
    btn.onclick = umyFlash;
  } else {
    btn.innerHTML = '&#9889; Flash';
    btn.disabled = false;
    btn.onclick = umyFlash;
  }
}


async function umyRefreshPorts() {
  var sel = document.getElementById('umyPortSelect');
  if (!sel) return;
  try {
    var r = await api('/esphome/ports', {});
    var ports = r.ports || [];
    sel.innerHTML = '<option value="">— select USB port —</option>' +
      ports.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');
    if (ports.length === 1) {
      sel.value = ports[0];
      document.getElementById('umyPort').value = ports[0];
    }
  } catch(e) {
    sel.innerHTML = '<option value="">Could not scan ports</option>';
  }
}

function toggleUseMyYaml() {
  var p = document.getElementById('useMyYamlPanel');
  if (p.style.display === 'none') {
    closeEspPanels('useMyYamlPanel');
    umyRefreshPorts();
    // Hide wizard steps so they don't show alongside the UMY panel
    for (var i = 1; i <= 5; i++) {
      var s = document.getElementById('step' + i);
      if (s) s.style.display = 'none';
    }
    p.style.display = '';
    _umyCurrentYaml = '';
    _umyAddedPeripherals = [];
    umySetFlashButton('idle');
    document.getElementById('umyYamlText').value = '';
    document.getElementById('umyParseMsg').textContent = '';
    document.getElementById('umyPreview').style.display = 'none';
    document.getElementById('umyStep2').style.display = 'none';
    document.getElementById('umyStep3').style.display = 'none';
    document.getElementById('umyStep4').style.display = 'none';
    document.getElementById('umyTerminal').style.display = 'none';
    umyApplyContextDefaults();
  } else {
    p.style.display = 'none';
    // Reset flow chooser to wizard state
    var _fw = document.getElementById('flowBtnWizard'); if (_fw) _fw.className = 'btn btnPrimary';
    var _fy = document.getElementById('flowBtnYaml'); if (_fy) _fy.className = 'btn';
    var _fe = document.getElementById('flowBtnExternal'); if (_fe) _fe.className = 'btn';
    var _stp = document.getElementById('stepper'); if (_stp) _stp.style.display = '';
    // Restore the current wizard step
    if (typeof currentStep !== 'undefined') {
      var cur = document.getElementById('step' + currentStep);
      if (cur) cur.style.display = '';
    }
  }
}

async function umyParse() {
  var text = document.getElementById('umyYamlText').value.trim();
  if (!text) { document.getElementById('umyParseMsg').textContent = 'Paste YAML first.'; return; }
  document.getElementById('umyParseMsg').textContent = 'Parsing…';
  try {
    var r = await api('/esphome/catalog/parse-yaml', { method: 'POST', body: JSON.stringify({ yaml: text }) });
    if (!r.ok) throw new Error(r.error);
    _umyCurrentYaml = text;
    _umyAddedPeripherals = [];
    document.getElementById('umyParsedName').textContent = (r.parsed.label || r.parsed.id || 'device');
    document.getElementById('umyParsedEntities').textContent = (r.parsed.entityDefaults || []).length;
    document.getElementById('umyPreview').style.display = 'block';
    document.getElementById('umyStep2').style.display = 'block';
    document.getElementById('umyStep3').style.display = 'block';
    document.getElementById('umyStep4').style.display = 'block';
    var parsedName = (r.parsed.id || r.parsed.label || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'my-device';
    var card = umySelectedInstallerCard();
    document.getElementById('umyDeviceName').value = (card && (card.name || card.friendly_name)) || parsedName;
    var net = umyDetectNetwork(text);
    var hasEncryption = /^\s*api\s*:/m.test(text) && /encryption\s*:/m.test(text);
    var baseMsg = '';
    if (net.hasWifi && net.hasEthernet) baseMsg = 'Parsed, but this YAML contains both WiFi and Ethernet. Keep only one before flashing.';
    else if (net.hasEthernet) baseMsg = 'Parsed. Ethernet YAML detected — ELARIS will ignore WiFi, inject its managed MQTT announce overlay, and keep this device in the internal managed path.';
    else if (net.hasWifi) baseMsg = 'Parsed. ELARIS will keep WiFi, inject its managed MQTT announce overlay, and keep this device in the internal managed path.';
    else baseMsg = 'Parsed. ELARIS will inject its managed MQTT announce overlay before flashing and keep this device in the internal managed path.';
    var encMsg = hasEncryption ? ' ⚠ This YAML has native API encryption enabled. To connect via native API (from ELARIS or any other tool) you will need the encryption key. To allow keyless local access, keep api: but remove only the encryption: block beneath it — do not delete the api: line itself.' : '';
    document.getElementById('umyParseMsg').textContent = baseMsg + encMsg;
    umyApplyContextDefaults();
  } catch(e) {
    document.getElementById('umyParseMsg').textContent = 'Error: ' + e.message;
  }
}

async function umyAddPeripheral() {
  if (!_umyCurrentYaml) { umyError('Parse YAML first.'); return; }
  var type = document.getElementById('umyAddType').value;
  var pin = document.getElementById('umyAddPin').value.trim();
  var name = document.getElementById('umyAddName').value.trim() || type;
  var key = document.getElementById('umyAddKey').value.trim().replace(/[^a-z0-9_]/g, '_') || name.toLowerCase().replace(/\s+/g, '_');
  var isI2c = typeof apIsI2cType === 'function' && apIsI2cType(type);
  if (!isI2c && !pin) { umyError('Enter pin (e.g. GPIO32).'); return; }
  document.getElementById('umyFlashMsg').textContent = 'Adding…';
  try {
    var r = await api('/esphome/add-peripheral-to-draft', {
      method: 'POST',
      body: JSON.stringify({ yaml_text: _umyCurrentYaml, entity: { type: type, pin: pin, name: name, key: key } }),
    });
    if (!r.ok) throw new Error(r.error);
    _umyCurrentYaml = r.yaml;
    _umyAddedPeripherals.push({ type: type, name: name, key: key });
    var listEl = document.getElementById('umyAddedList');
    listEl.innerHTML = _umyAddedPeripherals.map(function(p) { return '<span class="pill-info" style="margin-right:6px">' + escHtml(p.type) + ': ' + escHtml(p.name) + '</span>'; }).join('');
    document.getElementById('umyFlashMsg').textContent = 'Added. You can add more or go to Step 3 and Flash.';
  } catch(e) {
    document.getElementById('umyFlashMsg').textContent = 'Error: ' + e.message;
  }
}

async function umyFlash() {
  if (!_umyCurrentYaml) { umyError('Parse YAML first.'); return; }
  var device_name = document.getElementById('umyDeviceName').value.trim();
  var wifi_ssid = document.getElementById('umyWifiSsid').value.trim();
  var wifi_pass = document.getElementById('umyWifiPass').value;
  var mqtt_host = document.getElementById('umyMqttHost').value.trim();
  var port = document.getElementById('umyPort').value.trim();
  if (!device_name) { umyError('Enter device name.'); return; }
  if (!port) { umyError('Enter USB port or OTA IP.'); return; }
  var net = umyDetectNetwork(_umyCurrentYaml);
  if (net.hasWifi && net.hasEthernet) { umyError('This YAML contains both WiFi and Ethernet. Keep only one before flashing.'); return; }
  var selectedCard = umySelectedInstallerCard();
  var usingUsb = /^\/dev\//.test(port);
  var transportLabel = usingUsb ? 'USB flash' : 'OTA flash';
  umySetFlashButton('running');
  document.getElementById('umyFlashMsg').textContent = transportLabel + ' started…';
  document.getElementById('umyTerminal').style.display = 'block';
  document.getElementById('umyTerminal').innerHTML = '<span class="tl-info">Starting ' + escHtml(transportLabel) + '…</span>\n';
  if (!usingUsb) document.getElementById('umyTerminal').innerHTML += '<span class="tl-warn">OTA is best for devices already flashed with ESPHome.</span>\n';
  else document.getElementById('umyTerminal').innerHTML += '<span class="tl-info">USB is the safest path for first flash and recovery.</span>\n';
  if (selectedCard) document.getElementById('umyTerminal').innerHTML += '<span class="tl-info">Target card: ' + escHtml(selectedCard.friendly_name || selectedCard.name || ('Device #' + selectedCard.id)) + '</span>\n';
  try {
    var r = await api('/esphome/flash-from-yaml', {
      method: 'POST',
      body: JSON.stringify({
        yaml_text: _umyCurrentYaml,
        device_name: device_name,
        wifi_ssid: wifi_ssid,
        wifi_pass: wifi_pass,
        mqtt_host: mqtt_host,
        port: port,
        client_id: (typeof esphomeClientId !== 'undefined' ? esphomeClientId : null) || window.__elarisWsClientId || null,
        existing_device_id: (umySelectedInstallerCard() || {}).id || null,
        board_profile_id: (umySelectedInstallerCard() || {}).board_profile_id || ((document.getElementById('boardSelect') || {}).value || null),
        integration_key: 'esphome',
        ownership_mode: 'managed_internal',
        config_source: 'use_my_yaml_overlay',
        read_only: 0,
      }),
    });
    if (!r.ok) throw new Error(r.error);
    document.getElementById('umyFlashMsg').textContent = 'Flash started. Watch the log below.';
  } catch(e) {
    umySetFlashButton('retry');
    var msg = String(e && e.message || e || 'Unknown error');
    if (/esphome_not_installed/i.test(msg)) msg = 'ESPHome is not installed yet. Install ESPHome first, then retry.';
    else if (/flash_in_progress/i.test(msg)) msg = 'Another ESPHome flash is already running. Wait for it to finish or cancel it first.';
    else if (/port_or_ip_required|missing_target_port_or_ip/i.test(msg)) msg = 'Select a USB port for first flash, or enter a device IP for OTA reflash.';
    else if (/validation_failed/i.test(msg)) msg = 'Validation failed. Review the generated YAML/validation output before flashing.';
    document.getElementById('umyFlashMsg').textContent = 'Error: ' + msg;
    document.getElementById('umyTerminal').innerHTML += '<span class="tl-error">' + escHtml(msg) + '</span>\n';
  }
}

function onEsphomeDoneFromUseMyYaml(ok, code) {
  umySetFlashButton(ok ? 'done' : 'retry');
  document.getElementById('umyFlashMsg').textContent = ok ? 'Flash complete. Open Installer to continue with the managed internal device card.' : 'Flash failed (exit ' + code + ').';
}
