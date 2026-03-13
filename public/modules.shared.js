// public/modules.shared.js
// Shared helpers for the Modules page

// ── API helper ────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let j = null;
    try { j = await res.json(); } catch {}
    throw new Error(j?.error || ('HTTP ' + res.status));
  }
  return res.json();
}

async function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Category tabs ─────────────────────────────────────────────────────────
function renderCatTabs(categories) {
  const el = document.getElementById('catTabs');
  if (!el) return;
  const cats = [{ id: 'all', name: 'All', label: 'All' }, ...(categories || [])];
  el.innerHTML = cats.map(c =>
    `<button class="cat-tab ${activeCat === c.id ? 'active' : ''}"
             onclick="activeCat='${c.id}'; renderCatTabs(window._categories); renderDefs()">
       ${c.icon ? c.icon + ' ' : ''}${c.label || c.name || c.id}
     </button>`
  ).join('');
}

// ── Module definition cards ───────────────────────────────────────────────
function renderDefs() {
  const el = document.getElementById('defGrid');
  if (!el) return;
  const filtered = activeCat === 'all' ? defs : defs.filter(d => d.category === activeCat);
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No modules in this category.</div></div>';
    return;
  }
  el.innerHTML = filtered.map(d =>
    `<div class="def-card" id="def_${d.id}" style="--card-accent:${d.color || 'var(--blue)'}"
          onclick="selectDef('${d.id}')">
       <div class="def-icon">${d.icon || '📦'}</div>
       <div class="def-name">${d.name}</div>
       <div class="def-desc">${d.description || ''}</div>
       <div class="def-meta">${d.id}</div>
     </div>`
  ).join('');
}

// ── Custom module helpers ─────────────────────────────────────────────────
async function resetCustomAlarms(instId) {
  if (!confirm('Reset all latched alarms for this module?')) return;
  try {
    await api(`/api/automation/instances/${instId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command: 'reset_alarm' }),
    });
    toast('Alarms reset');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

async function resetCustomLock(instId) {
  if (!confirm('Reset engineer lock? Requires Engineer role.')) return;
  try {
    await api(`/api/automation/instances/${instId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command: 'reset_lock' }),
    });
    toast('Lock reset');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}
