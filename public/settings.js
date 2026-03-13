// Auth guard — redirect to login if no session
(async function checkAuth() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    const d = await r.json();
    if (!d.ok || !d.user) { window.location.href = "/login.html"; }
  } catch { window.location.href = "/login.html"; }
})();

const $ = (id) => document.getElementById(id);

const state = {
  role: "USER",
  sites: [],
  siteId: null,
  siteName: null,
  devices: [],
  deviceId: null,
  zones: [],
  io: [],
};

function toast(msg){
  const el = $("toast");
  if(el) el.textContent = msg || "";
}

async function api(path, opts){
  const res = await fetch("/api"+path, {
    credentials: "same-origin",
    headers: { "Content-Type":"application/json" },
    ...opts
  });
  if(!res.ok){
    let j=null; try{ j=await res.json(); }catch{}
    throw new Error(j?.error || ("HTTP "+res.status));
  }
  return await res.json();
}

async function loadMe(){
  const me = await api("/me");
  state.role = me.role || "USER";
  $("wsPill").textContent = "Role: "+state.role;
}

async function loadSites(){
  const out = await api("/sites");
  state.sites = out.sites || [];
  if(!state.sites.length){
    state.siteId = null; state.siteName = null;
    $("sitePill").textContent = "Site: —";
    return;
  }

  // restore selected site (same key as dashboard)
  let saved = null;
  try{ saved = Number(localStorage.getItem("elaris_site_id") || ""); }catch(e){}
  const chosen = (saved && state.sites.find(s=>s.id===saved)) ? saved : state.sites[0].id;

  state.siteId = chosen;
  state.siteName = (state.sites.find(s=>s.id===chosen)?.name) || state.sites[0].name;

  $("sitePill").textContent = "Site: "+state.siteName;
}

async function loadDevicesForSite(){
  if(!state.siteId){ state.devices=[]; state.deviceId=null; return; }
  const out = await api(`/sites/${state.siteId}/devices`);
  const raw = out.devices || [];
  state.devices = raw.map(d => (typeof d === "string" ? d : d.id)).filter(Boolean);
  state.deviceId = state.devices[0] ?? null;
  $("devicePill").textContent = "Device: "+(state.deviceId || "—");
}

async function loadZones(){
  const out = await api("/zones");
  state.zones = out.zones || [];
}

