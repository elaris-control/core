// public/modules.shared.js
// Shared helpers for the Modules page — NO api() or toast() (those live in core.js)

// ── Category tabs ─────────────────────────────────────────────────────────
function renderCatTabs(categories) {
  const el = document.getElementById('catTabs');
  if (!el) return;
  const cats = [{ id: 'all', name: 'All', label: 'All' }, ...(categories || [])];
  el.innerHTML = cats.map(c => {
    const safeId = String(c.id || '').replace(/'/g, '\\&#39;').replace(/"/g, '&quot;');
    const safeLabel = escHtml(c.label || c.name || c.id);
    const safeIcon = c.icon ? escHtml(c.icon) + ' ' : '';
    return `<button class="cat-tab ${activeCat === c.id ? 'active' : ''}"
             onclick="activeCat='${safeId}'; renderCatTabs(window._categories); renderDefs()">
       ${safeIcon}${safeLabel}
     </button>`;
  }).join('');
}

// ── Module definition cards ───────────────────────────────────────────────
function renderDefs() {
  const el = document.getElementById('defGrid');
  if (!el) return;
  const filtered = activeCat === 'all' ? defs : defs.filter(d => d.category === activeCat);
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">\uD83D\uDD0D</div><div class="empty-text">No modules in this category.</div></div>';
    return;
  }
  el.innerHTML = filtered.map(d => {
    const safeId = String(d.id || '').replace(/'/g, '\\&#39;').replace(/"/g, '&quot;');
    const safeName = escHtml(d.name || '');
    const safeDesc = escHtml(d.description || '');
    const safeIcon = escHtml(d.icon || '\uD83D\uDCE6');
    const safeColor = d.color || 'var(--blue)';
    return `<div class="def-card" id="def_${safeId}" style="--card-accent:${safeColor}"
          onclick="selectDef('${safeId}')">
       <div class="def-icon">${safeIcon}</div>
       <div class="def-name">${safeName}</div>
       <div class="def-desc">${safeDesc}</div>
       <div class="def-meta">${safeId}</div>
     </div>`;
  }).join('');
}

// ── Custom module helpers ─────────────────────────────────────────────────
async function resetCustomAlarms(instId) {
  if (!confirm('Reset all latched alarms for this module?')) return;
  try {
    await api(`/automation/instances/${instId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command: 'reset_alarm' }),
    });
    toast('Alarms reset', true);
  } catch (e) { toast('Error: ' + e.message, false); }
}

async function resetCustomLock(instId) {
  if (!confirm('Reset engineer lock? Requires Engineer role.')) return;
  try {
    await api(`/automation/instances/${instId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command: 'reset_lock' }),
    });
    toast('Lock reset', true);
  } catch (e) { toast('Error: ' + e.message, false); }
}
