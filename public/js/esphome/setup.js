// ── Step 1: check & setup ─────────────────────────────────────────────────
async function checkSetup() {
  try {
    var r = await api('/esphome/check');
    var el = document.getElementById('esphomeStatus');
    if (r.ok) {
      el.innerHTML = '<span class="pill-ok">&#10003; ESPHome ' + escHtml(r.version) + '</span>';
      document.getElementById('installPanel').style.display = 'none';
    } else {
      el.innerHTML = '<span class="pill-err">&#10007; ESPHome not found</span>';
      document.getElementById('installPanel').style.display = '';
    }
    populatePorts(r.ports || []);
    boards = r.boards || [];
    presets = r.presets || {};
    populateBoards();
  } catch (e) {
    document.getElementById('esphomeStatus').innerHTML = '<span class="pill-warn">Could not check: ' + escHtml(e.message) + '</span>';
  }
}

async function installEsphome() {
  document.getElementById('btnInstall').disabled = true;
  document.getElementById('setupTerminal').style.display = '';
  document.getElementById('setupTerminal').innerHTML = '';
  setupTermLine('info', 'Starting installation…');
  try {
    await api('/esphome/setup', { method: 'POST', body: JSON.stringify({ client_id: esphomeClientId }) });
  } catch (e) {
    setupTermLine('error', 'Error: ' + e.message);
    document.getElementById('btnInstall').disabled = false;
  }
}

function setupTermLine(level, text) {
  var term = document.getElementById('setupTerminal');
  var d = document.createElement('div');
  d.innerHTML = '<span class="tl-' + level + '">' + escHtml(text) + '</span>';
  term.appendChild(d);
  term.scrollTop = term.scrollHeight;
}