function zoneSelect(current){
  const sel = document.createElement("select");
  sel.className = "sel zoneSel";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "(No zone)";
  sel.appendChild(opt0);

  for(const z of state.zones){
    const o = document.createElement("option");
    o.value = String(z.id);
    o.textContent = z.name;
    if(String(current||"") === String(z.id)) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function enableCtl(enabled){
  const onState = !!enabled;
  const seg = document.createElement("div");
  seg.className = "segCtl " + (onState ? "isOn" : "isOff");

  const offBtn = document.createElement("button");
  offBtn.className = "segBtn off" + (onState ? "" : " active");
  offBtn.textContent = "DIS";
  offBtn.disabled = !onState;

  const onBtn = document.createElement("button");
  onBtn.className = "segBtn on" + (onState ? " active" : "");
  onBtn.textContent = "EN";
  onBtn.disabled = onState;

  seg.appendChild(offBtn);
  seg.appendChild(onBtn);

  return { seg, offBtn, onBtn };
}

function rowCard(item){
  const row = document.createElement("div");
  row.className = "listRow";
  row.style.alignItems = "center";

  const left = document.createElement("div");

  const nameInp = document.createElement("input");
  nameInp.value = item.name || "";
  nameInp.style.minWidth = "220px";
  nameInp.style.fontWeight = "900";
  nameInp.style.padding = "8px 10px";
  nameInp.style.border = "1px solid var(--line)";
  nameInp.style.borderRadius = "12px";

  const meta = document.createElement("div");
  meta.style.color = "var(--muted)";
  meta.style.fontSize = "12px";
  meta.style.fontWeight = "800";
  meta.textContent = `${item.device_id} · ${item.group_name}.${item.key} · ${item.type}`;

  left.appendChild(nameInp);
  left.appendChild(meta);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "10px";
  right.style.alignItems = "center";

  const zSel = zoneSelect(item.zone_id);

  const en = enableCtl(Number(item.enabled ?? 1) === 1);

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.textContent = "Delete";

  // Handlers
  const saveName = async ()=>{
    try{
      const v = nameInp.value.trim();
      await api(`/io/${item.id}`, { method:"PATCH", body: JSON.stringify({ name: v }) });
      toast("Saved.");
    }catch(e){ toast("Save failed: "+e.message); }
  };

  let nameTimer = null;
  nameInp.addEventListener("input", ()=>{
    if(nameTimer) clearTimeout(nameTimer);
    nameTimer = setTimeout(saveName, 450);
  });
  nameInp.addEventListener("blur", saveName);

  zSel.addEventListener("change", async ()=>{
    try{
      const zone_id = zSel.value ? Number(zSel.value) : null;
      await api(`/io/${item.id}`, { method:"PATCH", body: JSON.stringify({ zone_id }) });
      toast("Zone updated.");
    }catch(e){ toast("Zone update failed: "+e.message); }
  });

  en.onBtn.addEventListener("click", async ()=>{
    try{
      await api(`/io/${item.id}`, { method:"PATCH", body: JSON.stringify({ enabled: 1 }) });
      toast("Enabled.");
      await loadIO();
    }catch(e){ toast("Enable failed: "+e.message); }
  });

  en.offBtn.addEventListener("click", async ()=>{
    try{
      await api(`/io/${item.id}`, { method:"PATCH", body: JSON.stringify({ enabled: 0 }) });
      toast("Disabled.");
      await loadIO();
    }catch(e){ toast("Disable failed: "+e.message); }
  });

  delBtn.addEventListener("click", async ()=>{
    if(!confirm("Delete this entity? (It may re-appear if the device keeps announcing it. For permanent block use Installer.)")) return;
    try{
      await api(`/io/${item.id}`, { method:"DELETE" });
      toast("Deleted.");
      await loadIO();
    }catch(e){ toast("Delete failed: "+e.message); }
  });

  right.appendChild(zSel);
  right.appendChild(en.seg);
  right.appendChild(delBtn);

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

async function loadIO(){
  const wrap = $("ioWrap");
  wrap.innerHTML = "";

  if(!state.deviceId){
    $("ioCount").textContent = "—";
    $("emptyIo").style.display = "block";
    return;
  }

  const out = await api(`/devices/${state.deviceId}/io?all=1`);
  state.io = out.io || [];

  $("ioCount").textContent = state.io.length + " items";
  $("emptyIo").style.display = state.io.length ? "none" : "block";

  // Sort: enabled first, then group/key
  const sorted = [...state.io].sort((a,b)=>{
    const ea = Number(a.enabled??1), eb=Number(b.enabled??1);
    if(ea!==eb) return eb-ea;
    const ga = String(a.group_name||"");
    const gb = String(b.group_name||"");
    if(ga!==gb) return ga.localeCompare(gb);
    return String(a.key||"").localeCompare(String(b.key||""));
  });

  for(const item of sorted){
    wrap.appendChild(rowCard(item));
  }
}


// mobile menu
try{
  $("menuBtn")?.addEventListener("click", ()=> document.body.classList.toggle("sideOpen"));
  $("overlay")?.addEventListener("click", ()=> document.body.classList.remove("sideOpen"));
}catch(e){}

$("refreshBtn").onclick = async ()=>{
  try{
    await loadZones();
    await loadIO();
    toast("Refreshed.");
  }catch(e){ toast("Refresh error: "+e.message); }
};

(async function boot(){
  try{
    await loadMe();
    await loadSites();
    await loadDevicesForSite();
    await loadZones();
    await loadIO();
  }catch(e){
    toast("Init error: "+e.message);
  }
})();


// ── Site Location ──────────────────────────────────────────────────────────
async function loadSiteLocation() {
  try {
    const d = await api(`/sites/${state.siteId}`);
    if (!d.site) return;
    const s = d.site;
    document.getElementById("latInput").value     = s.lat     || "";
    document.getElementById("lonInput").value     = s.lon     || "";
    document.getElementById("addressInput").value = s.address || "";
    const tz = document.getElementById("tzInput");
    if (s.timezone) {
      const opt = [...tz.options].find(o => o.value === s.timezone);
      if (opt) tz.value = s.timezone;
    }
    document.getElementById("locationStatus").textContent =
      s.lat && s.lon ? `${parseFloat(s.lat).toFixed(4)}, ${parseFloat(s.lon).toFixed(4)}` : "Not set";
    if (s.lat && s.lon) updateMapPreview(s.lat, s.lon);
  } catch(e) { console.warn("Location load:", e.message); }
}

function updateMapPreview(lat, lon) {
  const box = document.getElementById("mapPreview");
  const frm = document.getElementById("mapFrame");
  if (!box || !frm) return;
  frm.src = `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lon)-.02},${parseFloat(lat)-.02},${parseFloat(lon)+.02},${parseFloat(lat)+.02}&layer=mapnik&marker=${lat},${lon}`;
  box.style.display = "block";
}

document.getElementById("geoBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("geoBtn");
  btn.textContent = "📡 Locating…";
  btn.disabled = true;
  try {
    // Server-side IP geolocation — works on plain HTTP
    const d = await api("/geolocate");
    if (d.ok) {
      document.getElementById("latInput").value     = d.lat;
      document.getElementById("lonInput").value     = d.lon;
      document.getElementById("addressInput").value = `${d.city}, ${d.region}`;
      // Set timezone if it matches
      const tz = document.getElementById("tzInput");
      const opt = [...tz.options].find(o => o.value === d.timezone);
      if (opt) tz.value = d.timezone;
      updateMapPreview(d.lat, d.lon);
      btn.textContent = `📍 ${d.city}`;
    } else {
      btn.textContent = "📡 Use My Location";
      alert("Could not detect location. Enter manually.");
    }
  } catch(e) {
    btn.textContent = "📡 Use My Location";
    alert("Geolocation error: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

// Live map update on lat/lon change
["latInput","lonInput"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", () => {
    const lat = document.getElementById("latInput").value;
    const lon = document.getElementById("lonInput").value;
    if (lat && lon) updateMapPreview(lat, lon);
  });
});

document.getElementById("saveLocBtn")?.addEventListener("click", async () => {
  const latEl   = document.getElementById("latInput");
  const lonEl   = document.getElementById("lonInput");
  // Try .value first, fall back to valueAsNumber for type=number inputs
  const lat     = latEl.valueAsNumber || parseFloat(String(latEl.value).replace(",","."));
  const lon     = lonEl.valueAsNumber || parseFloat(String(lonEl.value).replace(",","."));
  const address = document.getElementById("addressInput").value;
  const timezone= document.getElementById("tzInput").value;
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) return alert("Please enter valid latitude and longitude numbers");
  try {
    await api(`/sites/${state.siteId}/location`, {
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon), address, timezone })
    });
    const msg = document.getElementById("locSaveMsg");
    msg.style.display = "inline";
    setTimeout(() => msg.style.display = "none", 2500);
    document.getElementById("locationStatus").textContent = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lon).toFixed(4)}`;
  } catch(e) { alert("Error: " + e.message); }
});

// Load location when site is ready
const _origLoad = typeof loadIO === "function" ? loadIO : null;
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => { if (state.siteId) loadSiteLocation(); }, 800);
});
