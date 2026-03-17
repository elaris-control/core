// ── Utils ──────────────────────────────────────────────────────────────────
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
    'useMyYamlPanel'
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
      ? 'Reflash mode — this run updates the selected card and overwrites its generated YAML/config.'
      : 'New flash mode — a new installer device card will be created when the board comes online.';
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
    if (typeof window !== 'undefined' && window.selectedInstallerDeviceId) {
      return {
        key: 'reflash',
        title: 'Reflash mode',
        detail: 'This wizard updates the selected installer card and overwrites its generated YAML/config. It should not create a second card when the same physical board is rebound correctly.',
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
      detail: 'This wizard creates a new installer device card when the board comes online. Use this for a brand new board or when you intentionally want a brand new device identity.',
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
