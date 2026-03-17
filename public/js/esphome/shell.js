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

      if (msg.type === 'esphome_add_done') {
        apResetFlashUI(msg.ok);
        if (msg.ok) {
          document.getElementById('apDone').style.display = '';
          if (msg.awaiting_report) apTermLine('info', 'Waiting for first MQTT report so ELARIS can auto-register the new IO in Installer…');
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
        if (msg.ok) {
          document.getElementById('installPanel').style.display = 'none';
          try { await checkSetup(); } catch {}
          try { await refreshPorts(); } catch {}
          setupTermLine('info', 'ESPHome is ready. USB ports refreshed.');
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
