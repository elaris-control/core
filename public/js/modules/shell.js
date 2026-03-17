// public/js/modules/shell.js
// Bootstrapping for the Modules page.

function showModulesNoSiteState() {
  const page = document.querySelector('.page');
  if (!page) return;
  page.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">No site found. <a href="/" style="color:var(--blue)">Go to Dashboard</a> first.</div>`;
}

async function initModulesPage() {
  try {
    const me = await api('/api/me');
    if (!me.ok || !me.user) { window.location.href = '/login.html'; return; }

    try { siteId = Number(localStorage.getItem('elaris_site_id') || ''); } catch {}
    if (!siteId) {
      const sites = await api('/api/sites');
      siteId = sites.sites?.[0]?.id;
    }
    if (!siteId) {
      showModulesNoSiteState();
      return;
    }

    const [defsRes, ioRes] = await Promise.all([
      api('/api/modules/definitions'),
      api(`/api/modules/io/${siteId}`),
    ]);

    defs = defsRes.modules || [];
    siteIO = ioRes.io || [];
    refreshIOFilterSelects();

    window._categories = defsRes.categories || [];
    renderCatTabs(window._categories);
    renderDefs();
    await loadInstances();
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('not_auth')) {
      window.location.href = '/login.html';
    } else {
      console.error(e);
    }
  }
}
