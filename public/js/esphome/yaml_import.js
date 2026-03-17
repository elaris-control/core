// ── YAML Board Importer ────────────────────────────────────────────────────
var _parsedYamlProfile = null;

function toggleYamlImporter() {
  var p = document.getElementById('yamlImportPanel');
  var show = p.style.display === 'none';
  if (show) closeEspPanels('yamlImportPanel');
  p.style.display = show ? '' : 'none';
}

async function fetchYamlFromUrl() {
  var url = document.getElementById('yamlUrl').value.trim();
  if (!url) return;
  document.getElementById('yamlParseMsg').textContent = 'Fetching…';
  try {
    var r = await api('/esphome/catalog/parse-yaml', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    if (!r.ok) throw new Error(r.error);
    document.getElementById('yamlText').value = '(fetched from URL — parsed directly)';
    showYamlPreview(r.parsed, url);
  } catch(e) {
    document.getElementById('yamlParseMsg').textContent = 'Error: ' + e.message;
  }
}

async function parseYaml() {
  var text = document.getElementById('yamlText').value.trim();
  var url  = document.getElementById('yamlUrl').value.trim();
  if (!text && !url) { document.getElementById('yamlParseMsg').textContent = 'Paste YAML or enter a URL.'; return; }
  document.getElementById('yamlParseMsg').textContent = 'Parsing…';
  try {
    var r = await api('/esphome/catalog/parse-yaml', {
      method: 'POST',
      body: JSON.stringify({ yaml: text, url: url }),
    });
    if (!r.ok) throw new Error(r.error);
    showYamlPreview(r.parsed, url);
  } catch(e) {
    document.getElementById('yamlParseMsg').textContent = 'Error: ' + e.message;
  }
}

function showYamlPreview(parsed, sourceUrl) {
  _parsedYamlProfile = parsed;
  document.getElementById('yamlParseMsg').textContent =
    (parsed.entityDefaults || []).length + ' entities found.';
  document.getElementById('yamlProfileId').value    = parsed.id || '';
  document.getElementById('yamlProfileLabel').value = parsed.label || '';

  var counts = {};
  (parsed.entityDefaults || []).forEach(function(e) { counts[e.type] = (counts[e.type]||0)+1; });
  var summary = Object.entries(counts).map(function(kv){ return kv[1]+'× '+kv[0]; }).join('  |  ');

  var list = document.getElementById('yamlEntityList');
  list.innerHTML =
    '<div style="margin-bottom:6px;color:var(--muted)">' + escHtml(summary || 'No entities') + '</div>' +
    (parsed.entityDefaults || []).map(function(e) {
      return '<div>' + escHtml(e.type.padEnd(10)) + ' ' +
        escHtml((e.source||e.pin||'').padEnd(10)) + ' ' +
        escHtml(e.name||'') + '</div>';
    }).join('');

  document.getElementById('yamlPreview').style.display = '';
  document.getElementById('yamlSaveMsg').textContent = '';
}

async function saveYamlProfile() {
  if (!_parsedYamlProfile) return;
  var id    = document.getElementById('yamlProfileId').value.trim();
  var label = document.getElementById('yamlProfileLabel').value.trim();
  if (!id || !label) { document.getElementById('yamlSaveMsg').textContent = 'Fill in ID and Label.'; return; }
  _parsedYamlProfile.id = id;
  _parsedYamlProfile.label = label;
  document.getElementById('yamlSaveMsg').textContent = 'Saving…';
  try {
    var r = await api('/esphome/catalog/save-parsed', {
      method: 'POST',
      body: JSON.stringify({ profile: _parsedYamlProfile, source_url: document.getElementById('yamlUrl').value.trim() }),
    });
    if (!r.ok) throw new Error(r.error);
    document.getElementById('yamlSaveMsg').textContent = 'Saved! Refreshing boards…';
    var status = await api('/esphome/check');
    boards = status.boards || [];
    presets = status.presets || {};
    populateBoards();
    if (typeof profileManagerRefresh === 'function' && document.getElementById('profileManagerPanel') && document.getElementById('profileManagerPanel').style.display !== 'none') {
      profileManagerRefresh();
    }
    document.getElementById('yamlSaveMsg').textContent = 'Board "' + escHtml(label) + '" saved.';
    // Show "Continue to Flash" CTA
    var cta = document.getElementById('yamlContinueFlashCta');
    if (cta) {
      cta.style.display = 'block';
      cta.onclick = function() {
        document.getElementById('yamlImportPanel').style.display = 'none';
        var sel = document.getElementById('boardSelect');
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === id) { sel.selectedIndex = i; onBoardChange(); break; }
        }
        goStep(2);
      };
    }
  } catch(e) {
    document.getElementById('yamlSaveMsg').textContent = 'Error: ' + e.message;
  }
}
