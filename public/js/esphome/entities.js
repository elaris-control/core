// ── Step 4: entities ───────────────────────────────────────────────────────
var entityCount = 0;
var ENTITY_TYPES = [
  { v:'relay', l:'Relay / Digital Output', baseType:'relay', category:'Digital Outputs', connection:'DO', sourceMode:'port', groups:['do'], title:'Board output' },

  { v:'di', l:'Digital Input / Contact', baseType:'di', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'rain_digital', l:'Rain Sensor (digital)', baseType:'di', subtype:'rain_digital', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'pir', l:'PIR Motion Sensor', baseType:'di', subtype:'pir', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'door_contact', l:'Door / Window Contact', baseType:'di', subtype:'door_contact', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'vibration', l:'Vibration Sensor (SW-420)', baseType:'di', subtype:'vibration', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'water_leak', l:'Water Leak Sensor (digital)', baseType:'di', subtype:'water_leak', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },
  { v:'float_switch', l:'Float Switch (tank full/empty)', baseType:'di', subtype:'float_switch', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Board input' },

  { v:'pulse_counter', l:'Pulse Counter (generic)', baseType:'pulse_counter', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Pulse / DI input', unit:'pulses/min' },
  { v:'anemometer', l:'Wind Speed (WH-SP-WS01)', baseType:'pulse_counter', subtype:'anemometer', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Pulse / DI input', unit:'Hz', scale:'anemometer' },
  { v:'yfs201', l:'Water Flow Meter (YF-S201)', baseType:'pulse_counter', subtype:'yfs201', category:'Digital / GPIO Inputs', connection:'DI / GPIO', sourceMode:'port', groups:['di'], title:'Pulse / DI input', unit:'L/min', scale:'yfs201' },

  { v:'analog', l:'Analog Input (generic)', baseType:'analog', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input', unit:'V' },
  { v:'soil_moisture', l:'Soil Moisture (capacitive)', baseType:'analog', subtype:'soil_moisture', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },
  { v:'ntc', l:'NTC Thermistor (analog)', baseType:'analog', subtype:'ntc', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },
  { v:'mq2', l:'MQ-2 Smoke / LPG / CO', baseType:'analog', subtype:'mq2', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },
  { v:'mq7', l:'MQ-7 Carbon Monoxide (CO)', baseType:'analog', subtype:'mq7', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },
  { v:'mq135', l:'MQ-135 Air Quality', baseType:'analog', subtype:'mq135', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },
  { v:'ct_clamp', l:'CT Clamp Non-Invasive AC Current', baseType:'analog', subtype:'ct_clamp', category:'Analog Inputs (AI)', connection:'AI / ADC', sourceMode:'port', groups:['ai'], title:'Analog input' },

  { v:'ds18b20', l:'DS18B20 Temp', baseType:'ds18b20', category:'Sensor Ports / 1-Wire', connection:'HT / 1-Wire', sourceMode:'port', groups:['ht', 'onewire'], title:'Sensor port', unit:'°C', deviceClass:'temperature' },
  { v:'dht', l:'DHT22 Temp + Humidity', baseType:'dht', category:'Sensor Ports / 1-Wire', connection:'HT / 1-Wire', sourceMode:'port', groups:['ht', 'onewire'], title:'Sensor port', unit:'°C', deviceClass:'temperature' },
  { v:'dht11', l:'DHT11 Temp + Humidity', baseType:'dht11', category:'Sensor Ports / 1-Wire', connection:'HT / 1-Wire', sourceMode:'port', groups:['ht', 'onewire'], title:'Sensor port', unit:'°C', deviceClass:'temperature' },

  { v:'bh1750', l:'BH1750 Lux Sensor', baseType:'bh1750', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'lx', deviceClass:'illuminance', address:'0x23' },
  { v:'sht3x', l:'SHT3x Temp + Humidity', baseType:'sht3x', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'°C', deviceClass:'temperature', address:'0x44' },
  { v:'bme280', l:'BME280 Temp / Humidity / Pressure', baseType:'bme280', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'°C', deviceClass:'temperature', address:'0x76' },
  { v:'bmp280', l:'BMP280 Temp / Pressure', baseType:'bmp280', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'°C', deviceClass:'temperature', address:'0x76' },
  { v:'veml7700', l:'VEML7700 Ambient Light', baseType:'veml7700', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'lx', deviceClass:'illuminance', address:'0x10' },
  { v:'ina219', l:'INA219 DC Current / Power', baseType:'ina219', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'A', deviceClass:'current', address:'0x40' },
  { v:'ccs811', l:'CCS811 eCO2 + TVOC', baseType:'ccs811', category:'I²C Bus Sensors', connection:'I²C', sourceMode:'bus', busProtocols:['i2c'], title:'I²C bus', unit:'ppm', deviceClass:'carbon_dioxide', address:'0x5A' },
  { v:'mhz19', l:'MH-Z19 CO2 Sensor', baseType:'mhz19', category:'UART / Bus Sensors', connection:'UART / BUS', sourceMode:'bus', busProtocols:['uart','rs485'], title:'UART / RS485 bus', unit:'ppm', deviceClass:'carbon_dioxide' },
  { v:'pzem004t', l:'PZEM Power Meter', baseType:'pzem004t', category:'UART / Bus Sensors', connection:'UART / BUS', sourceMode:'bus', busProtocols:['uart','rs485'], title:'UART / RS485 bus', unit:'W', deviceClass:'power' },
];

function entityUiMeta(type) {
  var t = String(type || '').toLowerCase();
  return ENTITY_TYPES.find(function(x) { return x.v === t; }) || ENTITY_TYPES.find(function(x) { return x.baseType === t; }) || ENTITY_TYPES[0];
}

function entityGeneratorType(type) {
  var meta = entityUiMeta(type);
  return String((meta && meta.baseType) || type || '').toLowerCase();
}

function entityTypeMeta(type) {
  return entityUiMeta(type);
}

function entityTypeHint(type) {
  var meta = entityUiMeta(type);
  var t = entityGeneratorType(type);
  if (meta.sourceMode === 'bus') {
    if ((meta.busProtocols || []).indexOf('i2c') >= 0) return 'I²C sensors belong on a board I²C bus. ELARIS resolves SDA/SCL from the board profile and keeps bus sensors separate from AI / DI channels.';
    return 'UART / RS485 sensors belong on a board communication bus, not on DI / AI / relay channels. ELARIS keeps bus peripherals separate from the core GPIO channels.';
  }
  if (t === 'analog') return 'Analog sensors belong on AI / ADC-capable inputs, not generic relay/output GPIOs.';
  if (t === 'ds18b20' || t === 'dht' || t === 'dht11') return 'Use HT / 1-Wire sensor ports when the board profile provides them. DS18B20 can share a 1-Wire bus; DHT sensors should stay unique per port.';
  if (t === 'di' || t === 'pulse_counter') return 'Use DI / GPIO input ports for contacts, flow, rain, PIR and pulse sensors.';
  if (t === 'relay') return 'Use DO / output channels for relays and digital outputs.';
  return 'Choose a compatible board port or board bus.';
}

function entityTemplateDisplayName(type) {
  var meta = entityUiMeta(type);
  return (meta && meta.l) ? meta.l : ('Entity ' + type);
}

function populatePorts(ports) {
  var sel = document.getElementById('portSelect');
  var previous = sel.value;
  sel.innerHTML = '';
  if (!ports.length) {
    sel.innerHTML = '<option value="">— no USB devices found —</option>';
    updateStep1UI();
    return;
  }
  sel.innerHTML = '<option value="">— select port —</option>';
  ports.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
  if (previous && ports.indexOf(previous) !== -1) sel.value = previous;
  else if (ports.length === 1) sel.value = ports[0];
  updateStep1UI();
}

async function refreshPorts() {
  var sel = document.getElementById('portSelect');
  if (sel) sel.innerHTML = '<option value="">— scanning… —</option>';
  try {
    var r = await api('/esphome/ports');
    populatePorts(r.ports || []);
    if (!(r.ports || []).length) {
      var hint = document.getElementById('usbPortHint');
      if (hint) hint.textContent = 'No USB devices detected. Connect the board via USB-C to the Raspberry Pi and click Refresh.';
    }
  } catch (e) {
    populatePorts([]);
    var hint = document.getElementById('usbPortHint');
    if (hint) hint.textContent = 'Could not scan ports: ' + e.message;
  }
}

function populateBoards() {
  var sel = document.getElementById('boardSelect');
  var previous = sel.value;
  sel.innerHTML = '<option value="">— select board —</option>';
  var groups = [
    { key: 'bundled_js_seed', label: 'Official Boards' },
    { key: 'yaml_import', label: 'Imported from YAML' },
    { key: 'profile_editor', label: 'Custom Boards' },
    { key: 'bundled_override', label: 'Overrides' },
  ];
  var appended = new Set();
  groups.forEach(function(group) {
    var items = boards.filter(function(b) { return (b.source || '') === group.key; });
    if (!items.length) return;
    var optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    items.forEach(function(b) {
      var opt = document.createElement('option');
      opt.value = b.id; opt.textContent = b.label;
      optgroup.appendChild(opt);
      appended.add(b.id);
    });
    sel.appendChild(optgroup);
  });
  boards.filter(function(b) { return !appended.has(b.id); }).forEach(function(b) {
    var opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.label;
    sel.appendChild(opt);
  });
  if (previous) sel.value = previous;
}

function step4BoardInfo() {
  var boardId = document.getElementById('boardSelect') ? document.getElementById('boardSelect').value : '';
  return boards.find(function(b) { return b.id === boardId; }) || null;
}

function onBoardChange() {
  var sel = document.getElementById('boardSelect');
  var v = sel.value;
  document.getElementById('customBoardRow').style.display = v === '__custom__' ? '' : 'none';

  var boardInfo = boards.find(function(b) { return b.id === v; }) || {};
  var notesBox = document.getElementById('boardNotes');
  if (notesBox) {
    var notes = boardInfo.notes || [];
    var groups = Array.isArray(boardInfo.portGroups) ? boardInfo.portGroups : [];
    var buses = Array.isArray(boardInfo.boardBuses) ? boardInfo.boardBuses : [];
    var lines = notes.map(function(n){ return '&#8226; ' + escHtml(n); });
    if (groups.length) {
      lines.push('');
      lines.push('<strong>Board-aware ports:</strong> ' + groups.map(function(g){ return escHtml(g.label || g.key); }).join(', '));
    }
    if (buses.length) {
      lines.push('<strong>Buses:</strong> ' + buses.map(function(b){ return escHtml((b.label || b.id) + (b.protocol ? ' (' + String(b.protocol).toUpperCase() + ')' : '')); }).join(', '));
    }
    if (Array.isArray(boardInfo.capabilities) && boardInfo.capabilities.length) {
      var capBits = boardInfo.capabilities.filter(function(c){ return /^port_|^bus_|^supports_/.test(String(c.key || c.capability_key || '')); }).map(function(c){
        var key = String(c.key || c.capability_key || '').replace(/^port_/, '').replace(/^bus_/, '').replace(/^supports_/, '');
        var count = Number(c.count || c.channel_count || 0) || 0;
        return escHtml(key.toUpperCase()) + (count ? ' ×' + count : '');
      });
      if (capBits.length) lines.push('<strong>Capabilities:</strong> ' + capBits.join(', '));
    }
    notesBox.style.display = lines.length ? '' : 'none';
    notesBox.innerHTML = lines.join('<br>');
  }

  if (boardInfo.supports && boardInfo.supports.ethernet) document.getElementById('useEthernet').checked = true;
  if (boardInfo.supports && boardInfo.supports.wifi === false) document.getElementById('useEthernet').checked = true;
  onNetChange();
  applyPreset(v);
  refreshAllEntitySourceControls();
}

function applyPreset(profileId) {
  var preset = presets[profileId] || {};
  var items = preset.entities || [];
  document.getElementById('entityList').innerHTML = '';
  entityCount = 0;
  items.forEach(function(e) {
    addEntityWithValues(e.type, e.name, e.source || e.pin || e.bus_id || '');
  });
}

function entityTypeConfig(type) {
  var meta = entityUiMeta(type);
  return {
    mode: meta.sourceMode || 'raw',
    groups: Array.isArray(meta.groups) ? meta.groups.slice() : [],
    busProtocols: Array.isArray(meta.busProtocols) ? meta.busProtocols.slice() : [],
    title: meta.title || 'Source'
  };
}

function entityDisplaySource(item) {
  if (!item) return '';
  return item.id || item.label || item.pin || item.sda || '';
}

function entityPortGroupsForType(type, boardInfo) {
  var cfg = entityTypeConfig(type);
  var want = entityGeneratorType(type);
  var ports = Array.isArray(boardInfo && boardInfo.boardPorts) ? boardInfo.boardPorts : [];
  var filtered = ports.filter(function(port) {
    var group = String(port.group || '').toLowerCase();
    var supports = Array.isArray(port.supports) ? port.supports.map(function(x){ return String(x || '').toLowerCase(); }) : [];
    if (cfg.groups.indexOf(group) >= 0) return true;
    if (supports.indexOf(want) >= 0) return true;
    return false;
  });
  var grouped = {};
  filtered.forEach(function(port) {
    var g = String(port.group || 'ports').toLowerCase();
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(port);
  });
  return grouped;
}

function entityBusesForType(type, boardInfo) {
  var cfg = entityTypeConfig(type);
  var want = entityGeneratorType(type);
  var buses = Array.isArray(boardInfo && boardInfo.boardBuses) ? boardInfo.boardBuses : [];
  var genericI2c = ['bh1750','sht3x','bme280','bmp280','veml7700','ina219','ccs811'];
  var genericUart = ['mhz19','pzem004t'];
  return buses.filter(function(bus) {
    var proto = String(bus.protocol || '').toLowerCase();
    var supports = Array.isArray(bus.supports) ? bus.supports.map(function(x){ return String(x || '').toLowerCase(); }) : [];
    if (cfg.busProtocols.length && cfg.busProtocols.indexOf(proto) < 0) return false;
    if (!supports.length) return true;
    if (supports.indexOf(want) >= 0) return true;
    if (proto === 'i2c' && genericI2c.indexOf(want) >= 0) return true;
    if ((proto === 'uart' || proto === 'rs485') && genericUart.indexOf(want) >= 0) return true;
    return false;
  });
}

function entitySourceHelp(item, kind) {
  if (!item) return '';
  if (kind === 'bus') {
    var parts = [];
    if (item.label && item.label !== item.id) parts.push(item.label);
    if (item.protocol) parts.push(String(item.protocol).toUpperCase());
    if (item.sda || item.scl) parts.push('SDA ' + escHtml(String(item.sda || '?')) + ' / SCL ' + escHtml(String(item.scl || '?')));
    if (item.addresses && item.addresses.length) parts.push('addresses ' + item.addresses.join(', '));
    if (item.hint) parts.push(item.hint);
    return parts.join(' · ');
  }
  var bits = [];
  if (item.label && item.label !== item.id) bits.push(item.label);
  if (item.aliases && item.aliases.length) bits.push(item.aliases.join(', '));
  if (item.range) bits.push(item.range);
  if (item.hint) bits.push(item.hint);
  if (item.pin) bits.push(item.pin);
  return bits.join(' · ');
}

function friendlyNameFromSource(source) {
  var s = String(source || '').trim();
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/([A-Z]+)(\d+)/g, '$1 $2');
}

function entitySuggestedName(type, sourceValue, num) {
  var label = entityTemplateDisplayName(type).replace(/\s*\([^)]*\)\s*/g, '').replace(/\s*\+\s*/g, ' ');
  var suffix = friendlyNameFromSource(sourceValue || '').trim();
  var out = label;
  if (suffix && !new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) out += ' ' + suffix;
  return (out || ('Entity ' + num)).trim();
}

function step4CollectUsage(excludeNum) {
  var usage = { ports: {}, buses: {} };
  document.querySelectorAll('.entity-item').forEach(function(item) {
    var m = String(item.id || '').match(/entity_(\d+)/);
    if (!m) return;
    var num = Number(m[1]);
    if (excludeNum && num === excludeNum) return;
    var typeSel = document.getElementById('etype_' + num);
    var sourceField = item.querySelector('[data-entity-source="1"]');
    if (!typeSel || !sourceField) return;
    var value = String(sourceField.value || '').trim();
    if (!value) return;
    var bucket = sourceField.dataset.busSelect === '1' ? usage.buses : usage.ports;
    if (!bucket[value]) bucket[value] = [];
    bucket[value].push({ num: num, type: typeSel.value });
  });
  return usage;
}

function entityCanReusePort(type, port) {
  var base = entityGeneratorType(type);
  return !!(port && port.shared_bus && base === 'ds18b20');
}

function refreshAllEntitySourceControls() {
  document.querySelectorAll('.entity-item').forEach(function(item) {
    var m = String(item.id || '').match(/entity_(\d+)/);
    if (!m) return;
    var num = Number(m[1]);
    var typeSel = document.getElementById('etype_' + num);
    var sourceField = item.querySelector('[data-entity-source="1"]');
    var value = sourceField ? String(sourceField.value || '').trim() : '';
    var type = typeSel ? typeSel.value : 'relay';
    renderEntitySourceControl(num, type, value);
    var hintEl = document.getElementById('etypehint_' + num);
    if (hintEl) hintEl.textContent = entityTypeHint(type);
  });
}

function createEntityRow(type, name, source) {
  entityCount++;
  var num = entityCount;
  var id = 'entity_' + num;
  var div = document.createElement('div');
  div.className = 'entity-item';
  div.id = id;

  var groups = {};
  ENTITY_TYPES.forEach(function(t) {
    var key = t.category || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  var typeOpts = Object.keys(groups).map(function(label) {
    return '<optgroup label="' + escHtml(label) + '">' + groups[label].map(function(t) {
      return '<option value="' + t.v + '"' + (t.v === type ? ' selected' : '') + '>' + escHtml(t.l + ' · ' + (t.connection || '')) + '</option>';
    }).join('') + '</optgroup>';
  }).join('');

  div.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:4px;min-width:220px"><select id="etype_' + num + '">' + typeOpts + '</select><div class="form-hint" id="etypehint_' + num + '" style="font-size:11px;color:var(--muted2)"></div></div>' +
    '<input type="text" placeholder="Name" id="ename_' + num + '" value="' + escHtml(name || ('Entity ' + num)) + '">' +
    '<div class="entity-source-wrap" id="esourcewrap_' + num + '"></div>' +
    '<button class="entity-remove" type="button" id="eremove_' + num + '">&#215;</button>';

  document.getElementById('entityList').appendChild(div);
  document.getElementById('etype_' + num).addEventListener('change', function(){ onEntityTypeChange(num); });
  document.getElementById('eremove_' + num).addEventListener('click', function(){ removeEntity(id); });
  renderEntitySourceControl(num, type, source || '');
  var hintEl = document.getElementById('etypehint_' + num);
  if (hintEl) hintEl.textContent = entityTypeHint(type);
}

function addEntityWithValues(type, name, source) {
  createEntityRow(type || 'relay', name, source || '');
  refreshAllEntitySourceControls();
}

function addEntity() {
  createEntityRow('relay', 'Entity ' + (entityCount + 1), '');
  refreshAllEntitySourceControls();
}

function removeEntity(id) {
  var el = document.getElementById(id);
  if (el) el.remove();
  refreshAllEntitySourceControls();
}

function renderEntitySourceControl(num, type, currentValue) {
  var wrap = document.getElementById('esourcewrap_' + num);
  if (!wrap) return;
  var boardInfo = step4BoardInfo();
  var cfg = entityTypeConfig(type);
  var portGroups = entityPortGroupsForType(type, boardInfo);
  var busOptions = entityBusesForType(type, boardInfo);
  var canUseBoardPorts = !!(boardInfo && Object.keys(portGroups).length);
  var canUseBoardBuses = !!(boardInfo && busOptions.length);
  var usage = step4CollectUsage(num);
  var meta = entityUiMeta(type);

  wrap.innerHTML = '';
  if (cfg.mode === 'bus' && canUseBoardBuses) {
    var busSel = document.createElement('select');
    busSel.id = 'epin_' + num;
    busSel.setAttribute('data-entity-source', '1');
    busSel.setAttribute('data-bus-select', '1');
    var blankBus = document.createElement('option');
    blankBus.value = '';
    blankBus.textContent = '— select ' + String(cfg.title || 'bus').toLowerCase() + ' —';
    busSel.appendChild(blankBus);
    busOptions.forEach(function(bus) {
      var opt = document.createElement('option');
      var busValue = entityDisplaySource(bus);
      var usedCount = (usage.buses[busValue] || []).length;
      opt.value = busValue;
      opt.textContent = busValue + (usedCount ? (' · shared bus (' + usedCount + ' used above)') : '');
      opt.dataset.help = entitySourceHelp(bus, 'bus');
      busSel.appendChild(opt);
    });
    busSel.value = currentValue || '';
    wrap.appendChild(busSel);

    var busHelp = document.createElement('div');
    busHelp.className = 'form-hint';
    busHelp.style.marginTop = '4px';
    busHelp.style.fontSize = '11px';
    busHelp.style.color = 'var(--muted2)';
    wrap.appendChild(busHelp);

    var syncBusHelp = function() {
      var opt = busSel.options[busSel.selectedIndex];
      busHelp.textContent = opt && opt.dataset && opt.dataset.help ? opt.dataset.help : 'Board-aware bus selection — ELARIS resolves the real SDA/SCL from the board profile.';
      var nameInp = document.getElementById('ename_' + num);
      if (!nameInp) return;
      var genericNames = ['Entity ' + num, '', 'Sensor', 'Input', 'Relay'];
      if (genericNames.indexOf(nameInp.value.trim()) >= 0) {
        nameInp.value = entitySuggestedName(type, busSel.value, num);
      }
    };
    busSel.addEventListener('change', function(){ syncBusHelp(); refreshAllEntitySourceControls(); });
    syncBusHelp();
    return;
  }

  if (!canUseBoardPorts) {
    var raw = document.createElement('input');
    raw.type = 'text';
    raw.placeholder = cfg.mode === 'bus' ? 'bus_a / I2C_A' : 'OUT1 / GPIO26';
    raw.id = 'epin_' + num;
    raw.setAttribute('data-entity-source', '1');
    raw.value = currentValue || '';
    wrap.appendChild(raw);
    return;
  }

  var select = document.createElement('select');
  select.id = 'epin_' + num;
  select.setAttribute('data-entity-source', '1');
  select.setAttribute('data-port-select', '1');
  var blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— select ' + String(cfg.title || 'source').toLowerCase() + ' —';
  select.appendChild(blank);

  Object.keys(portGroups).forEach(function(groupKey) {
    var ports = portGroups[groupKey] || [];
    var visible = [];
    ports.forEach(function(port) {
      var portValue = entityDisplaySource(port);
      var usedAbove = usage.ports[portValue] || [];
      if (currentValue && portValue === currentValue) {
        visible.push({ port: port, usedAbove: usedAbove });
        return;
      }
      if (usedAbove.length && !entityCanReusePort(type, port)) return;
      visible.push({ port: port, usedAbove: usedAbove });
    });
    if (!visible.length) return;
    var optgroup = document.createElement('optgroup');
    var label = visible[0].port && visible[0].port.group ? String(visible[0].port.group).toUpperCase() : String(groupKey).toUpperCase();
    optgroup.label = label;
    visible.forEach(function(entry) {
      var port = entry.port;
      var usedAbove = entry.usedAbove || [];
      var opt = document.createElement('option');
      var portValue = entityDisplaySource(port);
      opt.value = portValue;
      opt.textContent = portValue
        + (port.aliases && port.aliases.length ? ' · ' + port.aliases[0] : '')
        + (usedAbove.length ? (' · shared bus (' + usedAbove.length + ' used above)') : '');
      opt.dataset.help = entitySourceHelp(port, 'port');
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
  select.value = currentValue || '';
  wrap.appendChild(select);

  var help = document.createElement('div');
  help.className = 'form-hint';
  help.style.marginTop = '4px';
  help.style.fontSize = '11px';
  help.style.color = 'var(--muted2)';
  wrap.appendChild(help);

  var syncHelp = function() {
    var opt = select.options[select.selectedIndex];
    help.textContent = opt && opt.dataset && opt.dataset.help ? opt.dataset.help : 'Board-aware selection — ELARIS resolves the real GPIO or expander mapping behind the scenes.';
    var nameInp = document.getElementById('ename_' + num);
    if (!nameInp) return;
    var genericNames = ['Entity ' + num, '', 'Relay', 'Input', 'Sensor'];
    if (select.value && genericNames.indexOf(nameInp.value.trim()) >= 0) {
      nameInp.value = entitySuggestedName(type, select.value, num);
    }
    refreshAllEntitySourceControls();
  };
  select.addEventListener('change', syncHelp);
  syncHelp();
}

function onEntityTypeChange(num) {
  var typeSel = document.getElementById('etype_' + num);
  var sourceField = document.getElementById('epin_' + num);
  var value = sourceField ? String(sourceField.value || '').trim() : '';
  var type = typeSel ? typeSel.value : 'relay';
  renderEntitySourceControl(num, type, value);
  var hintEl = document.getElementById('etypehint_' + num);
  if (hintEl) hintEl.textContent = entityTypeHint(type);
  var nameInp = document.getElementById('ename_' + num);
  if (nameInp) {
    var genericNames = ['Entity ' + num, '', 'Relay', 'Input', 'Sensor'];
    if (genericNames.indexOf(nameInp.value.trim()) >= 0) nameInp.value = entitySuggestedName(type, value, num);
  }
  refreshAllEntitySourceControls();
}

function collectEntities() {
  var list = document.querySelectorAll('.entity-item');
  var result = [];
  var idx = 0;
  list.forEach(function(item) {
    idx++;
    var sel = item.querySelector('select[id^="etype_"]');
    var name = item.querySelector('input[placeholder="Name"]');
    var sourceField = item.querySelector('[data-entity-source="1"]');
    if (!sel || !sourceField) return;
    var uiType = String(sel.value || '').trim();
    var meta = entityUiMeta(uiType);
    var type = entityGeneratorType(uiType);
    var nval = (name ? name.value.trim() : '') || entitySuggestedName(uiType, sourceField.value, idx) || ('Entity ' + idx);
    var sval = String(sourceField.value || '').trim();
    var key = nval.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || ('entity_' + idx);
    var unit = meta.unit || (type === 'analog' ? 'V' : (type === 'pulse_counter' ? 'pulses/min' : null));
    var dc = meta.deviceClass || (type === 'ds18b20' || type === 'dht' || type === 'dht11' || type === 'sht3x' ? 'temperature' : null);
    var row = {
      type: type,
      name: nval,
      key: key,
      pin: sourceField.dataset.busSelect === '1' ? null : sval,
      source: sval,
      port_id: sourceField.dataset.portSelect === '1' ? (sval || null) : null,
      bus_id: sourceField.dataset.busSelect === '1' ? (sval || null) : null,
      unit: unit,
      device_class: dc,
      subtype: meta.subtype || null,
      template_id: meta.v !== type ? meta.v : null,
    };
    if (meta.address) row.address = meta.address;
    if (meta.scale) row.scale = meta.scale;
    result.push(row);
  });
  return result;
}

function updateSafeName() {
  var v = document.getElementById('deviceName').value.trim()
    .toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  document.getElementById('safeNamePreview').textContent = v || '—';
}
