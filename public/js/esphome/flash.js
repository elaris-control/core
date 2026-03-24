// ── Stepper ────────────────────────────────────────────────────────────────
function goStep(n) {
  if (n === currentStep) return;
  if (!validateStep(currentStep)) return;
  if (n >= 1 && n <= 5) closeEspPanels();
  document.getElementById('step' + currentStep).style.display = 'none';
  currentStep = n;
  document.getElementById('step' + n).style.display = '';

  for (var i = 1; i <= 5; i++) {
    var dot = document.getElementById('sd' + i);
    var lbl = document.getElementById('sl' + i);
    dot.className = 'step-dot' + (i < n ? ' done' : i === n ? ' active' : '');
    lbl.className = 'step-label' + (i === n ? ' active' : '');
  }

  if (n === 5) { setReflashNotice(); buildYamlPreview(); }
  renderEspModeBanner();
}

function espFlashError(msg) {
  try { termLine('error', msg); } catch (_) {}
  alert(msg);
}

function validateStep(n) {
  if (n === 1) {
    var useOTA = document.getElementById('useOTA').checked;
    var usb = document.getElementById('portSelect').value;
    var otaIp = document.getElementById('otaIp').value.trim();

    if (useOTA) {
      if (!otaIp) { espFlashError('Enter the device IP address for OTA flashing.'); return false; }
    } else {
      if (!usb) { espFlashError('Select a USB port first.'); return false; }
    }
  }

  if (n === 2) {
    var nm = document.getElementById('deviceName').value.trim();
    if (!nm) { espFlashError('Enter a device name.'); return false; }
    var brd = document.getElementById('boardSelect').value;
    if (!brd) { espFlashError('Select a board.'); return false; }
    if (brd === '__custom__' && !document.getElementById('customBoard').value.trim()) {
      espFlashError('Enter a custom board ID.'); return false;
    }
  }
  if (n === 3) {
    var eth = document.getElementById('useEthernet').checked;
    if (!eth) {
      if (!document.getElementById('wifiSsid').value.trim()) { espFlashError('Enter WiFi SSID.'); return false; }
      if (!document.getElementById('wifiPass').value.trim()) { espFlashError('Enter WiFi password.'); return false; }
    }
    if (!document.getElementById('mqttHost').value.trim()) { espFlashError('Enter MQTT broker IP.'); return false; }
  }
  return true;
}

function updateStep1UI() {
  var useOTA = document.getElementById('useOTA').checked;
  var usb = document.getElementById('portSelect').value;
  var otaIp = document.getElementById('otaIp').value.trim();
  var hasInstall = document.getElementById('installPanel').style.display === 'none';
  var ready = useOTA ? !!otaIp : !!usb;
  var summary = document.getElementById('step1Summary');
  var note = document.getElementById('step1Note');
  var btn = document.getElementById('btn1Next');
  var selected = null;
  try { selected = (Array.isArray(installerDevices) && window.selectedInstallerDeviceId) ? installerDevices.find(function(x){ return Number(x.id) === Number(window.selectedInstallerDeviceId); }) : null; } catch (_) {}
  var hasKnownIp = !!(selected && (selected.ip_address || selected.target_ip));
  var hasKnownSerial = !!(selected && (selected.serial_port || selected.target_port));
  var likelyExisting = !!selected;
  var recommendedMode = (likelyExisting && hasKnownIp && !hasKnownSerial) ? 'ota' : 'usb';

  if (btn) {
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '.65';
    btn.style.cursor = ready ? 'pointer' : 'not-allowed';
  }

  var parts = [];
  parts.push(summaryPill(useOTA ? 'Mode: OTA' : 'Mode: USB', useOTA ? '#1d8cff' : '#22d97a', useOTA ? 'rgba(29,140,255,.28)' : 'rgba(34,217,122,.28)'));
  parts.push(summaryPill(useOTA ? ('Target: ' + (otaIp || 'missing IP')) : ('Port: ' + (usb || 'not selected')), ready ? '#22d97a' : '#f59e0b', ready ? 'rgba(34,217,122,.28)' : 'rgba(245,158,11,.35)'));
  parts.push(summaryPill(hasInstall ? 'ESPHome ready' : 'ESPHome not installed', hasInstall ? '#22d97a' : '#f59e0b', hasInstall ? 'rgba(34,217,122,.28)' : 'rgba(245,158,11,.35)'));
  parts.push(summaryPill('Recommended: ' + (recommendedMode === 'ota' ? 'OTA' : 'USB'), recommendedMode === (useOTA ? 'ota' : 'usb') ? '#22d97a' : '#f59e0b', recommendedMode === (useOTA ? 'ota' : 'usb') ? 'rgba(34,217,122,.22)' : 'rgba(245,158,11,.28)'));

  if (summary) summary.innerHTML = parts.join('');
  if (note) {
    if (useOTA) {
      note.textContent = ready
        ? (recommendedMode === 'ota'
          ? 'OTA mode selected. Good choice for an already flashed device with a known IP address.'
          : 'OTA mode selected. Use this only for devices already flashed with ESPHome. For first-time flashing, USB is safer.')
        : 'Enter the current device IP address to continue with OTA flashing.';
    } else {
      note.textContent = ready
        ? (recommendedMode === 'usb'
          ? 'USB target selected. This is the recommended path for first-time flashing and recovery.'
          : 'USB target selected. This is still safe, but this device also looks eligible for OTA reflash.')
        : 'Connect a board via USB-C and select the detected serial port to continue.';
    }
  }
}

