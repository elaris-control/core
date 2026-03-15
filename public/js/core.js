'use strict';
// public/js/core.js — shared utilities loaded by all authenticated pages

// ── DOM shorthand ─────────────────────────────────────────────────────────────
window.$ = id => document.getElementById(id);

// ── XSS-safe HTML escape ──────────────────────────────────────────────────────
window.escapeHTML = s =>
  String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                 .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ── Fetch wrapper — always sends to /api, adds CSRF via csrf.js ───────────────
window.api = async function api(path, opts) {
  const { headers: extra, ...rest } = opts || {};
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(extra || {}) },
  });
  if (!res.ok) {
    let j = null;
    try { j = await res.json(); } catch {}
    throw new Error(j?.error || j?.message || 'HTTP ' + res.status);
  }
  return res.json();
};

// ── Toast notification ────────────────────────────────────────────────────────
// Usage:
//   toast('msg')           → neutral, auto-dismiss after 3 s
//   toast('msg', true)     → green (success), auto-dismiss after 2.6 s
//   toast('msg', false)    → red (error), auto-dismiss after 2.6 s
//   toast('msg', 5000)     → neutral, auto-dismiss after 5 s
window.toast = function toast(msg, okOrMs) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg || '';
  const colored = typeof okOrMs === 'boolean';
  const ms      = colored ? 2600 : (typeof okOrMs === 'number' ? okOrMs : 3000);
  if (colored) {
    el.style.display     = 'block';
    el.style.borderColor = okOrMs ? 'rgba(22,163,74,.35)' : 'rgba(220,38,38,.35)';
    el.style.background  = okOrMs ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)';
  } else {
    el.style.display     = '';
    el.style.borderColor = '';
    el.style.background  = '';
  }
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => {
    if (el.textContent === msg) {
      el.textContent = '';
      if (colored) el.style.display = 'none';
    }
  }, ms);
};
