// ELARIS — Mobile bottom navigation (injected on all pages)
(function () {
  if (typeof window === 'undefined') return;

  function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  const items = [
    { href: '/',              icon: '🏠', label: 'Home' },
    { href: '/modules.html',  icon: '⚙️', label: 'Modules' },
    { href: '/scenes.html',   icon: '🎬', label: 'Scenes' },
    { href: '/settings.html', icon: '👤', label: 'Settings' },
    { href: null,             icon: '⋯',  label: 'More', action: 'more' },
  ];

  const path = location.pathname;

  function isActive(href) {
    if (!href) return false;
    if (href === '/' && (path === '/' || path === '/index.html')) return true;
    return path === href || path === href.replace('.html', '');
  }

  const nav = document.createElement('div');
  nav.id = 'mobileNav';
  nav.innerHTML = '<nav>' + items.map(it => {
    if (it.action) {
      return `<button type="button" data-mn-action="${it.action}" aria-label="${it.label}">
        <span class="mn-icon">${it.icon}</span>
        <span>${it.label}</span>
      </button>`;
    }
    return `<a href="${it.href}" class="${isActive(it.href) ? 'active' : ''}" aria-label="${it.label}">
      <span class="mn-icon">${it.icon}</span>
      <span>${it.label}</span>
    </a>`;
  }).join('') + '</nav>';
  document.body.appendChild(nav);

  const pageSheet = document.createElement('div');
  pageSheet.id = 'mnPageSheet';
  pageSheet.innerHTML = `
    <div id="mnPageSheetBg"></div>
    <div id="mnPageSheetPanel" role="dialog" aria-modal="true" aria-label="My Pages">
      <div class="mn-sheet-handle"></div>
      <div class="mn-sheet-title">📄 My Pages</div>
      <div id="mnPageSheetList"><div class="mn-sheet-loading">Loading…</div></div>
    </div>`;
  document.body.appendChild(pageSheet);

  const moreSheet = document.createElement('div');
  moreSheet.id = 'mnMoreSheet';
  moreSheet.innerHTML = `
    <div id="mnMoreSheetBg"></div>
    <div id="mnMoreSheetPanel" role="dialog" aria-modal="true" aria-label="More navigation">
      <div class="mn-sheet-handle"></div>
      <div class="mn-sheet-title">More</div>
      <div id="mnMoreSheetList"></div>
    </div>`;
  document.body.appendChild(moreSheet);

  function openPageSheet() {
    closeMoreSheet();
    pageSheet.classList.add('open');
    document.body.classList.add('mn-sheet-open');
    loadPages();
  }
  function closePageSheet() {
    pageSheet.classList.remove('open');
    document.body.classList.remove('mn-sheet-open');
  }
  function openMoreSheet() {
    closePageSheet();
    renderMoreSheet();
    moreSheet.classList.add('open');
    document.body.classList.add('mn-sheet-open');
  }
  function closeMoreSheet() {
    moreSheet.classList.remove('open');
    document.body.classList.remove('mn-sheet-open');
  }

  function closeAllSheets() {
    closePageSheet();
    closeMoreSheet();
  }

  function moreLink(href, icon, name) {
    return `<a href="${href}" class="mn-sheet-item"><span class="mn-sheet-item-icon">${icon}</span><span class="mn-sheet-item-name">${name}</span><span class="mn-sheet-item-arrow">›</span></a>`;
  }
  function moreAction(action, icon, name) {
    return `<a href="#" data-more-action="${action}" class="mn-sheet-item"><span class="mn-sheet-item-icon">${icon}</span><span class="mn-sheet-item-name">${name}</span><span class="mn-sheet-item-arrow">›</span></a>`;
  }

  function renderMoreSheet() {
    const list = document.getElementById('mnMoreSheetList');
    list.innerHTML = [
      '<div class="mn-sheet-group">Pages & actions</div>',
      moreAction('pages', '📄', 'My Pages'),
      moreAction('theme', '🌙', 'Toggle Theme'),
      '<div class="mn-sheet-group">Tools</div>',
      moreLink('/history.html', '📈', 'History'),
      moreLink('/logs.html', '🧾', 'Logs'),
      moreLink('/entities.html', '🔌', 'Entities'),
      moreLink('/installer.html', '🧰', 'Installer'),
      moreLink('/esphome.html', '🟦', 'ESPHome'),
      '<div class="mn-sheet-group">System</div>',
      moreLink('/engineer.html', '🛠️', 'Engineer'),
      moreLink('/admin.html', '🛡️', 'Admin'),
      moreLink('/help.html', '❓', 'Help')
    ].join('');
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
        <a href="/page.html?id=${Number(p.id)}" class="mn-sheet-item">
          <span class="mn-sheet-item-icon">${esc(p.icon || '📄')}</span>
          <span class="mn-sheet-item-name">${esc(p.name)}</span>
          <span class="mn-sheet-item-arrow">›</span>
        </a>`).join('') + sheetActions();
    } catch {
      list.innerHTML = '<div class="mn-sheet-empty">Could not load pages.</div>' + sheetActions();
    }
  }

  const moreBtn = nav.querySelector('[data-mn-action="more"]');
  if (moreBtn) {
    moreBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openMoreSheet();
    });
  }

  moreSheet.addEventListener('click', e => {
    const a = e.target.closest('[data-more-action]');
    if (!a) return;
    e.preventDefault();
    const action = a.dataset.moreAction;
    if (action === 'theme' && window.toggleTheme) {
      closeAllSheets();
      toggleTheme();
      return;
    }
    if (action === 'pages') {
      openPageSheet();
      return;
    }
  });

  document.getElementById('mnPageSheetBg').addEventListener('click', closePageSheet);
  document.getElementById('mnMoreSheetBg').addEventListener('click', closeMoreSheet);

  let startY = 0;
  [document.getElementById('mnPageSheetPanel'), document.getElementById('mnMoreSheetPanel')].forEach(panel => {
    panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    panel.addEventListener('touchend', e => {
      if (e.changedTouches[0].clientY - startY > 60) closeAllSheets();
    }, { passive: true });
  });
})();
