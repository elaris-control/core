// ELARIS — Mobile bottom navigation (injected on all pages)
(function () {
  if (typeof window === 'undefined') return;

  const items = [
    { href: '/',               icon: '🏠', label: 'Home' },
    { href: '/modules.html',   icon: '⚙️', label: 'Modules' },
    { href: '/scenes.html',    icon: '🎬', label: 'Scenes' },
    { href: '/settings.html',  icon: '👤', label: 'Settings' },
    { href: null,              icon: '📄', label: 'Pages',  action: 'pages' },
    { href: null,              icon: '🌙', label: 'Theme',  action: 'theme' },
  ];

  const path = location.pathname;

  function isActive(href) {
    if (!href) return false;
    if (href === '/' && (path === '/' || path === '/index.html')) return true;
    return path === href || path === href.replace('.html', '');
  }

  // --- Build nav bar ---
  const nav = document.createElement('div');
  nav.id = 'mobileNav';
  nav.innerHTML = '<nav>' + items.map(it => {
    if (it.action) {
      return `<a href="#" data-mn-action="${it.action}" aria-label="${it.label}">
        <span class="mn-icon">${it.icon}</span>
        <span>${it.label}</span>
      </a>`;
    }
    return `<a href="${it.href}" class="${isActive(it.href) ? 'active' : ''}" aria-label="${it.label}">
      <span class="mn-icon">${it.icon}</span>
      <span>${it.label}</span>
    </a>`;
  }).join('') + '</nav>';

  document.body.appendChild(nav);

  // --- Pages slide-up sheet ---
  const sheet = document.createElement('div');
  sheet.id = 'mnPageSheet';
  sheet.innerHTML = `
    <div id="mnPageSheetBg"></div>
    <div id="mnPageSheetPanel" role="dialog" aria-modal="true" aria-label="My Pages">
      <div class="mn-sheet-handle"></div>
      <div class="mn-sheet-title">📄 My Pages</div>
      <div id="mnPageSheetList"><div class="mn-sheet-loading">Loading…</div></div>
    </div>`;
  document.body.appendChild(sheet);

  function openSheet() {
    sheet.classList.add('open');
    document.body.classList.add('mn-sheet-open');
    loadPages();
  }

  function closeSheet() {
    sheet.classList.remove('open');
    document.body.classList.remove('mn-sheet-open');
  }

  function sheetActions() {
    return `
      <button class="mn-sheet-new" onclick="
        var s=document.getElementById('mnPageSheet');
        s&&s.classList.remove('open');
        document.body.classList.remove('mn-sheet-open');
        if(window.openPageEditor){openPageEditor();}
        else{location.href='/?newPage=1';}
      ">+ New Page</button>
      <button class="mn-sheet-edit" onclick="
        var s=document.getElementById('mnPageSheet');
        s&&s.classList.remove('open');
        document.body.classList.remove('mn-sheet-open');
        if(window.openPageManager){openPageManager();}
        else{location.href='/?editPages=1';}
      ">✏️ Edit Pages</button>`;
  }

  async function loadPages() {
    const list = document.getElementById('mnPageSheetList');
    list.innerHTML = '<div class="mn-sheet-loading">Loading…</div>';
    try {
      const d = await fetch('/api/nav/pages').then(r => r.json()).catch(() => ({ pages: [] }));
      const custom = (d.pages || []).filter(p => !p.system);
      if (!custom.length) {
        list.innerHTML = '<div class="mn-sheet-empty">No custom pages yet.</div>' + sheetActions();
        return;
      }
      list.innerHTML = custom.map(p => `
        <a href="/page.html?id=${p.id}" class="mn-sheet-item">
          <span class="mn-sheet-item-icon">${p.icon || '📄'}</span>
          <span class="mn-sheet-item-name">${p.name}</span>
          <span class="mn-sheet-item-arrow">›</span>
        </a>`).join('') + sheetActions();
    } catch {
      list.innerHTML = '<div class="mn-sheet-empty">Could not load pages.</div>' + sheetActions();
    }
  }

  // --- Event delegation ---
  nav.addEventListener('click', e => {
    const a = e.target.closest('[data-mn-action]');
    if (!a) return;
    e.preventDefault();
    const action = a.dataset.mnAction;
    if (action === 'theme' && window.toggleTheme) toggleTheme();
    if (action === 'pages') openSheet();
  });

  document.getElementById('mnPageSheetBg').addEventListener('click', closeSheet);

  // Swipe-down to close
  let startY = 0;
  const panel = document.getElementById('mnPageSheetPanel');
  panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - startY > 60) closeSheet();
  }, { passive: true });
})();
