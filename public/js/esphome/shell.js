// ── ESPHome shell / page state ─────────────────────────────────────────────
var currentStep = 1;
var boards = [];
var presets = {};
var entities = [];
var flashing = false;
var ws = null;
var generatedYaml = '';
var lastValidation = null;
var esphomeClientId = 'esph_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
window.__elarisWsClientId = esphomeClientId;

function connectWS() {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host);

  ws.onopen = function() {
    try {
      ws.send(JSON.stringify({ type: 'register_client', clientId: esphomeClientId }));
    } catch {}
  };

  ws.onmessage = async function(e) {
    try {
      var msg = JSON.parse(e.data);

      if (msg.type === 'esphome_log') {
        var umyPanel = document.getElementById('useMyYamlPanel');
        if (umyPanel && umyPanel.style.display !== 'none') {
          var umyTerm = document.getElementById('umyTerminal');
          if (umyTerm) {
            var line = document.createElement('div');
            var level = msg.level === 'warn' ? 'warn' : msg.level === 'error' ? 'error' : 'info';
            line.innerHTML = '<span class="tl-' + level + '">' + escHtml(msg.text || '') + '</span>';
            umyTerm.appendChild(line);
            umyTerm.scrollTop = umyTerm.scrollHeight;
          }
        } else {
          termLine(msg.level || 'info', msg.text || '');
        }
      }

      if (msg.type === 'esphome_done') {
        var useMyYamlPanel = document.getElementById('useMyYamlPanel');
        if (useMyYamlPanel && useMyYamlPanel.style.display !== 'none') {
          if (typeof onEsphomeDoneFromUseMyYaml === 'function') onEsphomeDoneFromUseMyYaml(msg.ok, msg.code);
        } else {
          resetFlashUI(msg.ok ? 'done' : 'error');
          if (msg.ok) {
            document.getElementById('flashDone').style.display = '';
            renderFlashReviewSummary('done');
            try { await refreshPorts(); } catch {}
            try { await loadInstallerDevices(); } catch {}
          } else {
            renderFlashReviewSummary('error');
            termLine('error', 'Flash failed. Check the output above.');
          }
        }
      }

      if (msg.type === 'esphome_add_log') {
        apTermLine(msg.level || 'info', msg.text || '');
      }

      if (msg.type === 'esphome_add_done' || msg.type === 'esphome_peripheral_done') {
        apResetFlashUI(msg.ok, msg.action);
        if (msg.ok) {
          apShowDoneState(msg.action, !!msg.awaiting_report, msg.entity_key || '');
          if (msg.awaiting_report) {
            apTermLine('info', 'Firmware flash completed. Waiting for the device to reboot and publish its updated MQTT config…');
            apTermLine('info', 'Installer should show the new or updated IO shortly. If not, refresh Installer after ~30 seconds.');
          } else {
            apTermLine('info', 'OTA action completed. Refresh Installer if the updated device state does not appear automatically.');
          }
          try { await loadInstallerDevices(); } catch {}
        } else {
          apTermLine('error', 'Flash failed. Check the output above.');
        }
      }

      if (msg.type === 'esphome_setup_log') {
        setupTermLine(msg.level || 'info', msg.text || '');
      }

      if (msg.type === 'esphome_setup_done') {
        document.getElementById('btnInstall').disabled = false;
        var hint = document.getElementById('setupHint');
        if (msg.ok) {
          if (hint) { hint.style.display = 'none'; hint.innerHTML = ''; }
          document.getElementById('installPanel').style.display = 'none';
          try { await checkSetup(); } catch {}
          try { await refreshPorts(); } catch {}
          setupTermLine('info', 'ESPHome is ready. USB ports refreshed.');
        } else if (hint && msg.hint) {
          hint.style.display = '';
          hint.innerHTML = escHtml(msg.hint) + (msg.install_command ? '<br><strong>Run once on the host:</strong> <code style="user-select:all">' + escHtml(msg.install_command) + '</code>' : '');
        }
      }
    } catch {}
  };

  ws.onclose = function() { setTimeout(connectWS, 3000); };
}

async function api(path, opts) {
  var headers = { 'Content-Type': 'application/json' };
  var csrfEl = document.querySelector('meta[name="csrf-token"]');
  if (csrfEl) headers['X-CSRF-Token'] = csrfEl.content;
  var r = await fetch('/api' + path, Object.assign({ credentials: 'include', headers: headers }, opts || {}));
  var d = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}

(function() {
  var mq = window.matchMedia('(max-width:768px)');
  function check() {
    var btn = document.getElementById('menuBtn');
    if (btn) btn.style.display = mq.matches ? '' : 'none';
  }
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', check);
  else if (typeof mq.addListener === 'function') mq.addListener(check);
  window.addEventListener('DOMContentLoaded', check);
})();

function toggleGuide() {
  var p = document.getElementById('guidePanel');
  if (!p) return;
  var visible = p.style.display !== 'none';
  p.style.display = visible ? 'none' : 'block';
  if (!visible) showGuideTab(1);
}

function showGuideTab(n) {
  [1,2,3].forEach(function(i) {
    var tab = document.getElementById('guideTab' + i);
    if (tab) tab.style.display = i === n ? 'block' : 'none';
    var btn = document.getElementById('guideTab' + i + 'Btn');
    if (btn) {
      btn.style.borderColor = i === n ? 'var(--blue)' : '';
      btn.style.color = i === n ? 'var(--blue)' : '';
    }
  });
}

async function initEsphomePage() {
  try {
    var r = await fetch('/api/me', { credentials: 'include' });
    var d = await r.json();
    if (!d.ok || !d.user) { location.href = '/login.html'; return; }
    var mqttHost = document.getElementById('mqttHost');
    if (mqttHost) mqttHost.value = location.hostname;
  } catch {
    location.href = '/login.html';
    return;
  }

  connectWS();
  setFlashButtonState('ready');
  onFlashModeChange();
  updateStep1UI();
  if (typeof initEspFlowChooser === 'function') initEspFlowChooser();
  await checkSetup();
  try { await refreshPorts(); } catch {}
  await loadInstallerDevices();
  await loadSavedConfigs();
  setInterval(function() { loadInstallerDevices(); }, 8000);
}

window.addEventListener('DOMContentLoaded', function() {
  initEsphomePage().catch(function(err) {
    console.error('ESPHome init failed', err);
  });
});
