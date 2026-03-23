// ── Add Peripheral to Existing Device ─────────────────────────────────────
var _apFlashing = false;
var _apPreviewYaml = null;
var _apPinOptions = null;
var _apYamlContent = null;   // pasted YAML for devices without yaml_path on server
var _apBoardPorts = [];
var _apBusOptions = [];
var _apMode = 'add';
var _apEditOriginalKey = '';
var _apPeripherals = [];

var AP_LIBRARY = [
  { id: 'ds18b20', name: 'DS18B20 Temperature (1-Wire)', protocol: 'gpio', uiCategory: 'Sensor Ports / 1-Wire' },
  { id: 'dht11', name: 'DHT11 Temp + Humidity', protocol: 'gpio', uiCategory: 'Sensor Ports / 1-Wire' },
  { id: 'dht', name: 'DHT22 Temp + Humidity', protocol: 'gpio', uiCategory: 'Sensor Ports / 1-Wire' },
  { id: 'analog', name: 'Analog Input (ADC)', protocol: 'gpio', uiCategory: 'Analog Inputs (AI)' },
  { id: 'soil_moisture', name: 'Soil Moisture (capacitive)', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'ntc', name: 'NTC Thermistor (analog)', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'mq2', name: 'MQ-2 Smoke / LPG / CO', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'mq7', name: 'MQ-7 Carbon Monoxide (CO)', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'mq135', name: 'MQ-135 Air Quality', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'ct_clamp', name: 'CT Clamp Non-Invasive AC Current', protocol: 'gpio', baseType: 'analog', uiCategory: 'Analog Inputs (AI)' },
  { id: 'pulse_counter', name: 'Pulse Counter (flow / anemometer)', protocol: 'gpio', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'anemometer', name: 'Wind Speed (WH-SP-WS01)', protocol: 'gpio', baseType: 'pulse_counter', scale: 'anemometer', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'yfs201', name: 'YF-S201 Water Flow Meter', protocol: 'gpio', baseType: 'pulse_counter', scale: 'yfs201', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'rain_digital', name: 'Rain Sensor (digital)', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'pir', name: 'PIR Motion Sensor', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'door_contact', name: 'Door / Window Contact', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'vibration', name: 'Vibration Sensor (SW-420)', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'water_leak', name: 'Water Leak Sensor (digital)', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'float_switch', name: 'Float Switch (Tank Full/Empty)', protocol: 'gpio', baseType: 'di', uiCategory: 'Digital / GPIO Inputs' },
  { id: 'bh1750', name: 'BH1750 Lux Sensor (I²C)', protocol: 'i2c', addresses: ['0x23', '0x5C'], uiCategory: 'I²C Bus Devices' },
  { id: 'sht3x', name: 'SHT3x Temp + Humidity (I²C)', protocol: 'i2c', addresses: ['0x44', '0x45'], uiCategory: 'I²C Bus Devices' },
];

function apGetTypeSpec(type) {
  return AP_LIBRARY.find(function(x) { return x.id === String(type || '').trim().toLowerCase(); }) || AP_LIBRARY[0];
}

function apBaseType(type) {
  var spec = apGetTypeSpec(type);
  return String((spec && spec.baseType) || (spec && spec.id) || type || '').trim().toLowerCase();
}

function apIsI2cType(type) {
  return apGetTypeSpec(type).protocol === 'i2c';
}

function apCategoryLabelForType(type) {
  var spec = apGetTypeSpec(type);
  return spec && spec.uiCategory ? spec.uiCategory : 'Peripheral Types';
}

function apHintTextForType(type) {
  var base = apBaseType(type);
  if (apIsI2cType(type)) return 'This peripheral belongs on an I²C bus. Pick a board bus and a free address.';
  if (base === 'analog') return 'This peripheral should go on AI / ADC-capable inputs, not relay/output GPIOs.';
  if (base === 'ds18b20' || base === 'dht' || base === 'dht11') return 'Use HT / sensor ports when the board profile provides them. ELARIS resolves the real GPIO.';
  if (base === 'di' || base === 'pulse_counter') return 'Use DI / GPIO input ports. Dry contacts, pulse sensors and motion sensors belong here.';
  return 'Choose a compatible board port for this peripheral.';
}

function apTitleFromGroup(group) {
  var g = String(group || '').toLowerCase();
  if (g === 'ht' || g === 'onewire') return 'Sensor Ports / 1-Wire';
  if (g === 'ai') return 'Analog Inputs (AI)';
  if (g === 'di') return 'Digital Inputs';
  if (g === 'do') return 'Digital Outputs';
  if (g === 'gpio') return 'Generic GPIO';
  if (g === 'i2c') return 'I²C Buses';
  if (g === 'rs485') return 'RS485';
  return 'Board Ports';
}

function apCurrentPorts() {
  return Array.isArray(_apBoardPorts) ? _apBoardPorts.slice() : [];
}

function apCurrentBuses() {
  return Array.isArray(_apBusOptions) ? _apBusOptions.slice() : [];
}

function apPortSupportsType(port, type) {
  var want = apBaseType(type);
  var supports = Array.isArray(port && port.supports) ? port.supports : [];
  return supports.indexOf(want) >= 0;
}

function apBusSupportsType(bus, type) {
  var want = apBaseType(type);
  var supports = Array.isArray(bus && bus.supports) ? bus.supports : [];
  return supports.indexOf(want) >= 0 || supports.length === 0;
}

function apPortCanReplaceUsage(port, type) {
  if (!port || !port.inUse || !port.replaceable) return false;
  var want = apBaseType(type);
  var allowed = Array.isArray(port.replaceableTypes) ? port.replaceableTypes : [];
  return allowed.indexOf(want) >= 0;
}