function renderFlashReviewSummary(mode) {
  var payload = buildPayload();
  var boardSel = document.getElementById('boardSelect');
  var boardLabel = boardSel && boardSel.selectedIndex >= 0 ? boardSel.options[boardSel.selectedIndex].text : (payload.board_profile_id || '—');
  var transport = document.getElementById('useOTA').checked
    ? ('OTA → ' + (document.getElementById('otaIp').value.trim() || 'missing IP'))
    : ('USB → ' + (document.getElementById('portSelect').value || 'not selected'));
  var entityCount = (payload.entities || []).length;
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
  html += summaryPill('Device: ' + (payload.device_name || '—'), '#22d97a', 'rgba(34,217,122,.28)');
  html += summaryPill('Board: ' + boardLabel, '#1d8cff', 'rgba(29,140,255,.28)');
  html += summaryPill(transport, '#f59e0b', 'rgba(245,158,11,.35)');
  html += summaryPill('Entities: ' + entityCount, 'var(--text)', 'var(--line)');
  html += summaryPill('Adapter: ' + (payload.integration_key || 'esphome'), '#1d8cff', 'rgba(29,140,255,.20)');
  html += summaryPill(payload.config_source === 'use_my_yaml_overlay' ? 'Managed YAML overlay' : 'Managed board profile', '#22d97a', 'rgba(34,217,122,.20)');
  if (payload.existing_device_id) html += summaryPill('Reflash existing card', '#22d97a', 'rgba(34,217,122,.20)');
  html += '</div>';
  if (mode === 'running') {
    html += '<div style="font-size:11px;color:var(--muted2)">Compilation and flashing started. Keep this page open while the Raspberry Pi builds the firmware.</div>';
  } else if (mode === 'done') {
    html += '<div style="font-size:11px;color:var(--good)">Flash finished successfully. The device should appear in Installer after it boots and connects.</div>';
  } else if (mode === 'error') {
    html += '<div style="font-size:11px;color:var(--bad)">Flash finished with an error. Review the terminal output below.</div>';
  } else {
    html += '<div style="font-size:11px;color:var(--muted2)">' + escHtml(flashReviewModeText()) + '</div>';
  }
  document.getElementById('flashStatus').innerHTML = html;
}


var currentFlashJobId = null;
var currentFlashLogCount = 0;
var flashPollTimer = null;

