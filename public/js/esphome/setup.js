// ── Step 1: check & setup ─────────────────────────────────────────────────
async function checkSetup() {
  try {
    var r = await api('/esphome/check');
    var el = document.getElementById('esphomeStatus');
    var hint = document.getElementById('setupHint');
    if (r.ok) {
      el.innerHTML = '<span class="pill-ok">&#10003; ESPHome ' + escHtml(r.version) + '</span>';
      document.getElementById('installPanel').style.display = 'none';
      if (hint) { hint.style.display = 'none'; hint.innerHTML = ''; }
    } else {
      el.innerHTML = '<span class="pill-err">&#10007; ESPHome not found</span>';
      document.getElementById('installPanel').style.display = '';
      try {
        var prereq = await api('/esphome/setup-prereqs');
        if (hint && prereq && prereq.ensurepip_available === false) {
          hint.style.display = '';
          hint.innerHTML = 'ESPHome cannot be installed yet because Python virtual environment support is missing.<br><strong>Run once on the host:</strong> <code style="user-select:all">' + escHtml(prereq.install_command || 'sudo apt install -y python3-venv') + '</code>';
        }
      } catch (_) {}
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
  var btn = document.getElementById('btnInstall');
  var hint = document.getElementById('setupHint');
  btn.disabled = true;
  if (hint) { hint.style.display = 'none'; hint.innerHTML = ''; }
  document.getElementById('setupTerminal').style.display = '';
  document.getElementById('setupTerminal').innerHTML = '';
  setupTermLine('info', 'Starting installation…');
  try {
    var prereq = await api('/esphome/setup-prereqs');
    if (prereq && prereq.ensurepip_available === false) {
      if (hint) {
        hint.style.display = '';
        hint.innerHTML = 'Missing system dependency for Python virtual environments.<br><strong>Required:</strong> ' + escHtml(prereq.missing_package_hint || 'python3-venv') + '<br><strong>Run once on the host:</strong> <code style="user-select:all">' + escHtml(prereq.install_command || 'sudo apt install -y python3-venv') + '</code>';
      }
      setupTermLine('warn', 'Missing Python venv support. Install the required system package, then retry.');
      setupTermLine('warn', prereq.install_command || 'sudo apt install -y python3-venv');
      btn.disabled = false;
      return;
    }
    await api('/esphome/setup', { method: 'POST', body: JSON.stringify({ client_id: esphomeClientId }) });
  } catch (e) {
    setupTermLine('error', 'Error: ' + e.message);
    btn.disabled = false;
  }
}

function setupTermLine(level, text) {
  var term = document.getElementById('setupTerminal');
  var d = document.createElement('div');
  d.innerHTML = '<span class="tl-' + level + '">' + escHtml(text) + '</span>';
  term.appendChild(d);
  term.scrollTop = term.scrollHeight;
}