function apPortHasBlockingUsage(port, type) {
  if (!port || !port.inUse) return false;
  var want = apBaseType(type);
  if (want === 'ds18b20' && port.sharedBus) return false;
  if (apPortCanReplaceUsage(port, type)) return false;
  return true;
}

function apPickSuggestedPort(type) {
  var ports = apCompatiblePorts(type);
  return ports.find(function(port){ return !apPortHasBlockingUsage(port, type); }) || ports[0] || null;
}

function apPickSuggestedBus(type) {
  var buses = apCompatibleBuses(type);
  return buses[0] || null;
}

function apPickSuggestedAddress(type, bus) {
  var spec = apGetTypeSpec(type);
  var used = Array.isArray(bus && bus.usedAddresses) ? bus.usedAddresses.map(function(x){ return String(x || '').toLowerCase(); }) : [];
  var addresses = Array.isArray(spec.addresses) ? spec.addresses : [];
  return addresses.find(function(addr){ return used.indexOf(String(addr).toLowerCase()) < 0; }) || addresses[0] || '';
}

function apCompatiblePorts(type) {
  return apCurrentPorts().filter(function(port) { return apPortSupportsType(port, type); });
}

function apCompatibleBuses(type) {
  return apCurrentBuses().filter(function(bus) { return apBusSupportsType(bus, type); });
}

function apHasLogicalPorts(type) {
  return apCompatiblePorts(type).some(function(port) { return !!port.portId; });
}

function apSelectedPort() {
  var sel = document.getElementById('apPinDropdown');
  if (!sel) return null;
  var val = String(sel.value || '').trim();
  if (!val) return null;
  return apCurrentPorts().find(function(port) { return String(port.portId || port.value || '').trim() === val; }) || null;
}

function apSelectedBus() {
  var sel = document.getElementById('apBusSelect');
  if (!sel || sel.style.display === 'none') return null;
  var val = String(sel.value || '').trim();
  if (!val) return null;
  return apCurrentBuses().find(function(bus) { return String(bus.id || '').trim() === val; }) || null;
}

function apLibraryForCurrentDevice() {
  var ports = apCurrentPorts();
  var buses = apCurrentBuses();
  if (!ports.length && !buses.length && !_apPinOptions) return AP_LIBRARY.slice();
  return AP_LIBRARY.filter(function(item) {
    if (item.protocol === 'i2c') return apCompatibleBuses(item.id).length > 0 || (!!(_apPinOptions && _apPinOptions.defaultI2c));
    return apCompatiblePorts(item.id).length > 0 || ports.some(function(port) {
      return !port.portId && Array.isArray(port.supports) && port.supports.indexOf(apBaseType(item.id)) >= 0;
    });
  });
}

function apSetMode(mode, peripheral) {
  _apMode = mode === 'edit' ? 'edit' : 'add';
  _apEditOriginalKey = _apMode === 'edit' && peripheral ? String(peripheral.key || '').trim() : '';
  var banner = document.getElementById('apEditBanner');
  var textEl = document.getElementById('apEditText');
  if (banner) banner.style.display = _apMode === 'edit' ? '' : 'none';
  if (textEl && peripheral) textEl.textContent = 'Editing ' + (peripheral.name || peripheral.key || 'peripheral') + ' (' + (peripheral.type || '') + ')';
  renderEspModeBanner();
  var previewBtn = document.getElementById('apPreviewBtn');
  if (previewBtn) previewBtn.innerHTML = _apMode === 'edit' ? '&#128196; Preview Update' : '&#128196; Preview YAML';
  apClearPreview();
}

function apCancelEdit() {
  apSetMode('add');
  document.getElementById('apType').disabled = false;
  document.getElementById('apName').value = '';
  document.getElementById('apKey').value = '';
  document.getElementById('apPin').value = '';
  document.getElementById('apAddress').value = '';
  document.getElementById('apSda').value = '';
  document.getElementById('apScl').value = '';
  document.getElementById('apPinDropdown').value = '';
  document.getElementById('apBusSelect').value = '';
  document.getElementById('apScale').value = 'none';
  document.getElementById('apScaleFactor').value = '1';
  apLoadPinOptions();
}

async function apLoadPeripherals() {
  var deviceId = Number(document.getElementById('apDeviceSelect').value);
  var wrap = document.getElementById('apCurrentWrap');
  var list = document.getElementById('apCurrentList');
  if (!wrap || !list) return;
  if (!deviceId) { wrap.style.display = 'none'; list.innerHTML = ''; _apPeripherals = []; return; }
  try {
    var r = await api('/esphome/device/' + deviceId + '/peripherals');
    _apPeripherals = Array.isArray(r.peripherals) ? r.peripherals : [];
  } catch (e) {
    _apPeripherals = [];
  }
  apRenderPeripherals();
}

function apPeripheralSummary(p) {
  var bits = [];
  if (p.port_id) bits.push(p.port_id);
  if (p.bus_id) bits.push(p.bus_id);
  if (p.pin) bits.push(p.pin);
  if (p.address) bits.push(p.address);
  if (p.bus_ref) bits.push(p.bus_ref);
  return bits.join(' • ');
}

