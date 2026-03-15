// Auth guard - redirect to login if no session
(async function checkAuth() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    const d = await r.json();
    if (!d.ok || !d.user) { window.location.href = "/login.html"; }
  } catch { window.location.href = "/login.html"; }
})();

const $ = (id) => document.getElementById(id);

function escHTML(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

async function apiGet(url) {
  const r = await fetch(url, { credentials: "include" });
  return r.json();
}
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {})
  });
  return r.json();
}
async function apiDel(url) {
  const r = await fetch(url, { method: "DELETE", credentials: "include" });
  return r.json();
}

function showInstallerUI(on) {
  $("installerUI").style.display = on ? "" : "none";
}

async function checkMe() {
  const me = await apiGet("/api/me");
  if (!me.engineerLicensed) {
    $("gateMsg").textContent = "Engineer tools not licensed.";
    return false;
  }
  const engineerUnlocked = !!(me && me.engineerUnlocked);
  const accountRole = String((me && me.accountRole) || me.role || 'USER').toUpperCase();
  const unlocked = engineerUnlocked || me.role === "ENGINEER" || accountRole === "ENGINEER";
  if (unlocked) {
    $("gateMsg").textContent = `Unlocked${accountRole === 'ADMIN' ? ' (Admin)' : ''}.`;
    showInstallerUI(true);
    return true;
  }
  $("gateMsg").textContent = "Locked.";
  showInstallerUI(false);
  return false;
}

async function unlock() {
  const code = $("code").value.trim();
  const r = await apiPost("/api/engineer/unlock", { code });
  if (!r.ok) {
    $("gateMsg").textContent = `Unlock failed: ${r.error || "unknown"}`;
    return;
  }
  $("gateMsg").textContent = "Unlocked.";
  await loadAll();
}

async function lock() {
  await apiPost("/api/engineer/lock", {});
  $("gateMsg").textContent = "Locked.";
  showInstallerUI(false);
}

function rowHTML(p, zones) {
  const zopts = [`<option value="">(No zone)</option>`]
    .concat((zones || []).map(z => `<option value="${z.id}">${z.site_id ? escHTML(z.name) : '🌐 '+escHTML(z.name)}</option>`))
    .join("");

  return `
  <div style="display:grid;grid-template-columns: 220px 120px 180px 1fr 120px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
    <div>
      <b>${escHTML(p.device_id)}</b><br>
      <span style="color:var(--muted);font-size:12px">${escHTML(p.group_name)}.${escHTML(p.key)}</span><br>
      <span style="color:var(--muted);font-size:12px">last: ${new Date(p.last_seen).toLocaleTimeString()} | val: ${escHTML(p.last_value ?? "—")}</span>
    </div>

    <select data-type="${p.id}" style="padding:10px 12px;border-radius:12px;border:1px solid var(--line)">
      <option value="sensor" ${p.group_name==="tele" ? "selected":""}>sensor</option>
      <option value="relay" ${p.group_name==="state" ? "selected":""}>relay</option>
    </select>

    <select data-zone="${p.id}" style="padding:10px 12px;border-radius:12px;border:1px solid var(--line)">
      ${zopts}
    </select>

    <input data-name="${p.id}" value="${escHTML(p.group_name==="tele" && p.key==="temp" ? "Temperature" : (p.group_name==="tele" && p.key==="hum" ? "Humidity" : String(p.key||"").toUpperCase()))}"
      style="padding:10px 12px;border-radius:12px;border:1px solid var(--line)"/>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn on" data-approve="${p.id}">Approve</button>
      <button class="btn ghost" data-del="${p.id}">Delete</button>
    </div>
  </div>`;
}

async function loadPending() {
  let siteId = null;
  try { siteId = Number(localStorage.getItem('elaris_site_id')||'') || null; } catch(e){}
  const zonesRes = await apiGet('/api/zones' + (siteId ? ('?site_id=' + encodeURIComponent(siteId)) : ''));
  const zones = zonesRes.zones || [];

  const p = await apiGet("/api/pending-io");
  const pending = p.pending || [];

  const table = $("pendingTable");
  if (!pending.length) {
    table.innerHTML = `<div style="color:var(--muted)">No pending IO.</div>`;
    return;
  }

  table.innerHTML = `
    <div style="display:grid;grid-template-columns: 220px 120px 180px 1fr 120px;gap:10px;color:var(--muted);font-size:12px;padding-bottom:8px">
      <div>DEVICE / KEY</div><div>TYPE</div><div>ZONE</div><div>NAME (LABEL)</div><div style="text-align:right">ACTION</div>
    </div>
    ${pending.map(x => rowHTML(x, zones)).join("")}
  `;

  // bind actions
  table.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-approve");
      const type = table.querySelector(`[data-type="${id}"]`).value;
      const zoneVal = table.querySelector(`[data-zone="${id}"]`).value;
      const name = table.querySelector(`[data-name="${id}"]`).value.trim();
      const zone_id = zoneVal ? Number(zoneVal) : null;

      const r = await apiPost(`/api/pending-io/${id}/approve`, { name, type, zone_id });
      if (!r.ok) {
        $("pendingMsg").textContent = `Approve error: ${r.error || "unknown"}`;
      } else {
        $("pendingMsg").textContent = `Approved ${id}`;
      }
      await loadPending();
    });
  });

  table.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const r = await apiDel(`/api/pending-io/${id}`);
      $("pendingMsg").textContent = r.ok ? `Deleted ${id}` : `Delete error: ${r.error || "unknown"}`;
      await loadPending();
    });
  });
}

async function loadAll() {
  const ok = await checkMe();
  if (!ok) return;
  // Auto-select first site so approve always has a site_id
  await autoSelectSite();
  await loadPending();
}

async function autoSelectSite() {
  try {
    const r = await apiGet("/api/sites");
    const sites = r.sites || [];
    if (!sites.length) return;
    // Use stored site_id if valid, else first site
    let stored = null;
    try { stored = Number(localStorage.getItem("elaris_site_id")||"")||null; } catch(e){}
    const site = sites.find(s=>s.id===stored) || sites[0];
    localStorage.setItem("elaris_site_id", site.id);
    // Update pill if exists
    const pill = document.getElementById("sitePill");
    if (pill) pill.textContent = "Site: " + site.name;
  } catch(e) {}
}

async function createZone() {
  const name = $("zoneName").value.trim();
  if (!name) return;
  const siteSel = document.querySelector('#siteFilter, #siteSel');
  const site_id = siteSel && siteSel.value ? Number(siteSel.value) : null;
  const r = await apiPost("/api/zones", { name, site_id });
  $("zoneMsg").textContent = r.ok ? "Zone created." : `Error: ${r.error || "unknown"}`;
  $("zoneName").value = "";
  await loadPending();
}

(function boot() {
  $("unlockBtn").addEventListener("click", unlock);
  $("lockBtn").addEventListener("click", lock);
  $("refreshBtn").addEventListener("click", loadAll);
  $("createZoneBtn").addEventListener("click", createZone);

  loadAll();
})();
