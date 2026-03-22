// ── Utils ──────────────────────────────────────────────────────────────────

// ── Human-readable error messages ─────────────────────────────────────────
var _espErrorMessages = {
  esphome_not_installed:       'ESPHome is not installed. Use the Install button at the top of this page first.',
  flash_in_progress:           'A flash is already running. Wait for it to complete or cancel it first.',
  setup_in_progress:           'Installation is already in progress. Please wait.',
  missing_target_port_or_ip:   'Select a USB port or enter an IP address before flashing.',
  unknown_board_profile:       'Unknown board profile. Select a board from the catalog and try again.',
  validation_failed:           'Config validation failed. Check your board settings and try again.',
  missing_python_venv_support: 'Python virtual environment support is missing on this host. Install the required system package and retry.',
  esphome_not_configured:      'ESPHome is not configured for this device. Run the flash wizard first.',
  device_not_found:            'Device not found. It may have been deleted or is not yet registered.',
  io_not_found:                'IO not found. The device mapping may be out of date.',
  forbidden:                   'You do not have permission to perform this action.',
  not_authenticated:           'You are not logged in. Please refresh the page and log in.',
};

function humanEspError(keyOrMsg) {
  if (!keyOrMsg) return 'An unexpected error occurred.';
  var s = String(keyOrMsg);
  return _espErrorMessages[s] || (s.length < 60 ? s : s.slice(0, 120) + '…');
}

// ── Flash failure categoriser ──────────────────────────────────────────────
function classifyFlashFailure(logText) {
  var t = String(logText || '').toLowerCase();
  if (/permission denied/i.test(t))             return { icon: '🔒', hint: 'Permission denied on USB port. Add your user to the dialout group: sudo usermod -aG dialout $USER — then log out and back in.' };
  if (/no such file|port.*not found|cannot open/i.test(t)) return { icon: '🔌', hint: 'USB port not found. Check the USB cable, try a different port, and make sure the board is plugged in.' };
  if (/ota.*timeout|connection refused|connection timed out/i.test(t)) return { icon: '📡', hint: 'OTA/network timeout. Make sure the device is on the same network and try USB serial flash instead.' };
  if (/no module named|importerror|pip.*error/i.test(t)) return { icon: '🐍', hint: 'Python dependency error. Try re-installing ESPHome using the Install button above.' };
  if (/ensurepip|venv/i.test(t))                return { icon: '🐍', hint: 'Python venv issue. Install the required system package and re-run ESPHome setup.' };
  if (/invalid yaml|yaml.*error|mapping.*error/i.test(t)) return { icon: '📄', hint: 'YAML configuration error. Review the generated YAML for syntax problems.' };
  if (/esptool|failed to connect|wrong boot mode/i.test(t)) return { icon: '⚡', hint: 'Could not connect to the chip. Hold the BOOT button while flashing, or try a different USB cable.' };
  return { icon: '⚠️', hint: 'Flash failed. Check the log above for details, or try again.' };
}
function pad2(n) { return String(n).padStart(2,'0'); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function summaryPill(text, color, border) {
  return '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;background:rgba(255,255,255,.04);color:' + (color || 'var(--muted2)') + ';border:1px solid ' + (border || 'var(--line)') + '">' + escHtml(text) + '</span>';
}


function esphomeAuxPanelIds() {
  return [
    'peripheralLibraryPanel',
    'addPeripheralPanel',
    'deviceBrowserPanel',
    'yamlImportPanel',
    'profileManagerPanel',
    'useMyYamlPanel',
    'nativeImportPanel'
  ];
}

function closeEspPanels(exceptId) {
  esphomeAuxPanelIds().forEach(function(id) {
    if (exceptId && id === exceptId) return;
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  renderEspModeBanner();
}

function flashReviewModeText() {
  try {
    return (typeof window !== 'undefined' && window.selectedInstallerDeviceId)
      ? 'Reflash mode — this run updates the selected managed internal card and overwrites its generated YAML/config.'
      : 'New flash mode — a new managed internal installer device card will be created when the board comes online.';
  } catch (e) {
    return 'Review the target and config below before flashing.';
  }
}


function espModeState() {
  try {
    var addPanel = document.getElementById('addPeripheralPanel');
    var addVisible = !!(addPanel && addPanel.style.display !== 'none');
    if (addVisible) {
      return {
        key: 'modify',
        title: 'Modify existing device',
        detail: (typeof _apMode !== 'undefined' && _apMode === 'edit')
          ? 'Edit / reassign / remove peripherals on an already flashed device. This is separate from the main new-flash / reflash wizard.'
          : 'Add / remove peripherals on an already flashed device via OTA. This is separate from the main new-flash / reflash wizard.',
        pill: 'Modify existing device',
        color: '#f59e0b',
        border: 'rgba(245,158,11,.35)',
        actionText: 'Back to flash wizard',
        action: 'exitEspModifyMode()'
      };
    }
    var nativePanel = document.getElementById('nativeImportPanel');
    var nativeVisible = !!(nativePanel && nativePanel.style.display !== 'none');
    if (nativeVisible) {
      return {
        key: 'external_native',
        title: 'External native import',
        detail: 'Import an already-described external device as a read-only card. This does not provision or rewrite the device; it only creates the ELARIS card and pending approval rows.',
        pill: 'External native import',
        color: '#1d8cff',
        border: 'rgba(29,140,255,.30)',
        actionText: 'Close import panel',
        action: "document.getElementById('nativeImportPanel').style.display='none';renderEspModeBanner();"
      };
    }
    if (typeof window !== 'undefined' && window.selectedInstallerDeviceId) {
      return {
        key: 'reflash',
        title: 'Reflash mode',
        detail: 'This wizard updates the selected managed internal installer card and overwrites its generated YAML/config. It should not create a second card when the same physical board is rebound correctly.',
        pill: 'Reflash existing card',
        color: '#22d97a',
        border: 'rgba(34,217,122,.28)',
        actionText: 'Clear reflash target',
        action: 'clearSelectedInstallerDevice()'
      };
    }
    return {
      key: 'new',
      title: 'New flash mode',
      detail: 'This wizard creates a new managed internal installer device card when the board comes online. Use this for a brand new board or when you intentionally want a brand new device identity.',
      pill: 'New flash',
      color: '#1d8cff',
      border: 'rgba(29,140,255,.30)',
      actionText: '',
      action: ''
    };
  } catch (e) {
    return { key: 'unknown', title: 'ESPHome mode', detail: 'Review the target and config below before flashing.', pill: 'Mode', color: 'var(--text)', border: 'var(--line)', actionText: '', action: '' };
  }
}

function renderEspModeBanner() {
  var el = document.getElementById('esphomeModeBanner');
  if (!el) return;
  var mode = espModeState();
  try { if (typeof updateBoardSelectionUX === 'function') updateBoardSelectionUX(); } catch (e) {}
  var html = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">'
    + '<div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">'
    + summaryPill(mode.pill, mode.color, mode.border)
    + '<strong style="font-size:12px">' + escHtml(mode.title) + '</strong>'
    + '</div><div style="font-size:11px;color:var(--muted2)">' + escHtml(mode.detail) + '</div></div>'
    + (mode.actionText ? ('<button class="btn" type="button" onclick="' + mode.action + '" style="font-size:11px;padding:5px 10px">' + escHtml(mode.actionText) + '</button>') : '')
    + '</div>';
  el.innerHTML = html;
  el.style.display = '';
}

function exitEspModifyMode() {
  closeEspPanels();
  renderEspModeBanner();
}
