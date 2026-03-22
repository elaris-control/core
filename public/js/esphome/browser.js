// ── Flow chooser / mode switching ────────────────────────────────────────
var _espFlow = 'wizard';

function setEspFlow(mode) {
  mode = (mode === 'yaml' || mode === 'external') ? mode : 'wizard';
  _espFlow = mode;
  try { localStorage.setItem('esphome_flow_mode', mode); } catch (_) {}

  var isWizard = mode === 'wizard';
  var isYaml = mode === 'yaml';
  var isExternal = mode === 'external';

  ['flowBtnWizard','flowBtnYaml','flowBtnExternal'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = (id === 'flowBtnWizard' && isWizard) || (id === 'flowBtnYaml' && isYaml) || (id === 'flowBtnExternal' && isExternal)
      ? 'btn btnPrimary'
      : 'btn';
  });

  var hint = document.getElementById('espFlowHint');
  if (hint) {
    hint.textContent = isWizard
      ? 'Build and flash firmware using the step-by-step wizard. Select your board, configure IO, review, and flash over USB or OTA.'
      : isYaml
        ? 'Bring your own ESPHome YAML, parse it, and flash it with safer transport guidance and validation.'
        : 'Work with an already existing external ESPHome device using the read-only/native import path.';
  }

  var stepper = document.getElementById('stepper');
  if (stepper) stepper.style.display = isWizard ? 'flex' : 'none';
  var saved = document.getElementById('savedPanel');
  if (saved) saved.style.display = (isWizard || isExternal) ? '' : 'none';
  var tools = document.getElementById('espToolsBar');
  if (tools) tools.style.display = isWizard ? 'flex' : 'none';

  ['step1','step2','step3','step4','step5'].forEach(function(id, idx) {
    var el = document.getElementById(id);
    if (!el) return;
    if (isWizard) {
      if (id === 'step1') el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  var yamlPanel = document.getElementById('useMyYamlPanel');
  if (yamlPanel) yamlPanel.style.display = isYaml ? '' : 'none';
  var externalPanel = document.getElementById('nativeImportPanel');
  if (externalPanel) externalPanel.style.display = isExternal ? '' : 'none';
  var browserPanel = document.getElementById('deviceBrowserPanel');
  if (browserPanel && !isYaml) browserPanel.style.display = 'none';

  ['addPeripheralPanel','peripheralLibraryPanel','profileManagerPanel'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && !isWizard) el.style.display = 'none';
  });

  if (isExternal && typeof nativeImportEnsureRows === 'function') nativeImportEnsureRows();
  if (isExternal && typeof renderNativeImportRows === 'function') renderNativeImportRows();
  if (isExternal && typeof loadNativeImportLookups === 'function') loadNativeImportLookups();
  if (isExternal && typeof nativeRefreshCommandPanel === 'function') nativeRefreshCommandPanel();
  if (isExternal && typeof nativeRenderStateBrowser === 'function') nativeRenderStateBrowser();
}

function initEspFlowChooser() {
  var saved = 'wizard';
  try { saved = localStorage.getItem('esphome_flow_mode') || 'wizard'; } catch (_) {}
  setEspFlow(saved);
}

// ── Device Browser ────────────────────────────────────────────────────────
var _browserDevices = [];
var _browserCurrentSlug = null;
var _browserCurrentYaml = null;

function toggleDeviceBrowser() {
  var p = document.getElementById('deviceBrowserPanel');
  var show = p.style.display === 'none';
  if (show) closeEspPanels('deviceBrowserPanel');
  p.style.display = show ? '' : 'none';
}

async function loadDeviceBrowser() {
  var btn = document.getElementById('browserLoadBtn');
  var status = document.getElementById('browserStatus');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  status.textContent = 'Fetching device list from GitHub...';
  try {
    var r = await fetch('/api/esphome/device-browser/list', { credentials: 'include' });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error);
    _browserDevices = d.devices || [];
    status.textContent = _browserDevices.length + ' devices loaded' + (d.cached ? ' (cached)' : '') + '. Click a device to preview its YAML.';
    filterBrowserList();
  } catch(e) {
    status.style.color = 'var(--bad)';
    status.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'Reload';
}

function filterBrowserList() {
  var q = (document.getElementById('browserSearch').value || '').toLowerCase().trim();
  var filtered = q ? _browserDevices.filter(d => d.slug.includes(q)) : _browserDevices;
  var list = document.getElementById('browserList');
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No devices match.</div>';
    return;
  }
  list.innerHTML = filtered.map(d => {
    var slug = String(d.slug || '');
    var safeId = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
    return '<div onclick="selectBrowserDevice(' + escHtml(JSON.stringify(slug)) + ')" style="padding:9px 12px;cursor:pointer;font-size:12px;font-family:monospace;border-bottom:1px solid var(--line);transition:background .1s" ' +
    'onmouseover="this.style.background=\'rgba(29,140,255,.08)\'" onmouseout="this.style.background=\'\'" ' +
    'id="brow-' + safeId + '">' + escHtml(slug) + '</div>';
  }).join('');
}

