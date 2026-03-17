// ── Use my YAML flow ─────────────────────────────────────────────────────
var _umyCurrentYaml = '';
var _umyAddedPeripherals = [];

function toggleUseMyYaml() {
  var p = document.getElementById('useMyYamlPanel');
  if (p.style.display === 'none') {
    closeEspPanels('useMyYamlPanel');
    p.style.display = '';
    _umyCurrentYaml = '';
    _umyAddedPeripherals = [];
    document.getElementById('umyYamlText').value = '';
    document.getElementById('umyParseMsg').textContent = '';
    document.getElementById('umyPreview').style.display = 'none';
    document.getElementById('umyStep2').style.display = 'none';
    document.getElementById('umyStep3').style.display = 'none';
    document.getElementById('umyStep4').style.display = 'none';
    document.getElementById('umyTerminal').style.display = 'none';
  } else {
    p.style.display = 'none';
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
    document.getElementById('umyDeviceName').value = (r.parsed.id || r.parsed.label || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'my-device';
    document.getElementById('umyParseMsg').textContent = 'Parsed. You can add peripherals below or go to Step 3.';
  } catch(e) {
    document.getElementById('umyParseMsg').textContent = 'Error: ' + e.message;
  }
}

async function umyAddPeripheral() {
  if (!_umyCurrentYaml) { alert('Parse YAML first.'); return; }
  var type = document.getElementById('umyAddType').value;
  var pin = document.getElementById('umyAddPin').value.trim();
  var name = document.getElementById('umyAddName').value.trim() || type;
  var key = document.getElementById('umyAddKey').value.trim().replace(/[^a-z0-9_]/g, '_') || name.toLowerCase().replace(/\s+/g, '_');
  var isI2c = typeof apIsI2cType === 'function' && apIsI2cType(type);
  if (!isI2c && !pin) { alert('Enter pin (e.g. GPIO32).'); return; }
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
  if (!_umyCurrentYaml) { alert('Parse YAML first.'); return; }
  var device_name = document.getElementById('umyDeviceName').value.trim();
  var wifi_ssid = document.getElementById('umyWifiSsid').value.trim();
  var wifi_pass = document.getElementById('umyWifiPass').value;
  var mqtt_host = document.getElementById('umyMqttHost').value.trim();
  var port = document.getElementById('umyPort').value.trim();
  if (!device_name) { alert('Enter device name.'); return; }
  if (!port) { alert('Enter USB port or OTA IP.'); return; }
  document.getElementById('umyFlashBtn').disabled = true;
  document.getElementById('umyFlashMsg').textContent = 'Flashing…';
  document.getElementById('umyTerminal').style.display = 'block';
  document.getElementById('umyTerminal').innerHTML = '<span class="tl-info">Starting flash…</span>\n';
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
        client_id: window.__elarisWsClientId || null,
      }),
    });
    if (!r.ok) throw new Error(r.error);
    document.getElementById('umyFlashMsg').textContent = 'Flash started. Watch the log below.';
  } catch(e) {
    document.getElementById('umyFlashBtn').disabled = false;
    document.getElementById('umyFlashMsg').textContent = 'Error: ' + e.message;
    document.getElementById('umyTerminal').innerHTML += '<span class="tl-error">' + escHtml(e.message) + '</span>\n';
  }
}

function onEsphomeDoneFromUseMyYaml(ok, code) {
  document.getElementById('umyFlashBtn').disabled = false;
  document.getElementById('umyFlashMsg').textContent = ok ? 'Flash complete. Device will appear in Installer.' : 'Flash failed (exit ' + code + ').';
}