function setReflashNotice(payload) {
  var el = document.getElementById('flashReflashNotice');
  if (!el) return;
  payload = payload || buildPayload();
  if (payload.existing_device_id) {
    el.style.display = '';
    el.innerHTML = '<strong>Reflash existing card.</strong> ' + escHtml(flashReviewModeText()) + '<div style="margin-top:6px;font-size:11px">Nothing from the side panels is written into YAML unless you clicked their own Add / Import actions. This flash uses the current wizard values below.</div>';
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function stopFlashPolling() {
  if (flashPollTimer) { clearInterval(flashPollTimer); flashPollTimer = null; }
}

function appendJobLogOutput(text) {
  if (!text) return;
  var lines = String(text).split(/\r?\n/).filter(Boolean);
  if (lines.length <= currentFlashLogCount) return;
  lines.slice(currentFlashLogCount).forEach(function(line) {
    var level = /error|failed/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info';
    termLine(level, line.replace(/^\[[^\]]+\]\s*/, ''));
  });
  currentFlashLogCount = lines.length;
}

async function pollFlashJob() {
  if (!currentFlashJobId) return;
  try {
    var data = await api('/esphome/jobs/' + encodeURIComponent(currentFlashJobId));
    appendJobLogOutput(data.output_log || '');
    if (['queued','running'].indexOf(String(data.status || '').toLowerCase()) >= 0) return;
    if (String(data.status || '').toLowerCase() === 'success') {
      stopFlashPolling();
      resetFlashUI('done');
      document.getElementById('flashDone').style.display = '';
      renderFlashReviewSummary('done');
      try { await refreshPorts(); } catch (e) {}
      try { await loadInstallerDevices(); } catch (e) {}
      return;
    }
    if (['failed','cancelled','error'].indexOf(String(data.status || '').toLowerCase()) >= 0) {
      stopFlashPolling();
      resetFlashUI('error');
      renderFlashReviewSummary('error');
      if (data.error_text) termLine('error', data.error_text);
    }
  } catch (e) {
    termLine('warn', 'Job status check failed: ' + e.message);
    stopFlashPolling();
  }
}

function startFlashPolling(jobId) {
  stopFlashPolling();
  currentFlashJobId = jobId || null;
  currentFlashLogCount = 0;
  if (!currentFlashJobId) return;
  flashPollTimer = setInterval(pollFlashJob, 2500);
  pollFlashJob();
}
// ── Step 1: flash mode ─────────────────────────────────────────────────────
function onFlashModeChange() {
  var ota = document.getElementById('useOTA').checked;
  document.getElementById('usbPortRow').style.display = ota ? 'none' : '';
  document.getElementById('otaRow').style.display    = ota ? '' : 'none';
  updateStep1UI();
  renderEspModeBanner();
}

// ── Step 3: network ────────────────────────────────────────────────────────
function onNetChange() {
  var eth = document.getElementById('useEthernet').checked;
  document.getElementById('wifiFields').style.display = eth ? 'none' : '';
  document.getElementById('ethInfo').style.display    = eth ? '' : 'none';
}


function autoMatchExistingDeviceId(payload) {
  try {
    var chosen = (typeof window !== 'undefined' && window.selectedInstallerDeviceId) ? Number(window.selectedInstallerDeviceId) : null;
    if (chosen) return chosen;
    var rows = [];
    if (typeof installerDevicesRaw !== 'undefined' && Array.isArray(installerDevicesRaw) && installerDevicesRaw.length) rows = installerDevicesRaw.slice();
    else if (typeof installerDevices !== 'undefined' && Array.isArray(installerDevices) && installerDevices.length) rows = installerDevices.slice();
    if (!rows.length) return null;
    var boardId = String(payload.board_profile_id || '').trim().toLowerCase();
    var name = String(payload.device_name || '').trim().toLowerCase();
    var port = String(payload.port || '').trim().toLowerCase();
    var isSerial = /^\/dev\//.test(port);
    var best = null;
    var bestScore = -1;
    rows.forEach(function(row) {
      var score = 0;
      var rowBoard = String(row.board_profile_id || '').trim().toLowerCase();
      var rowName = String(row.name || row.friendly_name || '').trim().toLowerCase();
      var rowIp = String(row.ip_address || row.target_ip || '').trim().toLowerCase();
      var rowPort = String(row.serial_port || row.target_port || '').trim().toLowerCase();
      if (boardId && rowBoard && boardId === rowBoard) score += 12;
      if (name && rowName && name === rowName) score += 18;
      if (port && isSerial && rowPort && port === rowPort) score += 40;
      if (port && !isSerial && rowIp && port === rowIp) score += 46;
      if (String(row.status || '').toLowerCase() === 'online') score += 8;
      else if (String(row.status || '').toLowerCase() === 'flashed') score += 5;
      var updated = new Date(row.updated_at || row.job_finished_at || row.created_at || 0).getTime();
      if (Number.isFinite(updated) && updated > 0) score += Math.min(10, Math.max(0, Math.round((Date.now() - updated) / -600000) + 10));
      if (score > bestScore) { bestScore = score; best = row; }
    });
    return bestScore >= 30 && best ? Number(best.id) : null;
  } catch (e) {
    return null;
  }
}

function buildPayload() {
  var boardId   = document.getElementById('boardSelect').value;
  var boardInfo = boards.find(function(b) { return b.id === boardId; }) || {};
  var payload = {
    device_name: document.getElementById('deviceName').value.trim(),
    device_id: (document.getElementById('deviceId').value || '').trim() || undefined,
    board_profile_id: boardId,
    board_custom: document.getElementById('customBoard').value.trim(),
    platform: boardInfo.platform || 'esp32',
    variant: boardInfo.variant || null,
    wifi_ssid: document.getElementById('wifiSsid').value.trim(),
    wifi_pass: document.getElementById('wifiPass').value,
    use_ethernet: document.getElementById('useEthernet').checked,
    mqtt_host: document.getElementById('mqttHost').value.trim(),
    port: document.getElementById('useOTA').checked
      ? (document.getElementById('otaIp').value.trim() || null)
      : (document.getElementById('portSelect').value || null),
    entities: collectEntities(),
    existing_device_id: null,
    integration_key: 'esphome',
    ownership_mode: 'managed_internal',
    config_source: 'board_profile',
    read_only: 0,
  };
  payload.existing_device_id = autoMatchExistingDeviceId(payload);
  return payload;
}

function rememberInstallerContext(payload) {
  try {
    payload = payload || buildPayload();
    localStorage.setItem('elaris_installer_board_profile_id', payload.board_profile_id || '');
    localStorage.setItem('elaris_installer_device_name', payload.device_name || '');
  } catch(e) {}
}

function installerContextUrl() {
  var payload = buildPayload();
  var qs = new URLSearchParams();
  if (payload.device_name) qs.set('device', payload.device_name);
  if (payload.board_profile_id) qs.set('board', payload.board_profile_id);
  var q = qs.toString();
  return '/installer.html' + (q ? ('?' + q) : '');
}

function setFlashButtonState(mode) {
  var btn = document.getElementById('btnFlash');
  if (!btn) return;
  if (mode === 'running') {
    btn.innerHTML = '&#9203; Flashing…';
    btn.disabled = true;
    btn.onclick = function(){};
  } else if (mode === 'done') {
    btn.innerHTML = '&#10003; Open Installer';
    btn.disabled = false;
    btn.onclick = function(){ window.location.href = installerContextUrl(); };
  } else if (mode === 'error') {
    btn.innerHTML = '&#8635; Flash Again';
    btn.disabled = false;
    btn.onclick = startFlash;
  } else {
    btn.innerHTML = '&#9889; Flash Device';
    btn.disabled = false;
    btn.onclick = startFlash;
  }
}

async function buildYamlPreview() {
  var payload = buildPayload();
  document.getElementById('flashDone').style.display = 'none';
  document.getElementById('flashTerminal').innerHTML = '<span style="color:#484f58">Validating configuration…</span>';
  renderFlashReviewSummary('ready');
  try {
    var r = await api('/esphome/validate', { method: 'POST', body: JSON.stringify(payload) });
    generatedYaml = r.yaml || '';
    lastValidation = r.validation || null;
    document.getElementById('yamlPreview').textContent = generatedYaml || '# No YAML generated';
    renderValidationBox(r.validation || { ok:false, errors:['Unknown validation error'], warnings:[] });
    document.getElementById('flashTerminal').innerHTML = '<span style="color:#484f58">Ready. Click Flash Device to start.</span>';
    if (r.validation && r.validation.ok) setFlashButtonState('ready');
    else {
      setFlashButtonState('error');
      document.getElementById('btnFlash').disabled = true;
    }
  } catch (e) {
    lastValidation = null;
    generatedYaml = '';
    document.getElementById('yamlPreview').textContent = '# Validation failed\n# ' + e.message;
    renderValidationBox({ ok:false, errors:[e.message], warnings:[] });
    document.getElementById('flashTerminal').innerHTML = '<span class="tl-error">Validation failed. Fix the config before flashing.</span>';
    setFlashButtonState('error');
    document.getElementById('btnFlash').disabled = true;
  }
}

function renderValidationBox(v) {
  var box = document.getElementById('validationBox');
  if (!box) return;
  var errors = (v && v.errors) || [];
  var warnings = (v && v.warnings) || [];
  box.style.display = '';
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
  html += summaryPill(v && v.ok ? 'Validation: OK' : 'Validation: BLOCKED', v && v.ok ? '#22d97a' : '#ff6b6b', v && v.ok ? 'rgba(34,217,122,.28)' : 'rgba(255,107,107,.35)');
  html += summaryPill('Errors: ' + errors.length, errors.length ? '#ff6b6b' : 'var(--text)', errors.length ? 'rgba(255,107,107,.35)' : 'var(--line)');
  html += summaryPill('Warnings: ' + warnings.length, warnings.length ? '#f59e0b' : 'var(--text)', warnings.length ? 'rgba(245,158,11,.35)' : 'var(--line)');
  html += '</div>';
  if (errors.length) html += '<div style="font-size:11px;color:var(--bad);margin-bottom:6px">' + errors.map(function(x){ return '&#8226; ' + escHtml(x); }).join('<br>') + '</div>';
  if (warnings.length) html += '<div style="font-size:11px;color:var(--warn)">' + warnings.map(function(x){ return '&#8226; ' + escHtml(x); }).join('<br>') + '</div>';
  if (!errors.length && !warnings.length) html += '<div style="font-size:11px;color:var(--muted2)">No validation issues.</div>';
  box.innerHTML = html;
}

async function startFlash() {
  if (flashing) return;
  closeEspPanels();
  var useOTA = document.getElementById('useOTA').checked;
  var port = useOTA
    ? document.getElementById('otaIp').value.trim()
    : document.getElementById('portSelect').value;
  if (!port) {
    espFlashError(useOTA ? 'Enter the device IP address.' : 'Select a USB port first (Step 1).');
    return;
  }

  flashing = true;
  setFlashButtonState('running');
  document.getElementById('btnBack5').disabled = true;
  document.getElementById('btnCancel').style.display = '';
  document.getElementById('flashDone').style.display = 'none';
  document.getElementById('flashTerminal').innerHTML = '';

  try {
    if (!lastValidation || !lastValidation.ok) await buildYamlPreview();
    if (!lastValidation || !lastValidation.ok) throw new Error('Validation failed. Fix the errors before flashing.');
    var payload = buildPayload();
    rememberInstallerContext(payload);
    payload.client_id = esphomeClientId;
    var r = await api('/esphome/flash', { method: 'POST', body: JSON.stringify(payload) });
    if (r.yaml) {
      document.getElementById('yamlPreview').textContent = r.yaml;
    }
    // Store device name for post-flash wait polling
    if (typeof window !== 'undefined') window._lastFlashedDeviceName = payload.device_name || null;
    window._lastFlashPayload = payload; // for retry
    if (r.job_id) startFlashPolling(r.job_id);
    optimisticUpdateInstallerDevice(payload, r.job_id || null);
    renderFlashReviewSummary('running');
    setReflashNotice(payload);
    termLine('info', 'Flash started — compiling firmware (first time can take 5-15 min)…');
    if (r.job_id) termLine('info', 'Tracking flash job #' + r.job_id + ' with live status polling.');
  } catch (e) {
    var rawMsg = String(e && e.message || e || 'Unknown error');
    var msg = (typeof humanEspError === 'function') ? humanEspError(rawMsg) : rawMsg;
    // Port-specific override for missing_target_port_or_ip
    if (/missing_target_port_or_ip/i.test(rawMsg)) {
      msg = useOTA ? 'OTA target IP is missing. Enter the device IP address in Step 1.' : 'USB target port is missing. Select a USB port in Step 1.';
    }
    termLine('error', 'Error: ' + msg);
    resetFlashUI('error');
  }
}

async function cancelFlash() {
  try { await api('/esphome/flash', { method: 'DELETE' }); } catch {}
  stopFlashPolling();
  termLine('warn', '— Cancelled —');
  resetFlashUI('error');
}

function resetFlashUI(mode) {
  flashing = false;
  stopFlashPolling();
  setFlashButtonState(mode || 'ready');
  document.getElementById('btnBack5').disabled = false;
  document.getElementById('btnCancel').style.display = 'none';
  // Hide recovery div when starting a new flash
  if (mode === 'running') {
    var f = document.getElementById('flashFailure');
    if (f) f.style.display = 'none';
    var pw = document.getElementById('flashPostWait');
    if (pw) pw.style.display = 'none';
  }
}

function termLine(level, text) {
  var term = document.getElementById('flashTerminal');
  var d = document.createElement('div');
  var now = new Date();
  var ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  d.innerHTML = '<span class="tl-ts">' + ts + '</span><span class="tl-' + level + '">' + escHtml(text) + '</span>';
  term.appendChild(d);
  term.scrollTop = term.scrollHeight;
}
