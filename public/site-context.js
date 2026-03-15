// public/site-context.js
// Shared sidebar helpers for pages that are not index.html

// ── api() fallback — only defined if not already provided by the page script ─
// Note: this runs before page-specific scripts, so page scripts will override it.
window._siteContextApi = async function(path, opts) {
  const url = path.startsWith('/api') ? path : '/api' + path;
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(opts || {}),
  });
  if (!res.ok) {
    let j = null;
    try { j = await res.json(); } catch {}
    throw new Error((j && j.error) || 'HTTP ' + res.status);
  }
  return res.json();
};
if (typeof api === 'undefined') {
  window.api = window._siteContextApi;
}

// ── Load custom nav pages into #navContainer ──────────────────────────────
async function _loadSiteNav() {
  const container = document.getElementById('navContainer');
  if (!container) return;
  try {
    const d = await fetch('/api/nav/pages').then(r => r.json()).catch(() => ({ pages: [] }));
    const custom = (d.pages || []).filter(p => !p.system);
    if (!custom.length) { container.innerHTML = ''; return; }
    container.innerHTML =
      '<div class="groupTitle">My Pages</div>' +
      '<nav class="nav">' +
      custom.map(p => '<a href="/page.html?id=' + Number(p.id) + '">' + escapeHTML(p.icon || '📄') + ' ' + escapeHTML(p.name) + '</a>').join('') +
      '</nav>';
  } catch {}
}

// ── openPageManager — redirect to dashboard on pages without the modal ────
if (typeof openPageManager === 'undefined') {
  window.openPageManager = function() {
    window.location.href = '/';
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _loadSiteNav);
} else {
  _loadSiteNav();
}