function apRenderPeripherals() {
  var wrap = document.getElementById('apCurrentWrap');
  var list = document.getElementById('apCurrentList');
  if (!wrap || !list) return;
  if (!_apPeripherals.length) { wrap.style.display = ''; list.innerHTML = '<div style="padding:10px 12px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:12px">No managed peripherals found in this device YAML yet.</div>'; return; }
  wrap.style.display = '';
  list.innerHTML = _apPeripherals.map(function(p, i) {
    return '<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);display:flex;flex-direction:column;gap:8px">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
        '<div style="min-width:0"><div style="font-size:12px;font-weight:800">' + escHtml(p.name || p.key || 'Peripheral') + '</div><div style="font-size:10px;color:var(--muted);margin-top:2px">' + escHtml((p.type || '') + ' • ' + (p.key || '')) + '</div></div>' +
        '<span class="pill" style="font-size:10px">' + escHtml((p.type || '').toUpperCase()) + '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--muted2)">' + escHtml(apPeripheralSummary(p) || 'No pin/bus metadata') + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button type="button" class="btn" style="padding:4px 8px;font-size:11px" onclick="apEditPeripheral(' + i + ')">&#9998; Edit / Reassign</button>' +
        '<button type="button" class="btn" style="padding:4px 8px;font-size:11px;border-color:rgba(255,92,122,.35);color:#ff8da3" onclick="apRemovePeripheral(' + i + ')">&#128465; Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function apEditPeripheral(i) {
  var p = _apPeripherals[i];
  if (!p) return;
  apSetMode('edit', p);
  document.getElementById('apType').value = p.type || 'ds18b20';
  document.getElementById('apType').disabled = false;
  document.getElementById('apName').value = p.name || '';
  document.getElementById('apKey').value = p.key || '';
  document.getElementById('apPin').value = p.pin || '';
  document.getElementById('apAddress').value = p.address || '';
  apLoadPinOptions().then(function(){
    if (p.port_id) document.getElementById('apPinDropdown').value = p.port_id;
    if (p.bus_id) document.getElementById('apBusSelect').value = p.bus_id;
    if (p.pin) document.getElementById('apPin').value = p.pin;
    apOnPinDropdownChange();
    apOnBusChange();
  });
}

async function apRemovePeripheral(i) {
  var p = _apPeripherals[i];
  var deviceId = document.getElementById('apDeviceSelect').value;
  var ip = document.getElementById('apIp').value.trim();
  if (!p || !deviceId) return;
  if (!ip) { alert('Enter the device IP address for OTA first.'); return; }
  if (!confirm('Remove peripheral "' + (p.name || p.key) + '" and reflash the device?')) return;
  if (_apFlashing) return;
  _apFlashing = true;
  var flashBtn = document.getElementById('apFlashBtn');
  var cancelBtn = document.getElementById('apCancelBtn');
  var term = document.getElementById('apTerminal');
  flashBtn.style.display = '';
  flashBtn.disabled = true;
  flashBtn.innerHTML = '&#9203; Removing…';
  cancelBtn.style.display = '';
  term.style.display = '';
  term.innerHTML = '';
  apTermLine('info', 'Removing peripheral and reflashing OTA…');
  try {
    await api('/esphome/peripheral/remove', { method: 'POST', body: JSON.stringify({ device_id: Number(deviceId), ip: ip, client_id: esphomeClientId, key: p.key }) });
    apTermLine('info', 'Remove job started — compiling firmware…');
  } catch (e) {
    apTermLine('error', 'Remove failed: ' + e.message);
    apResetFlashUI(false, 'remove_peripheral');
  }
}

function apPopulateTypes() {
  var sel = document.getElementById('apType');
  if (!sel) return;
  var current = sel.value || 'ds18b20';
  var library = apLibraryForCurrentDevice();
  sel.innerHTML = '';
  var groups = {};
  library.forEach(function(item) {
    var label = apCategoryLabelForType(item.id);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });
  Object.keys(groups).forEach(function(label) {
    var og = document.createElement('optgroup');
    og.label = label;
    groups[label].forEach(function(item) {
      var opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
  sel.value = library.some(function(x) { return x.id === current; }) ? current : (library[0] ? library[0].id : '');
}

function toggleAddPeripheral() {
  var p = document.getElementById('addPeripheralPanel');
  var show = p.style.display === 'none';
  if (show) closeEspPanels('addPeripheralPanel');
  p.style.display = show ? '' : 'none';
  renderEspModeBanner();
  if (show) {
    apPopulateDevices();
    apLoadPinOptions();
    apLoadPeripherals();
  }
}

function apPopulateDevices() {
  var sel = document.getElementById('apDeviceSelect');
  sel.innerHTML = '<option value="">— select device —</option>';
  var flashed = installerDevices.filter(function(d) { return d.status === 'flashed' || d.status === 'online'; });
  if (!flashed.length) flashed = installerDevices;
  flashed.forEach(function(d) {
    var opt = document.createElement('option');
    opt.value = String(d.id);
    opt.textContent = (d.friendly_name || d.name) + (d.ip_address ? ' (' + d.ip_address + ')' : '');
    sel.appendChild(opt);
  });
  if (!installerDevices.length) sel.innerHTML += '<option value="" disabled>No devices found — flash a device first</option>';
}

function onApDeviceChange() {
  var id = Number(document.getElementById('apDeviceSelect').value);
  var d = installerDevices.find(function(x) { return Number(x.id) === id; });
  var hint = document.getElementById('apDeviceHint');
  if (d) {
    var ip = d.ip_address || d.target_ip || '';
    if (ip) document.getElementById('apIp').value = ip;
    hint.textContent = (d.board_profile_id || '') + (d.hostname ? ' · ' + d.hostname : '');
    apSetMode('add');
    try {
      localStorage.setItem('elaris_installer_board_profile_id', d.board_profile_id || '');
      localStorage.setItem('elaris_installer_device_name', d.name || d.friendly_name || '');
    } catch(e) {}
  } else {
    hint.textContent = 'Select a flashed device from the list';
  }
  _apYamlContent = null;
  var pasteRow = document.getElementById('apYamlPasteRow');
  if (pasteRow) { pasteRow.style.display = 'none'; document.getElementById('apYamlPaste').value = ''; }
  apLoadPinOptions();
  apLoadPeripherals();
}

function apAutoKey() {
  var name = document.getElementById('apName').value;
  var key = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  document.getElementById('apKey').value = key || '';
}

function apClearPreview() {
  _apPreviewYaml = null;
  var flashBtn = document.getElementById('apFlashBtn');
  flashBtn.style.display = 'none';
  flashBtn.disabled = false;
  flashBtn.innerHTML = _apMode === 'edit' ? '&#9889; Update &amp; Flash OTA' : '&#9889; Add &amp; Flash OTA';
  flashBtn.onclick = apFlash;
  document.getElementById('apYamlDetails').style.display = 'none';
  document.getElementById('apDone').style.display = 'none';
  apRenderNoticeBox('apPreviewWarnings', '', []);
}

function apRenderNoticeBox(boxId, title, items) {
  var box = document.getElementById(boxId);
  if (!box) return;
  items = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!items.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  box.innerHTML = '<div class="apNoticeTitle">' + escHtml(title || 'Info') + '</div><div class="apNoticeList">'
    + items.map(function(item) {
      var level = ['err', 'warn', 'info', 'ok'].indexOf(item.level) >= 0 ? item.level : 'info';
      var icon = item.icon || (level === 'err' ? '&#10060;' : level === 'warn' ? '&#9888;' : level === 'ok' ? '&#10003;' : '&#8505;');
      return '<div class="apNoticeItem ' + level + '"><span class="ico">' + icon + '</span><span>' + escHtml(item.text || '') + '</span></div>';
    }).join('') + '</div>';
}

function apRenderPreviewWarnings(warnings) {
  var list = (warnings || []).map(function(w) {
    return typeof w === 'string' ? { level: 'warn', text: w } : { level: w.level || 'warn', text: w.text || '' };
  }).filter(function(x) { return x.text; });
  if (!list.length) list.push({ level: 'ok', text: 'Preview looks clean — no extra warnings from the generator.' });
  apRenderNoticeBox('apPreviewWarnings', 'Preview checks', list);
}

function apBuildPinDropdown(type) {
  var dropdown = document.getElementById('apPinDropdown');
  var pinInput = document.getElementById('apPin');
  var hint = document.getElementById('apPinHint');
  var ports = apCompatiblePorts(type);
  var currentPin = String(pinInput.value || '').trim().toUpperCase();
  var currentPort = apSelectedPort();
  dropdown.innerHTML = '';

  if (!ports.length) {
    dropdown.style.display = 'none';
    pinInput.style.display = '';
    hint.textContent = apHintTextForType(type) + ' Enter a raw GPIO only if this board profile has no logical port for it.';
    return;
  }

  var logicalOnly = ports.some(function(p) { return !!p.portId; }) && ports.every(function(p) { return !!p.portId && !p.generic; });
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = logicalOnly ? '— select board port —' : 'Quick board port (optional)';
  dropdown.appendChild(placeholder);

  var buckets = {};
  ports.forEach(function(port) {
    var label = apTitleFromGroup(port.group || 'gpio');
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(port);
  });

  Object.keys(buckets).forEach(function(label) {
    var useGroup = Object.keys(buckets).length > 1;
    var parent = dropdown;
    if (useGroup) {
      var og = document.createElement('optgroup');
      og.label = label;
      dropdown.appendChild(og);
      parent = og;
    }
    buckets[label].forEach(function(port) {
      var opt = document.createElement('option');
      opt.value = String(port.portId || port.value || '').trim();
      opt.textContent = port.label || port.portId || port.value;
      if (port.range) opt.textContent += ' · ' + port.range;
      if (port.inUse) {
        if (apPortCanReplaceUsage(port, document.getElementById('apType').value)) opt.textContent += '  · replace existing';
        else opt.textContent += port.sharedBus ? '  · shared bus' : '  · in use';
      }
      if (port.usageCount) opt.textContent += '  · ' + port.usageCount + ' item' + (port.usageCount === 1 ? '' : 's');
      if (port.hint || (port.usedBy && port.usedBy.length)) opt.title = [port.hint || '', (port.usedBy || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
      parent.appendChild(opt);
      if (currentPort && currentPort.portId && currentPort.portId === port.portId) dropdown.value = opt.value;
      else if (!currentPort && currentPin && String(port.value || '').toUpperCase() === currentPin) dropdown.value = opt.value;
    });
  });

  dropdown.style.display = '';
  pinInput.style.display = logicalOnly ? 'none' : '';
  if (!dropdown.value) {
    var suggested = apPickSuggestedPort(type);
    if (suggested && suggested.portId) dropdown.value = suggested.portId;
  }
  if (logicalOnly && !dropdown.value) pinInput.value = '';
  hint.textContent = logicalOnly
    ? apHintTextForType(type) + ' Select a logical board port and ELARIS resolves the real GPIO.'
    : apHintTextForType(type) + ' Board ports are shown first, but generic boards can still use raw GPIO.';
}

function apBuildBusDropdown(type) {
  var busSel = document.getElementById('apBusSelect');
  var sda = document.getElementById('apSda');
  var scl = document.getElementById('apScl');
  var hint = document.getElementById('apI2cHint');
  var buses = apCompatibleBuses(type);
  busSel.innerHTML = '';

  if (!buses.length) {
    busSel.style.display = 'none';
    sda.readOnly = false;
    scl.readOnly = false;
    hint.textContent = apHintTextForType(type);
    return;
  }

  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— select board I²C bus —';
  busSel.appendChild(placeholder);
  buses.forEach(function(bus) {
    var opt = document.createElement('option');
    opt.value = String(bus.id || '').trim();
    opt.textContent = bus.label + (bus.sda && bus.scl ? ' · ' + bus.sda + '/' + bus.scl : '');
    if (bus.usedAddresses && bus.usedAddresses.length) opt.textContent += ' · used ' + bus.usedAddresses.join(', ');
    opt.title = [bus.hint || '', (bus.usedBy || []).slice(0, 4).join(', ')].filter(Boolean).join(' · ');
    busSel.appendChild(opt);
  });
  busSel.style.display = '';

  if (buses.length === 1) busSel.value = buses[0].id;
  if (!busSel.value) {
    var suggestedBus = apPickSuggestedBus(type);
    if (suggestedBus && suggestedBus.id) busSel.value = suggestedBus.id;
  }
  apApplyBusSelection();
}

function apApplyBusSelection() {
  var bus = apSelectedBus();
  var sda = document.getElementById('apSda');
  var scl = document.getElementById('apScl');
  var hint = document.getElementById('apI2cHint');
  var address = document.getElementById('apAddress');
  if (!bus) {
    sda.readOnly = false;
    scl.readOnly = false;
    if (!sda.value && _apPinOptions && _apPinOptions.defaultI2c) sda.value = _apPinOptions.defaultI2c.sda || '';
    if (!scl.value && _apPinOptions && _apPinOptions.defaultI2c) scl.value = _apPinOptions.defaultI2c.scl || '';
    hint.textContent = apHintTextForType(document.getElementById('apType').value);
    return;
  }
  if (bus.sda) sda.value = bus.sda;
  if (bus.scl) scl.value = bus.scl;
  sda.readOnly = !!bus.sda;
  scl.readOnly = !!bus.scl;
  hint.textContent = (bus.hint || bus.label || 'Board I²C bus') + (bus.sda && bus.scl ? ' · ' + bus.sda + '/' + bus.scl : '');
  var spec = apGetTypeSpec(document.getElementById('apType').value);
  if (spec.addresses && spec.addresses.length) {
    var preferredAddress = apPickSuggestedAddress(document.getElementById('apType').value, bus);
    if (!address.value || (spec.addresses || []).indexOf(address.value) < 0 || (bus && Array.isArray(bus.usedAddresses) && bus.usedAddresses.map(function(x){ return String(x || '').toLowerCase(); }).indexOf(String(address.value || '').toLowerCase()) >= 0)) address.value = preferredAddress || spec.addresses[0];
  }
}

function apOnBusChange() {
  apClearPreview();
  apApplyBusSelection();
  apRenderI2cValidation();
}

function apOnPinInput() {
  var dropdown = document.getElementById('apPinDropdown');
  if (dropdown && dropdown.style.display !== 'none') {
    var selected = apSelectedPort();
    var typed = String(document.getElementById('apPin').value || '').trim().toUpperCase();
    if (!selected || String(selected.value || '').toUpperCase() !== typed) dropdown.value = '';
  }
  apClearPreview();
  apRenderPinValidation();
}

function apOnI2cInput() {
  apClearPreview();
  apRenderI2cValidation();
}

function apOnPinDropdownChange() {
  var port = apSelectedPort();
  var pinInput = document.getElementById('apPin');
  if (port && port.value) pinInput.value = port.value;
  apOnPinInput();
}

function apApplyTypeDefaults() {
  var spec = apGetTypeSpec(document.getElementById('apType').value);
  if (spec && spec.scale) document.getElementById('apScale').value = spec.scale;
}

function apOnScaleChange() {
  var scale = document.getElementById('apScale').value;
  document.getElementById('apScaleCustomRow').style.display = scale === 'custom' ? '' : 'none';
}

function apGetPin() {
  var port = apSelectedPort();
  if (port && port.value) return port.value;
  var typed = document.getElementById('apPin').value.trim();
  if (typed) return typed;
  return '';
}

function apGetScaleEntity(type) {
  var base = apBaseType(type);
  if (base !== 'pulse_counter') return {};
  var spec = apGetTypeSpec(type);
  var scale = document.getElementById('apScale').value || ((spec && spec.scale) || 'none');
  var factor = parseFloat(document.getElementById('apScaleFactor').value) || 1;
  return { scale: scale, scale_factor: factor };
}

function apSelectedPortReplaceTarget(type) {
  var port = apSelectedPort();
  if (!apPortCanReplaceUsage(port, type)) return null;
  return port && port.replaceTarget ? port.replaceTarget : null;
}

function apBuildEntity(type, name, key) {
  var spec = apGetTypeSpec(type);
  var entity = Object.assign({ type: apBaseType(type), name: name, key: key }, apGetScaleEntity(type));
  if (spec && spec.id && spec.id !== entity.type) entity.template_id = spec.id;
  var port = apSelectedPort();
  var bus = apSelectedBus();
  if (apIsI2cType(type)) {
    if (bus && bus.id) entity.bus_id = bus.id;
    entity.sda = String(document.getElementById('apSda').value || '').trim();
    entity.scl = String(document.getElementById('apScl').value || '').trim();
    entity.address = String(document.getElementById('apAddress').value || '').trim();
  } else {
    if (port && port.portId) entity.port_id = port.portId;
    entity.pin = apGetPin();
  }
  return entity;
}

function apRenderPinValidation() {
  if (apIsI2cType(document.getElementById('apType').value)) {
    apRenderNoticeBox('apPinValidation', '', []);
    return;
  }
  var type = document.getElementById('apType').value;
  var port = apSelectedPort();
  var pinText = String(apGetPin() || '').trim().toUpperCase();
  var hint = document.getElementById('apPinHint');
  var messages = [];

  if (port && port.portId) {
    hint.textContent = port.label + (port.hint ? ' · ' + port.hint : '') + (port.value ? ' · ' + port.value : '');
    if (port.inUse) {
      var sharedDs = type === 'ds18b20' && port.sharedBus;
      var replaceable = apPortCanReplaceUsage(port, type);
      var usedText = Array.isArray(port.usedBy) && port.usedBy.length ? (' Used by: ' + port.usedBy.slice(0, 3).join(', ') + '.') : '';
      messages.push({
        level: sharedDs || replaceable ? 'warn' : 'err',
        text: sharedDs
          ? (port.label + ' is already used as a 1-Wire bus. Sharing it for another DS18B20 is allowed.' + usedText)
          : replaceable
            ? (port.label + ' is already in use, but ELARIS can replace the existing peripheral on this port.' + usedText)
            : (port.label + ' is already in use in this device YAML.' + usedText)
      });
    }
    if (!messages.length) messages.push({ level: 'ok', text: port.label + ' looks valid for ' + apGetTypeSpec(type).name + '.' });
    apRenderNoticeBox('apPinValidation', 'Port checks', messages);
    return;
  }

  if (!pinText) {
    hint.textContent = apHasLogicalPorts(type) ? 'Select a board port for this peripheral.' : 'Enter a GPIO pin for this peripheral.';
    apRenderNoticeBox('apPinValidation', '', []);
    return;
  }

  var m = pinText.match(/^GPIO(\d+)$/i);
  if (!m) {
    hint.textContent = 'Use GPIO<number> format, for example GPIO14 or GPIO32.';
    hint.style.color = '#f5a623';
    apRenderNoticeBox('apPinValidation', 'Pin checks', [{ level: 'warn', text: 'Pin format should be GPIO<number>.' }]);
    return;
  }
  var gpio = Number(m[1]);
  var rules = _apPinOptions || {};
  hint.textContent = 'Manual GPIO entry on ' + (rules.boardLabel || 'this board') + '.';
  hint.style.color = '';

  if ((rules.flashPins || []).indexOf(gpio) >= 0) messages.push({ level: 'err', text: pinText + ' is a flash pin and should not be used.' });
  if ((rules.reservedPins || []).indexOf(gpio) >= 0) messages.push({ level: 'err', text: pinText + ' is reserved by the board/profile.' });
  if ((rules.inputOnlyPins || []).indexOf(gpio) >= 0 && ['dht', 'dht11', 'ds18b20'].indexOf(type) >= 0) messages.push({ level: 'err', text: pinText + ' is input-only and is not suitable for this sensor type.' });
  if ((rules.strappingPins || []).indexOf(gpio) >= 0) messages.push({ level: 'warn', text: pinText + ' is a strapping pin — use with care during boot.' });
  if ((rules.noPullupPins || []).indexOf(gpio) >= 0 && type === 'pulse_counter') messages.push({ level: 'warn', text: pinText + ' has no internal pull-up. Use an external pull-up if your sensor needs one.' });
  if (!messages.length) messages.push({ level: 'ok', text: pinText + ' looks valid for this peripheral based on the current board profile.' });
  apRenderNoticeBox('apPinValidation', 'Pin checks', messages);
}

function apRenderI2cValidation() {
  if (!apIsI2cType(document.getElementById('apType').value)) {
    apRenderNoticeBox('apI2cValidation', '', []);
    return;
  }
  var bus = apSelectedBus();
  var sda = String(document.getElementById('apSda').value || '').trim().toUpperCase();
  var scl = String(document.getElementById('apScl').value || '').trim().toUpperCase();
  var addr = String(document.getElementById('apAddress').value || '').trim().toLowerCase();
  var hints = [];
  if (bus) hints.push({ level: 'info', text: 'Using ' + bus.label + (bus.sda && bus.scl ? ' on ' + bus.sda + '/' + bus.scl : '') + '.' });
  if (bus && Array.isArray(bus.usedAddresses) && bus.usedAddresses.indexOf(String(addr || '').toLowerCase()) >= 0) hints.push({ level: 'err', text: 'Address ' + addr + ' is already used on ' + bus.label + '.' });
  else if (bus && Array.isArray(bus.usedAddresses) && bus.usedAddresses.length) hints.push({ level: 'info', text: 'Already used on ' + bus.label + ': ' + bus.usedAddresses.join(', ') + '.' });
  if (!/^GPIO\d+$/i.test(sda) || !/^GPIO\d+$/i.test(scl)) hints.push({ level: 'warn', text: 'Use GPIO<number> for SDA and SCL.' });
  if (!/^0x[0-9a-f]+$/i.test(addr)) hints.push({ level: 'warn', text: 'Use a hex I²C address like 0x23, 0x44 or 0x45.' });
  var spec = apGetTypeSpec(document.getElementById('apType').value);
  if (spec.addresses && spec.addresses.length) hints.push({ level: 'info', text: 'Typical addresses for ' + spec.name + ': ' + spec.addresses.join(' or ') + '.' });
  if (!hints.length) hints.push({ level: 'ok', text: 'I²C bus and address look valid. Shared SDA/SCL with unique addresses is supported.' });
  apRenderNoticeBox('apI2cValidation', 'I²C checks', hints);
}

async function apLoadPinOptions() {
  apClearPreview();
  var deviceId = Number(document.getElementById('apDeviceSelect').value);
  var type = document.getElementById('apType').value;
  var isPulse = type === 'pulse_counter';
  var isI2c = apIsI2cType(type);

  document.getElementById('apScaleRow').style.display = isPulse ? '' : 'none';
  apApplyTypeDefaults();
  if (!isPulse) document.getElementById('apScaleCustomRow').style.display = 'none';
  document.getElementById('apI2cRow').style.display = isI2c ? '' : 'none';
  apRenderNoticeBox('apPinValidation', '', []);
  apRenderNoticeBox('apI2cValidation', '', []);

  _apPinOptions = null;
  _apBoardPorts = [];
  _apBusOptions = [];

  if (!deviceId) {
    apPopulateTypes();
    apBuildPinDropdown(type);
    apBuildBusDropdown(type);
    if (isI2c) apRenderI2cValidation(); else apRenderPinValidation();
    return;
  }

  try {
    var r = await api('/esphome/device/' + deviceId + '/pin-options');
    _apPinOptions = r;
    _apBoardPorts = Array.isArray(r.boardPorts) ? r.boardPorts : (Array.isArray(r.sensorPorts) ? r.sensorPorts : []);
    _apBusOptions = Array.isArray(r.busOptions) ? r.busOptions : [];
  } catch(e) {
    _apPinOptions = null;
    _apBoardPorts = [];
    _apBusOptions = [];
  }

  apPopulateTypes();
  type = document.getElementById('apType').value;
  isPulse = type === 'pulse_counter';
  isI2c = apIsI2cType(type);
  document.getElementById('apScaleRow').style.display = isPulse ? '' : 'none';
  apApplyTypeDefaults();
  if (!isPulse) document.getElementById('apScaleCustomRow').style.display = 'none';
  document.getElementById('apI2cRow').style.display = isI2c ? '' : 'none';
  apBuildPinDropdown(type);
  apBuildBusDropdown(type);

  var spec = apGetTypeSpec(type);
  if (isI2c && spec.addresses && spec.addresses.length && !document.getElementById('apAddress').value) document.getElementById('apAddress').value = spec.addresses[0];
  if (isI2c) apRenderI2cValidation(); else apRenderPinValidation();
}

async function apPreview() {
  var deviceId = document.getElementById('apDeviceSelect').value;
  var type = document.getElementById('apType').value;
  var name = document.getElementById('apName').value.trim();
  var key  = document.getElementById('apKey').value.trim();
  var pin  = apGetPin();
  var bus = apSelectedBus();

  if (!deviceId) { alert('Select a device.'); return; }
  if (!name) { alert('Enter a sensor name.'); return; }
  if (!key)  { alert('Key is required.'); return; }
  if (!apIsI2cType(type) && !pin) { alert(apHasLogicalPorts(type) ? 'Select a board port first.' : 'Select or enter a GPIO pin.'); return; }
  if (apIsI2cType(type) && !bus && (!document.getElementById('apSda').value || !document.getElementById('apScl').value)) { alert('Select a board I²C bus or enter SDA/SCL.'); return; }
  if (_apMode === 'edit' && !_apEditOriginalKey) { alert('Pick a peripheral to edit first.'); return; }

  var replaceTarget = _apMode === 'add' ? apSelectedPortReplaceTarget(type) : null;
  if (replaceTarget) {
    var okReplace = confirm('This port already has "' + (replaceTarget.name || replaceTarget.key || 'existing peripheral') + '" (' + (replaceTarget.type || 'unknown') + '). Replace it with this new peripheral?');
    if (!okReplace) return;
  }

  _apYamlContent = (document.getElementById('apYamlPaste').value || '').trim() || null;

  var btn = document.getElementById('apPreviewBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    var entity = apBuildEntity(type, name, key);
    var endpoint = (_apMode === 'edit' || replaceTarget) ? '/esphome/peripheral/edit/preview' : '/esphome/add-peripheral/preview';
    var payload = { device_id: Number(deviceId), entity: entity };
    if (_apMode === 'edit') payload.original_key = _apEditOriginalKey;
    else if (replaceTarget) payload.original_key = replaceTarget.key;
    if (_apYamlContent) payload.yaml_content = _apYamlContent;
    var r = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    _apPreviewYaml = r.yaml;
    document.getElementById('apYamlPreview').textContent = r.yaml;
    document.getElementById('apYamlDetails').style.display = '';
    document.getElementById('apYamlDetails').open = true;
    document.getElementById('apFlashBtn').style.display = '';
    document.getElementById('apDone').style.display = 'none';
    apRenderPreviewWarnings(r.warnings || []);
  } catch(e) {
    var msg = String(e && e.message || e || 'Unknown error');
    if (/yaml_file_not_found/i.test(msg)) {
      document.getElementById('apYamlPasteRow').style.display = '';
      apRenderPreviewWarnings([{ text: 'No YAML found on server — paste the device YAML below and click Preview again.', level: 'warn' }]);
    } else {
      if (/esphome_not_installed/i.test(msg)) msg = 'ESPHome is not installed yet. Install ESPHome first, then preview again.';
      else if (/flash_in_progress/i.test(msg)) msg = 'Another ESPHome flash is already running. Wait for it to finish or cancel it first.';
      apRenderPreviewWarnings([{ text: 'Preview failed: ' + msg, level: 'err' }]);
      alert('Preview failed: ' + msg);
    }
  }
  btn.disabled = false; btn.innerHTML = _apMode === 'edit' ? '&#128196; Preview Update' : '&#128196; Preview YAML';
}

async function apFlash() {
  if (_apFlashing) return;
  if (!_apPreviewYaml) { alert('Click Preview YAML first.'); return; }

  var deviceId = document.getElementById('apDeviceSelect').value;
  var ip   = document.getElementById('apIp').value.trim();
  var type = document.getElementById('apType').value;
  var name = document.getElementById('apName').value.trim();
  var key  = document.getElementById('apKey').value.trim();
  if (!ip) { alert('Enter the device IP address for OTA.'); return; }
  if (_apMode === 'edit' && !_apEditOriginalKey) { alert('Pick a peripheral to edit first.'); return; }

  var replaceTarget = _apMode === 'add' ? apSelectedPortReplaceTarget(type) : null;
  if (replaceTarget) {
    var okReplace = confirm('Replace existing peripheral "' + (replaceTarget.name || replaceTarget.key || 'existing peripheral') + '" on this port and flash OTA?');
    if (!okReplace) return;
  }

  _apFlashing = true;
  var flashBtn = document.getElementById('apFlashBtn');
  var cancelBtn = document.getElementById('apCancelBtn');
  var term = document.getElementById('apTerminal');
  flashBtn.disabled = true; flashBtn.innerHTML = _apMode === 'edit' ? '&#9203; Updating…' : '&#9203; Flashing…'; flashBtn.onclick = function(){};
  cancelBtn.style.display = '';
  term.style.display = '';
  term.innerHTML = '';
  document.getElementById('apDone').style.display = 'none';
  apTermLine('info', _apMode === 'edit' ? 'Starting OTA update…' : 'Starting OTA flash…');

  try {
    var entity = apBuildEntity(type, name, key);
    var selected = installerDevices.find(function(x){ return String(x.id) === String(deviceId); });
    try {
      localStorage.setItem('elaris_installer_board_profile_id', (selected && selected.board_profile_id) || '');
      localStorage.setItem('elaris_installer_device_name', (selected && (selected.name || selected.friendly_name)) || '');
    } catch(e) {}
    var endpoint = (_apMode === 'edit' || replaceTarget) ? '/esphome/peripheral/edit' : '/esphome/add-peripheral';
    var payload = { device_id: Number(deviceId), ip: ip, client_id: esphomeClientId, entity: entity };
    if (_apMode === 'edit') payload.original_key = _apEditOriginalKey;
    else if (replaceTarget) payload.original_key = replaceTarget.key;
    if (_apYamlContent) payload.yaml_content = _apYamlContent;
    await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    apTermLine('info', (_apMode === 'edit' ? 'Update' : 'Flash') + ' started — compiling firmware…');
  } catch(e) {
    var msg = String(e && e.message || e || 'Unknown error');
    if (/esphome_not_installed/i.test(msg)) msg = 'ESPHome is not installed yet. Install ESPHome first, then retry the OTA action.';
    else if (/flash_in_progress/i.test(msg)) msg = 'Another ESPHome flash is already running. Wait for it to finish or cancel it first.';
    apTermLine('error', 'Error: ' + msg);
    apResetFlashUI(false, _apMode === 'edit' ? 'edit_peripheral' : 'add_peripheral');
  }
}

function apCancel() {
  fetch('/api/esphome/flash', { method: 'DELETE', credentials: 'include' }).catch(function(){});
  apTermLine('warn', '— Cancelled —');
  apResetFlashUI(false);
}

function apShowDoneState(action, awaitingReport, entityKey) {
  var box = document.getElementById('apDone');
  var title = document.getElementById('apDoneTitle');
  var text = document.getElementById('apDoneText');
  if (!box || !title || !text) return;
  var mode = String(action || '').toLowerCase();
  if (mode === 'remove_peripheral') title.textContent = 'Peripheral removed';
  else if (mode === 'edit_peripheral') title.textContent = 'Peripheral updated';
  else title.textContent = 'Peripheral added';
  text.textContent = awaitingReport
    ? ('The device will restart and publish its updated MQTT config. ' + (entityKey ? ('Watch for ' + entityKey + ' in Installer within ~30 seconds.') : 'Watch Installer for the updated IO within ~30 seconds.'))
    : 'The OTA action finished. Refresh Installer if the updated device state does not appear automatically.';
  box.style.display = '';
}

function apResetFlashUI(ok, action) {
  _apFlashing = false;
  var flashBtn = document.getElementById('apFlashBtn');
  var cancelBtn = document.getElementById('apCancelBtn');
  flashBtn.disabled = false;
  if (ok) {
    flashBtn.innerHTML = '&#10003; Open Installer';
    flashBtn.onclick = function(){ window.location.href = (typeof installerContextUrl === 'function' ? installerContextUrl() : '/installer.html'); };
  } else {
    flashBtn.innerHTML = _apMode === 'edit' ? '&#9889; Update &amp; Flash OTA' : '&#9889; Add &amp; Flash OTA';
    if (action === 'remove_peripheral') flashBtn.innerHTML = '&#9889; Remove &amp; Flash OTA';
    flashBtn.onclick = apFlash;
  }
  cancelBtn.style.display = 'none';
  apLoadPeripherals();
}

function apTermLine(level, text) {
  var term = document.getElementById('apTerminal');
  if (!term) return;
  var d = document.createElement('div');
  var now = new Date();
  var ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  d.innerHTML = '<span class="tl-ts">' + ts + '</span><span class="tl-' + level + '">' + escHtml(text) + '</span>';
  term.appendChild(d);
  term.scrollTop = term.scrollHeight;
}