async function selectBrowserDevice(slug) {
  _browserCurrentSlug = slug;
  _browserCurrentYaml = null;
  document.getElementById('browserSelectedLabel').textContent = slug;
  document.getElementById('browserImportBtn').style.display = 'none';
  document.getElementById('browserFlashBtn').style.display = 'none';
  var preview = document.getElementById('browserYamlPreview');
  preview.value = 'Fetching YAML...';
  // Highlight selected
  document.querySelectorAll('#browserList div').forEach(el => el.style.background = '');
  var el = document.getElementById('brow-' + slug.replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (el) el.style.background = 'rgba(29,140,255,.15)';
  try {
    var r = await fetch('/api/esphome/device-browser/yaml?device=' + encodeURIComponent(slug), { credentials: 'include' });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error);
    _browserCurrentYaml = d.yaml;
    preview.value = d.yaml;
    document.getElementById('browserImportBtn').style.display = '';
    document.getElementById('browserFlashBtn').style.display = '';
  } catch(e) {
    preview.value = 'Error: ' + e.message;
  }
}

async function importBrowserDevice() {
  if (!_browserCurrentYaml) return;
  var btn = document.getElementById('browserImportBtn');
  btn.disabled = true;
  btn.textContent = 'Parsing...';
  try {
    // Parse
    var r1 = await fetch('/api/esphome/catalog/parse-yaml', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: _browserCurrentYaml })
    });
    var d1 = await r1.json();
    if (!d1.ok) throw new Error(d1.error);
    // Use slug as id if parsed id is empty
    if (!d1.parsed.id) d1.parsed.id = _browserCurrentSlug.replace(/[^a-z0-9]+/g, '_');
    if (!d1.parsed.label) d1.parsed.label = _browserCurrentSlug;
    // Warn if this profile id already exists in the catalog
    var existingProfile = (typeof boards !== 'undefined') && boards.find(function(b) { return b.id === d1.parsed.id; });
    if (existingProfile && !confirm('Profile "' + d1.parsed.id + '" already exists in the catalog. Overwrite it?')) {
      btn.disabled = false; btn.innerHTML = '&#8659; Save to Catalog'; return;
    }
    // Save
    var r2 = await fetch('/api/esphome/catalog/save-parsed', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: d1.parsed, source_url: 'https://devices.esphome.io/devices/' + _browserCurrentSlug + '/' })
    });
    var d2 = await r2.json();
    if (!d2.ok) throw new Error(d2.error);
    // Refresh boards list and auto-select the imported profile
    try {
      var rb = await fetch('/api/esphome/boards', { credentials: 'include' }).then(function(r){ return r.json(); });
      if (rb.ok && rb.boards) { boards = rb.boards; if (typeof populateBoards === 'function') populateBoards(); }
      var sel = document.getElementById('boardSelect');
      if (sel && d2.id) { sel.value = d2.id; if (typeof onBoardChange === 'function') onBoardChange(); }
    } catch(_) {}
    // Close browser panel
    document.getElementById('deviceBrowserPanel').style.display = 'none';
    toast('&#10003; ' + d2.label + ' ready — fill in the details below', true);
    btn.textContent = '&#10003; Imported!';
  } catch(e) {
    toast('Import error: ' + e.message, false);
    btn.disabled = false;
    btn.innerHTML = '&#8659; Import to Catalog';
  }
}

// Flash directly from browser YAML — skips the board catalog dropdown entirely
function browserFlashDevice() {
  if (!_browserCurrentYaml) return;
  var yaml = _browserCurrentYaml;
  // Close browser, open Use-My-YAML panel (toggleUseMyYaml resets its state)
  document.getElementById('deviceBrowserPanel').style.display = 'none';
  if (typeof setEspFlow === 'function') setEspFlow('yaml');
  var p = document.getElementById('useMyYamlPanel');
  if (!p) return;
  if (p.style.display !== 'none') { p.style.display = 'none'; } // force close so toggle opens fresh
  if (typeof toggleUseMyYaml === 'function') toggleUseMyYaml();
  // Pre-fill YAML and auto-parse
  document.getElementById('umyYamlText').value = yaml;
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof umyParse === 'function') umyParse();
}
