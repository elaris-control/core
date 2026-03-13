(function(){
  const PAGE_REQUIREMENTS = {
    '/settings.html': 'ENGINEER',
    '/entities.html': 'ENGINEER',
    '/installer.html': 'ENGINEER',
    '/modules.html': 'ENGINEER',
    '/admin.html': 'ADMIN'
  };

  function computeUiRole(me){
    const accountRole = String(me?.accountRole || me?.user?.role || '').toUpperCase();
    const sessionRole = String(me?.role || '').toUpperCase();
    const engineerUnlocked = !!me?.engineerUnlocked;
    if (accountRole === 'ADMIN') return 'ADMIN';
    if (accountRole === 'ENGINEER' || sessionRole === 'ENGINEER' || engineerUnlocked) return 'ENGINEER';
    return 'USER';
  }

  function canAccess(uiRole, needed){
    if (!needed || needed === 'USER') return true;
    if (needed === 'ADMIN') return uiRole === 'ADMIN';
    if (needed === 'ENGINEER') return uiRole === 'ENGINEER' || uiRole === 'ADMIN';
    return false;
  }

  function setHidden(nodes, hidden){
    nodes.forEach((el)=>{
      if (!el) return;
      el.style.display = hidden ? 'none' : '';
      el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    });
  }

  function qsAll(sel){
    return Array.from(document.querySelectorAll(sel));
  }

  function injectRoleNav(uiRole){
    const existing = document.getElementById('roleNavBlock');
    if (existing) existing.remove();
    const sidebarNavAnchor = document.querySelector('#navContainer') || document.querySelector('.side .nav');
    const systemTitle = Array.from(document.querySelectorAll('.groupTitle')).find(el => el.textContent && el.textContent.trim().toLowerCase() === 'system');
    if (!sidebarNavAnchor || !systemTitle || uiRole !== 'USER') return;

    const block = document.createElement('div');
    block.id = 'roleNavBlock';
    block.innerHTML = [
      '<div class="groupTitle">Control</div>',
      '<nav class="nav">',
      '  <a href="/page.html?module=thermostat">🌡️ Climate</a>',
      '  <a href="/page.html?module=lighting">💡 Lighting</a>',
      '  <a href="/page.html?module=awning">🪟 Covers</a>',
      '</nav>'
    ].join('');
    systemTitle.parentNode.insertBefore(block, systemTitle);
  }

  function applyRoleVisibility(uiRole){
    document.documentElement.dataset.uiRole = uiRole;
    window.ELARIS_UI_ROLE = uiRole;

    const engineerOnly = [
      ...qsAll('a[href="/settings.html"]'),
      ...qsAll('a[href="/entities.html"]'),
      ...qsAll('a[href="/installer.html"]'),
      ...qsAll('a[href="/modules.html"]'),
      ...qsAll('#installerLink'),
      ...qsAll('#modulesLink'),
      ...qsAll('#addSiteBtn'),
      ...qsAll('[data-role="engineer"]'),
      ...qsAll('button[onclick*="openPageManager"]')
    ];
    setHidden(engineerOnly, !canAccess(uiRole, 'ENGINEER'));

    const adminOnly = [
      ...qsAll('a[href="/admin.html"]'),
      ...qsAll('#adminLink'),
      ...qsAll('[data-role="admin"]')
    ];
    setHidden(adminOnly, !canAccess(uiRole, 'ADMIN'));
  }

  function guardCurrentPage(uiRole){
    const pathname = location.pathname === '/index.html' ? '/' : location.pathname;
    const needed = PAGE_REQUIREMENTS[pathname];
    if (needed && !canAccess(uiRole, needed)) {
      location.replace('/');
      return false;
    }
    return true;
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] || ch));
  }

  async function doTopbarLogout(){
    try {
      await fetch('/auth/logout', { method:'POST', credentials:'same-origin' });
    } catch (_) {}
    location.replace('/login.html');
  }

  function closeInjectedMenus(except){
    document.querySelectorAll('.elaris-account-dropdown .menu.show').forEach((menu)=>{
      if (except && menu === except) return;
      menu.classList.remove('show');
    });
  }

  function injectTopbarControls(me, uiRole){
    const containers = Array.from(document.querySelectorAll('.topbar .actions, .hdr .actions, .hdr-right'));
    const accountName = me?.user?.name || me?.user?.email || 'Account';
    const accountEmail = me?.user?.email || '';
    const shortLabel = accountName.length > 18 ? accountName.slice(0, 18) + '…' : accountName;

    containers.forEach((container) => {
      if (!container || container.dataset.roleUiTopbar === '1') return;
      container.dataset.roleUiTopbar = '1';

      const oldLogout = container.querySelector('button[onclick*="doLogout"], button[onclick*="logout"], a[href="/logout"]');
      if (oldLogout) oldLogout.style.display = 'none';

      if (canAccess(uiRole, 'ENGINEER') && !container.querySelector('.elaris-notify-shortcut')) {
        const notifyLink = document.createElement('a');
        notifyLink.href = '/settings.html#notifyCard';
        notifyLink.className = 'btn elaris-notify-shortcut';
        notifyLink.title = 'Notifications';
        notifyLink.setAttribute('aria-label', 'Notifications');
        notifyLink.textContent = '🔔';
        container.appendChild(notifyLink);
      }

      if (!container.querySelector('.elaris-account-dropdown')) {
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown elaris-account-dropdown';
        dropdown.innerHTML = `
          <button class="btn" type="button" data-account-toggle>👤 ${escapeHtml(shortLabel)} ▾</button>
          <div class="menu" data-account-menu>
            <div class="menuMuted">Account</div>
            <div class="item" style="cursor:default;align-items:flex-start;flex-direction:column">
              <span>${escapeHtml(accountName)}</span>
              <span class="muted">${escapeHtml(accountEmail || uiRole)}</span>
            </div>
            ${canAccess(uiRole, 'ENGINEER') ? '<a class="item" href="/settings.html#notifyCard"><span>Notifications</span><span class="muted">alerts</span></a>' : ''}
            <div class="menuSep"></div>
            <button class="item" type="button" data-account-logout style="width:100%;border:none;background:transparent;text-align:left">
              <span>Logout</span><span class="muted">exit</span>
            </button>
          </div>`;
        container.appendChild(dropdown);

        const toggleBtn = dropdown.querySelector('[data-account-toggle]');
        const menu = dropdown.querySelector('[data-account-menu]');
        const logoutBtn = dropdown.querySelector('[data-account-logout]');

        toggleBtn?.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const willShow = !menu.classList.contains('show');
          closeInjectedMenus(willShow ? menu : null);
          menu.classList.toggle('show', willShow);
        });
        logoutBtn?.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          doTopbarLogout();
        });
      }
    });

    if (!window.__elarisTopbarMenuBound) {
      window.__elarisTopbarMenuBound = true;
      document.addEventListener('click', (ev) => {
        if (!ev.target.closest('.elaris-account-dropdown')) closeInjectedMenus();
      });
    }
  }

  async function bootRoleUi(){
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      const me = await res.json();
      if (!me.ok || !me.user) {
        location.replace('/login.html');
        return;
      }
      const uiRole = computeUiRole(me);
      window.ELARIS_ME = me;
      window.elarisComputeUiRole = computeUiRole;
      window.elarisCanAccess = function(needed){ return canAccess(uiRole, needed); };
      applyRoleVisibility(uiRole);
      injectRoleNav(uiRole);
      injectTopbarControls(me, uiRole);
      if (!guardCurrentPage(uiRole)) return;
      document.dispatchEvent(new CustomEvent('elaris:role-ready', {
        detail: { me, uiRole, canAccess: (needed)=>canAccess(uiRole, needed) }
      }));
    } catch (err) {
      location.replace('/login.html');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootRoleUi, { once:true });
  } else {
    bootRoleUi();
  }
})();
