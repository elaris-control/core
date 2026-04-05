// Auth guard — redirect to login if no session
(async function checkAuth() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    const d = await r.json();
    if (!d.ok || !d.user) { window.location.href = "/login.html"; }
  } catch { window.location.href = "/login.html"; }
})();

// public/entities.js — shared utilities ($, escapeHTML, api, toast) are in /js/core.js

function getActiveOverrideLocal(ioId){
  const ov = state.ioOverrides?.[ioId];
  if (!ov || ov.active !== true) return null;
  const exp = Number(ov.expires_at || 0);
  if (!ov.permanent && exp > 0 && exp <= Date.now()) {
    delete state.ioOverrides[ioId];
    return null;
  }
  return ov;
}

function formatRemainingMs(ms){
  const n = Math.max(0, Number(ms) || 0);
  const sec = Math.ceil(n / 1000);
  if (sec < 90) return sec + 's left';
  const min = Math.ceil(sec / 60);
  if (min < 120) return min + 'm left';
  const hrs = Math.ceil(min / 60);
  if (hrs < 48) return hrs + 'h left';
  const days = Math.ceil(hrs / 24);
  return days + 'd left';
}

function describeOverride(ov){
  if (!ov || ov.active !== true) return 'AUTO';
  const suffix = ov.permanent ? 'Permanent' : formatRemainingMs(Number(ov.expires_at || 0) - Date.now());
  return `FORCED: ${String(ov.value)} • ${suffix}`;
}

async function refreshOverridesOnly(){
  try{
    const ov = await api('/io/overrides');
    state.ioOverrides = ov.overrides || {};
    // Don't re-render while user is editing a field in the table
    var active = document.activeElement;
    var rows = document.getElementById('rows');
    if (active && rows && rows.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    applyFilterAndRender();
  }catch(e){}
}

function opt(sel, value, label){
  const o=document.createElement("option");
  o.value = value;
  o.textContent = label;
  sel.appendChild(o);
}

const state = {
  role: "USER",
  sites: [],
  zones: [],
  devices: [],
  entities: [],
  filtered: [],
  selected: new Set(),
  ioOverrides: {},   // io_id -> {value, active, ts}
};

const sourceMetaState = { boards: null, profiles: {}, devices: null };

function entitySourceClass(e){
  const token = String(e.port_id || e.source || '').trim().toUpperCase();
  if (/^DO\d+/.test(token) || String(e.type||'').toLowerCase() === 'relay' || String(e.group_name||'').toLowerCase() === 'state') return 'DO';
  if (/^DI\d+/.test(token)) return 'DI';
  if (/^AO\d+/.test(token)) return 'AO';
  if (/^(AI|HT)\d+/.test(token) || e.bus_id) return 'AI';
  return String(e.type||'').toLowerCase() === 'relay' ? 'DO' : 'AI';
}

async function loadBoardCatalog(){
  if (Array.isArray(sourceMetaState.boards)) return sourceMetaState.boards;
  const out = await api('/esphome/boards');
  sourceMetaState.boards = Array.isArray(out.boards) ? out.boards : [];
  return sourceMetaState.boards;
}

async function loadEsphomeDevicesForSource(){
  if (Array.isArray(sourceMetaState.devices)) return sourceMetaState.devices;
  const out = await api('/esphome/devices');
  sourceMetaState.devices = Array.isArray(out.devices) ? out.devices : [];
  return sourceMetaState.devices;
}

async function loadBoardProfileDefinition(id){
  const key = String(id || '').trim();
  if (!key) return null;
  if (sourceMetaState.profiles[key]) return sourceMetaState.profiles[key];
  const out = await api('/esphome/catalog/export/' + encodeURIComponent(key));
  const profile = out && out.profile ? out.profile : null;
  sourceMetaState.profiles[key] = profile;
  return profile;
}

async function resolveEntityBoardProfileId(entity){
  if (entity && entity.board_profile_id) return String(entity.board_profile_id);
  const devices = await loadEsphomeDevicesForSource();
  const want = String(entity && entity.device_id || '').trim().toLowerCase();
  const row = devices.find(function(d){
    return [d.name, d.friendly_name, d.hostname].some(function(v){ return String(v || '').trim().toLowerCase() === want; });
  });
  return row && row.board_profile_id ? String(row.board_profile_id) : '';
}

function buildEntitySourceOptions(profileDef, klass){
  const out = [];
  const def = profileDef && profileDef.definition ? profileDef.definition : profileDef;
  const ports = Array.isArray(def && def.boardPorts) ? def.boardPorts : [];
  const buses = Array.isArray(def && def.boardBuses) ? def.boardBuses : [];
  const want = String(klass || '').toUpperCase();
  ports.forEach(function(port){
    const group = String(port.group || '').toLowerCase();
    if (want === 'DO' && group !== 'do') return;
    if (want === 'DI' && group !== 'di') return;
    if (want === 'AO' && group !== 'ao') return;
    if (want === 'AI' && ['ai','ht','onewire'].indexOf(group) < 0) return;
    const label = String(port.label || port.id || '');
    const value = String(port.id || label || '');
    const detail = [Array.isArray(port.aliases) && port.aliases.length ? port.aliases.join(', ') : null, port.pin || null, port.range || null, port.hint || null].filter(Boolean).join(' • ');
    out.push({ kind: 'port', value: value, label: label || value, group: String(port.group || '').toUpperCase(), detail: detail });
  });
  if (want === 'AI') {
    buses.forEach(function(bus){
      const proto = String(bus.protocol || '').toLowerCase();
      if (['i2c','rs485','uart'].indexOf(proto) < 0) return;
      const detail = [proto.toUpperCase(), bus.sda != null && bus.scl != null ? ('SDA ' + bus.sda + ' / SCL ' + bus.scl) : null, bus.tx != null && bus.rx != null ? ('TX ' + bus.tx + ' / RX ' + bus.rx) : null, Array.isArray(bus.addresses) && bus.addresses.length ? ('Addresses ' + bus.addresses.join(', ')) : null, bus.hint || null].filter(Boolean).join(' • ');
      out.push({ kind: 'bus', value: String(bus.id || bus.label || ''), label: String(bus.label || bus.id || ''), group: String(bus.protocol || 'BUS').toUpperCase(), detail: detail });
    });
  }
  return out;
}

function sourceMetaSelectionPayload(profileDef, selection){
  const value = String(selection || '').trim();
  const def = profileDef && profileDef.definition ? profileDef.definition : profileDef;
  const ports = Array.isArray(def && def.boardPorts) ? def.boardPorts : [];
  const buses = Array.isArray(def && def.boardBuses) ? def.boardBuses : [];
  const port = ports.find(function(p){ return String(p.id || p.label || '').trim() === value; });
  if (port) return { source: String(port.id || value), port_id: String(port.id || value), bus_id: null };
  const bus = buses.find(function(b){ return String(b.id || b.label || '').trim() === value; });
  if (bus) return { source: String(bus.id || value), port_id: null, bus_id: String(bus.id || value) };
  return { source: null, port_id: null, bus_id: null };
}

function closeSourceMeta(){
  var m = document.getElementById('srcMetaModal');
  if (m) m.style.display = 'none';
}

async function openSourceMeta(entity){
  var m = document.getElementById('srcMetaModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'srcMetaModal';
    m.className = 'modal';
    m.style.display = 'none';
    m.innerHTML = '<div class="modalCard" style="max-width:620px">'
      + '<div class="modalHead"><div class="modalTitle" id="srcMetaTitle">Source metadata</div><button class="iconBtn" onclick="closeSourceMeta()">✕</button></div>'
      + '<div class="modalBody" style="display:flex;flex-direction:column;gap:14px">'
      + '<div id="srcMetaEntity" style="font-size:12px;color:var(--muted2)"></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Board profile</div><select class="sel" id="srcMetaProfile"></select></div>'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Entity class</div><input class="txt" id="srcMetaClass" readonly></div>'
      + '</div>'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Board port / bus</div><select class="sel" id="srcMetaSource"></select><div id="srcMetaDetail" style="font-size:11px;color:var(--muted2);margin-top:6px"></div></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Stored source</div><input class="txt" id="srcMetaStoredSource" readonly></div>'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Port ID</div><input class="txt" id="srcMetaPortId" readonly></div>'
      + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Bus ID</div><input class="txt" id="srcMetaBusId" readonly></div>'
      + '</div>'
      + '<div style="padding:10px 12px;border:1px solid var(--line2);border-radius:12px;background:rgba(29,140,255,.08);font-size:12px;color:var(--text)" id="srcMetaHelp"></div>'
      + '</div>'
      + '<div class="modalActions">'
      + '<button class="btn" onclick="window._srcMetaSave(null, true)">Clear metadata</button>'
      + '<button class="btn" onclick="closeSourceMeta()">Cancel</button>'
      + '<button class="btn primary" onclick="window._srcMetaSave()">Save source</button>'
      + '</div></div>';
    m.addEventListener('click', function(ev){ if (ev.target === m) closeSourceMeta(); });
    document.body.appendChild(m);
  }
  const boards = await loadBoardCatalog();
  const profileSel = document.getElementById('srcMetaProfile');
  const sourceSel = document.getElementById('srcMetaSource');
  const klass = entitySourceClass(entity);
  document.getElementById('srcMetaTitle').textContent = 'Source metadata: ' + (entity.name || entity.key || ('IO #' + entity.id));
  document.getElementById('srcMetaEntity').textContent = [entity.device_id, (entity.group_name || '') + '.' + (entity.key || '')].filter(Boolean).join(' • ');
  document.getElementById('srcMetaClass').value = klass;
  document.getElementById('srcMetaStoredSource').value = entity.source || '';
  document.getElementById('srcMetaPortId').value = entity.port_id || '';
  document.getElementById('srcMetaBusId').value = entity.bus_id || '';
  document.getElementById('srcMetaHelp').textContent = 'Choose the real board port or bus that this entity comes from. This updates persisted source metadata used by Installer, Entities and future reassign flows.';
  const resolvedProfileId = await resolveEntityBoardProfileId(entity);
  profileSel.innerHTML = '<option value="">— no board profile —</option>' + boards.map(function(b){ return '<option value="' + escapeHTML(String(b.id || '')) + '">' + escapeHTML(String(b.label || b.id || '')) + '</option>'; }).join('');
  profileSel.value = entity.board_profile_id || resolvedProfileId || '';
  async function renderSourceOptions(selectedValue){
    const profileId = String(profileSel.value || '').trim();
    if (!profileId) {
      sourceSel.innerHTML = '<option value="">— no board profile selected —</option>';
      document.getElementById('srcMetaDetail').textContent = 'Pick a board profile first if you want board-aware source metadata.';
      return;
    }
    const profile = await loadBoardProfileDefinition(profileId);
    const opts = buildEntitySourceOptions(profile, klass);
    if (!opts.length) {
      sourceSel.innerHTML = '<option value="">— no compatible board paths —</option>';
      document.getElementById('srcMetaDetail').textContent = 'This profile has no compatible ports/buses for ' + klass + '.';
      return;
    }
    const groups = {};
    opts.forEach(function(opt){ if (!groups[opt.group]) groups[opt.group] = []; groups[opt.group].push(opt); });
    sourceSel.innerHTML = '<option value="">— choose board path —</option>';
    Object.keys(groups).forEach(function(groupKey){
      const og = document.createElement('optgroup');
      og.label = groupKey;
      groups[groupKey].forEach(function(opt){
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label + (opt.kind === 'bus' ? ' · bus' : '');
        el.dataset.detail = opt.detail || '';
        og.appendChild(el);
      });
      sourceSel.appendChild(og);
    });
    sourceSel.value = selectedValue || entity.port_id || entity.bus_id || entity.source || '';
    const selected = sourceSel.options[sourceSel.selectedIndex];
    document.getElementById('srcMetaDetail').textContent = (selected && selected.dataset && selected.dataset.detail) ? selected.dataset.detail : 'Board-aware source on ' + (profile.label || profileId) + '.';
  }
  profileSel.onchange = function(){ renderSourceOptions(''); };
  sourceSel.onchange = function(){
    const selected = sourceSel.options[sourceSel.selectedIndex];
    document.getElementById('srcMetaDetail').textContent = (selected && selected.dataset && selected.dataset.detail) ? selected.dataset.detail : '';
  };
  await renderSourceOptions(entity.port_id || entity.bus_id || entity.source || '');
  window._srcMetaSave = async function(_, clearOnly){
    try {
      const profileId = String(profileSel.value || '').trim() || null;
      let payload = { id: entity.id, board_profile_id: profileId };
      if (clearOnly) {
        payload.source = null; payload.port_id = null; payload.bus_id = null;
      } else {
        const profile = profileId ? await loadBoardProfileDefinition(profileId) : null;
        const resolved = profile ? sourceMetaSelectionPayload(profile, sourceSel.value) : { source: null, port_id: null, bus_id: null };
        payload = Object.assign(payload, resolved);
      }
      await api('/io/update', { method:'POST', body: JSON.stringify(payload) });
      entity.source = payload.source || null;
      entity.port_id = payload.port_id || null;
      entity.bus_id = payload.bus_id || null;
      entity.board_profile_id = payload.board_profile_id || null;
      closeSourceMeta();
      applyFilterAndRender();
      toast(clearOnly ? 'Source metadata cleared' : 'Source metadata saved');
    } catch (err) {
      toast('Source save failed: ' + err.message, false);
    }
  };
  m.style.display = 'flex';
}


function getFilter(){
  return {
    q: $("q").value.trim(),
    siteId: $("siteSel").value,
    deviceId: $("deviceSel").value,
    zoneId: $("zoneSel").value,
    type: $("typeSel").value,
    status: $("statusSel").value,
  };
}

function setCounts(){
  const shown = state.filtered.length;
  const total = state.entities.length;
  $("countPill").textContent = `${shown} shown / ${total} total`;
}

function renderRows(){
  const tbody = $("rows");
  tbody.replaceChildren();
  $("emptyMsg").style.display = state.filtered.length ? "none" : "block";

  for(const e of state.filtered){
    const tr=document.createElement("tr");

    // chk
    const td0=document.createElement("td");
    const chk=document.createElement("input");
    chk.type="checkbox";
    chk.checked = state.selected.has(e.id);
    chk.addEventListener("change", ()=>{
      if(chk.checked) state.selected.add(e.id); else state.selected.delete(e.id);
      $("selInfo").textContent = `${state.selected.size} selected`;
      $("chkAll").checked = state.selected.size && state.selected.size===state.filtered.length;
    });
    td0.appendChild(chk);
    tr.appendChild(td0);

    // name (editable)
    const td1=document.createElement("td");
    const nameInp=document.createElement("input");
    nameInp.className="txt";
    nameInp.value = e.name || "";
    nameInp.addEventListener("change", async ()=>{
      try{
        await api("/io/update",{method:"POST", body: JSON.stringify({ id:e.id, name:nameInp.value })});
        toast("Saved");
      }catch(err){ toast("Save failed: "+err.message,false); }
    });
    td1.appendChild(nameInp);
    tr.appendChild(td1);


// site (engineer can change device->site)
const tdSite = document.createElement("td");
if(state.role === "ENGINEER" || state.role === "ADMIN"){
  const ssel = document.createElement("select");
  ssel.className = "sel";
  opt(ssel, "", "(Unassigned)");
  for(const s of state.sites) opt(ssel, String(s.id), s.name);
  ssel.value = e.site_id ? String(e.site_id) : "";
  ssel.addEventListener("change", async ()=>{
    try{
      if(!ssel.value) { toast("Choose a site", false); return; }
      await api("/sites/" + Number(ssel.value) + "/assign-device", {method:"POST", body: JSON.stringify({ deviceId: e.device_id })});
      toast("Device assigned to site");
      await refreshEntities();
    }catch(err){ toast("Assign failed: "+err.message,false); }
  });
  tdSite.appendChild(ssel);
}else{
  tdSite.textContent = e.site_name || "";
}
tr.appendChild(tdSite);


    // device/key
    const td2=document.createElement("td");
    const sourceBits = [];
    if (e.source) sourceBits.push(String(e.source));
    if (e.bus_id && (!e.source || String(e.bus_id) !== String(e.source))) sourceBits.push('bus ' + String(e.bus_id));
    else if (e.port_id && (!e.source || String(e.port_id) !== String(e.source))) sourceBits.push('port ' + String(e.port_id));
    if (e.entity_type) sourceBits.push(String(e.entity_type));
    td2.innerHTML = `<div class="rowName">${escapeHTML(e.device_id || "")}</div><div class="mini">${escapeHTML((e.group_name||"")+"."+ (e.key||""))}</div>${sourceBits.length ? `<div class="mini">${escapeHTML(sourceBits.join(' • '))}</div>` : ''}`;
    tr.appendChild(td2);

    // type
    const td3=document.createElement("td");
    td3.textContent = e.type || "";
    td3.style.textAlign="center";
    tr.appendChild(td3);

    // Manual Override column (Engineer/Admin only)
    const tdOvr=document.createElement("td");
    tdOvr.style.textAlign='center';
    const isEngineer = state.role === 'ENGINEER' || state.role === 'ADMIN';
    if (isEngineer) {
      const ovr=getActiveOverrideLocal(e.id);
      if(ovr&&ovr.active){
        const pill=document.createElement('span');
        pill.className='pill';
        pill.style.cssText='background:rgba(245,158,11,.2);color:#f59e0b;font-size:10px;font-weight:800;cursor:pointer;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        pill.title='Click to edit override';
        pill.textContent=describeOverride(ovr);
        pill.addEventListener('click',()=>openOverride(e.id, e.name||'', e.type||'', e.key||''));
        tdOvr.appendChild(pill);
      } else {
        const btnOvr=document.createElement('button');
        btnOvr.className='btn';
        btnOvr.style.cssText='font-size:10px;padding:3px 10px;border:1px solid var(--blue);color:var(--blue);background:rgba(11,99,206,.1);cursor:pointer;font-weight:800';
        btnOvr.textContent='SET OVERRIDE';
        btnOvr.addEventListener('click',()=>openOverride(e.id, e.name||'', e.type||'', e.key||''));
        tdOvr.appendChild(btnOvr);
      }
    }
    tr.appendChild(tdOvr);

    // zone
    const td4=document.createElement("td");
    const zsel=document.createElement("select");
    zsel.className="sel";
    opt(zsel, "", "(No zone)");
    for(const z of state.zones) opt(zsel, String(z.id), z.site_id ? z.name : '🌐 '+z.name);
    zsel.value = e.zone_id ? String(e.zone_id) : "";
    zsel.addEventListener("change", async ()=>{
      try{
        const zid = zsel.value ? Number(zsel.value) : null;
        await api("/io/update",{method:"POST", body: JSON.stringify({ id:e.id, zone_id: zid })});
        toast("Zone updated");
      }catch(err){ toast("Zone failed: "+err.message,false); }
    });
    td4.appendChild(zsel);
    tr.appendChild(td4);

    // status
    const td5=document.createElement("td");
    const pill=document.createElement("span");
    pill.className="pill";
    const en = (e.enabled === 0 || e.enabled === false) ? 0 : 1;
    pill.textContent = en ? "enabled" : "disabled";
    td5.style.textAlign="center";
    td5.appendChild(pill);
    tr.appendChild(td5);

    // actions
    const td6=document.createElement("td");
    td6.style.textAlign="center";
    td6.style.whiteSpace="nowrap";
    const actWrap=document.createElement("div");
    actWrap.style.cssText="display:inline-flex;gap:6px;justify-content:center";
    td6._wrap=actWrap;
    td6.appendChild(actWrap);
    const btnEn=document.createElement("button");
    btnEn.className="btn";
    btnEn.textContent = en ? "Disable" : "Enable";
    btnEn.addEventListener("click", async ()=>{
      try{
        await api("/io/update",{method:"POST", body: JSON.stringify({ id:e.id, enabled: en?0:1 })});
        e.enabled = en?0:1;
        updateSitePill();
      applyFilterAndRender();
        toast(en?"Disabled":"Enabled");
      }catch(err){ toast("Failed: "+err.message,false); }
    });

    const btnDel=document.createElement("button");
    btnDel.className="btn danger";
    btnDel.textContent="Delete";
    btnDel.addEventListener("click", async ()=>{
      if(!confirm("Delete this entity?")) return;
      try{
        await api("/io/bulk",{method:"POST", body: JSON.stringify({ action:"delete", ids:[e.id] })});
        // remove locally
        state.entities = state.entities.filter(x=>x.id!==e.id);
        state.selected.delete(e.id);
        applyFilterAndRender();
        toast("Deleted");
      }catch(err){ toast("Delete failed: "+err.message,false); }
    });

    const btnPin=document.createElement("button");
    btnPin.className="btn";
    btnPin.title = e.pinned ? "Unpin from dashboard" : "Pin to dashboard";
    btnPin.textContent = e.pinned ? "📌" : "📍";
    btnPin.style.cssText = "font-size:13px;padding:3px 8px;" + (e.pinned ? "color:var(--blue);" : "color:var(--muted2);");
    btnPin.addEventListener("click", async ()=>{
      try{
        const newPinned = e.pinned ? 0 : 1;
        await api("/io/"+e.id, {method:"PATCH", body: JSON.stringify({pinned: newPinned})});
        e.pinned = newPinned;
        btnPin.textContent = newPinned ? "📌" : "📍";
        btnPin.style.color = newPinned ? "var(--blue)" : "var(--muted2)";
        btnPin.title = newPinned ? "Unpin from dashboard" : "Pin to dashboard";
        toast(newPinned ? "Pinned to dashboard" : "Unpinned");
      }catch(err){ toast("Failed: "+err.message,false); }
    });

    if(state.role === 'ENGINEER' || state.role === 'ADMIN'){
      const btnSrc=document.createElement('button');
      btnSrc.className='btn';
      btnSrc.textContent='Source';
      btnSrc.title='Edit board-aware source metadata';
      btnSrc.addEventListener('click', ()=>openSourceMeta(e));
      actWrap.append(btnPin, btnSrc, btnEn, btnDel);
    } else {
      actWrap.append(btnPin, btnEn, btnDel);
    }
    tr.appendChild(td6);

    tbody.appendChild(tr);
  }

  $("selInfo").textContent = `${state.selected.size} selected`;
  $("chkAll").checked = state.selected.size && state.selected.size===state.filtered.length;
  setCounts();
}

function applyFilterAndRender(){
  const f = getFilter();
  let list = state.entities.slice();

  if(f.q){
    const q=f.q.toLowerCase();
    list = list.filter(e =>
      (e.name||"").toLowerCase().includes(q) ||
      (e.device_id||"").toLowerCase().includes(q) ||
      (e.key||"").toLowerCase().includes(q) ||
      (e.group_name||"").toLowerCase().includes(q) ||
      (e.zone_name||"").toLowerCase().includes(q) ||
      (e.site_name||"").toLowerCase().includes(q)
    );
  }
  if(f.siteId) list = list.filter(e => String(e.site_id||"") === String(f.siteId));
  if(f.deviceId) list = list.filter(e => String(e.device_id||"") === String(f.deviceId));
  if(f.zoneId) list = list.filter(e => String(e.zone_id||"") === String(f.zoneId));
  if(f.type) list = list.filter(e => String(e.type||"") === String(f.type));
  if(f.status){
    const want = (f.status === "enabled") ? 1 : 0;
    list = list.filter(e => ((e.enabled===0||e.enabled===false)?0:1) === want);
  }

  state.filtered = list;
  renderRows();
}

function rebuildFilters(){
  // SITE
  const siteSel=$("siteSel");
  const prevSite=siteSel.value;
  siteSel.replaceChildren();
  opt(siteSel, "", "All Sites");
  for(const s of state.sites) opt(siteSel, String(s.id), s.name);
  siteSel.value = prevSite && [...siteSel.options].some(o=>o.value===prevSite) ? prevSite : "";
  if(!siteSel.value){
    let saved=null;
    try{ saved = localStorage.getItem('elaris_site_id'); }catch(e){}
    if(saved && [...siteSel.options].some(o=>o.value===String(saved))) siteSel.value = String(saved);
  }

  // DEVICE
  const devSel=$("deviceSel");
  const prevDev=devSel.value;
  devSel.replaceChildren();
  opt(devSel, "", "All Devices");
  const devs=[...new Set(state.entities.map(e=>e.device_id).filter(Boolean))].sort();
  for(const d of devs) opt(devSel, d, d);
  devSel.value = prevDev && [...devSel.options].some(o=>o.value===prevDev) ? prevDev : "";

  // ZONE
  const zoneSel=$("zoneSel");
  const prevZone=zoneSel.value;
  zoneSel.replaceChildren();
  opt(zoneSel, "", "All Zones");
  for(const z of state.zones) opt(zoneSel, String(z.id), z.site_id ? z.name : '🌐 '+z.name);
  zoneSel.value = prevZone && [...zoneSel.options].some(o=>o.value===prevZone) ? prevZone : "";

  // TYPE
  const typeSel=$("typeSel");
  const prevType=typeSel.value;
  typeSel.replaceChildren();
  opt(typeSel, "", "All Types");
  for(const t of ["relay","sensor"]) opt(typeSel, t, t);
  typeSel.value = prevType && [...typeSel.options].some(o=>o.value===prevType) ? prevType : "";

  // STATUS
  const stSel=$("statusSel");
  const prevSt=stSel.value;
  stSel.replaceChildren();
  opt(stSel, "", "All Status");
  opt(stSel, "enabled", "enabled");
  opt(stSel, "disabled", "disabled");
  stSel.value = prevSt && [...stSel.options].some(o=>o.value===prevSt) ? prevSt : "";

  // BULK ZONE
  const bz=$("bulkZoneSel");
  bz.replaceChildren();
  opt(bz, "", "(Select zone)");
  opt(bz, "__none__", "(No zone)");
  for(const z of state.zones) opt(bz, String(z.id), z.site_id ? z.name : '🌐 '+z.name);
}

async function loadAll(){
  // role
  try{
    const me=await api("/me");
    state.role = me.role || "USER";
    $("wsPill").textContent = "Role: "+state.role;
  }catch(e){
    $("wsPill").textContent = "Role: ?";
  }

  // sites/zones
  const [sOut, zOut] = await Promise.all([
    api("/sites"),
    api("/zones"),
  ]);
  state.sites = sOut.sites || [];
  state.zones = zOut.zones || [];
  updateSitePill();

  // entities
  await refreshEntities();
}

function updateSitePill(){
  const sel = $("siteSel")?.value;
  if(!sel) return $("sitePill").textContent = "Site: All";
  const s = state.sites.find(x=>String(x.id)===String(sel));
  $("sitePill").textContent = "Site: " + (s?.name || "—");
}

async function refreshEntities(){
  state.selected.clear();
  try{
    const out = await api("/entities");
    state.entities = out.entities || [];
    // Load IO overrides
    try{ const ov=await api('/io/overrides'); state.ioOverrides=ov.overrides||{}; }catch(e){}
  }catch(err){
    state.entities = [];
    $("emptyMsg").style.display="block";
    $("emptyMsg").textContent = "Entities API error: "+err.message;
    setCounts();
    return;
  }
  // Normalize enabled
  state.entities.forEach(e=>{
    if(e.enabled === undefined || e.enabled === null) e.enabled = 1;
  });

  rebuildFilters();
  applyFilterAndRender();
}

function bindUI(){
  $("refreshBtn").addEventListener("click", refreshEntities);
  clearInterval(window._ovrRefreshTm);
  window._ovrRefreshTm = setInterval(refreshOverridesOnly, 15000);

  const filterIds=["q","siteSel","deviceSel","zoneSel","typeSel","statusSel"];
  filterIds.forEach(id=>{
    $(id).addEventListener(id==="q" ? "input" : "change", ()=>{
      if(id==="siteSel"){
        try{ localStorage.setItem('elaris_site_id', String($("siteSel").value||"")); }catch(e){}
      }
      applyFilterAndRender();
    });
  });

  $("chkAll").addEventListener("change", ()=>{
    const on=$("chkAll").checked;
    state.selected.clear();
    if(on){
      for(const e of state.filtered) state.selected.add(e.id);
    }
    applyFilterAndRender();
  });

  $("bulkEnable").addEventListener("click", ()=>bulkDo("enable"));
  $("bulkDisable").addEventListener("click", ()=>bulkDo("disable"));
  $("bulkDelete").addEventListener("click", ()=>bulkDo("delete"));
  $("bulkApplyZone").addEventListener("click", ()=>bulkZone());

  // tabs
  document.querySelectorAll(".tabBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab=btn.dataset.tab;
      $("tab_entities").style.display = (tab==="entities")?"block":"none";
      $("tab_blocked").style.display = (tab==="blocked")?"block":"none";
      $("tab_backup").style.display  = (tab==="backup") ?"block":"none";
    });
  });

  // mobile menu
  const overlay=$("overlay");
  const menuBtn=$("menuBtn");
  if(menuBtn){
    menuBtn.addEventListener("click", ()=>{
      document.body.classList.toggle("sideOpen");
    });
  }
  if(overlay){
    overlay.addEventListener("click", ()=>document.body.classList.remove("sideOpen"));
  }

  // blocked tab actions (optional)
  const br=$("blockedRefresh");
  if(br) br.addEventListener("click", loadBlocked);

  const ub=$("blockedUnblockSel");
  if(ub) ub.addEventListener("click", unblockSelected);

  // backup actions (optional)
  const ex=$("exportBtn");
  if(ex) ex.addEventListener("click", exportConfig);

  const imp=$("importFile");
  if(imp) imp.addEventListener("change", importConfig);
}

async function bulkDo(action){
  if(!state.selected.size) return toast("Select rows first", false);
  if(action==="delete" && !confirm("Delete selected entities?")) return;
  try{
    await api("/io/bulk", {method:"POST", body: JSON.stringify({ action, ids:[...state.selected] })});
    toast("Bulk "+action+" done");
    await refreshEntities();
  }catch(err){
    toast("Bulk failed: "+err.message, false);
  }
}

async function bulkZone(){
  if(!state.selected.size) return toast("Select rows first", false);
  const v=$("bulkZoneSel").value;
  if(!v) return toast("Choose a zone", false);
  const zone_id = (v==="__none__") ? null : Number(v);
  try{
    await api("/io/bulk", {method:"POST", body: JSON.stringify({ action:"zone", ids:[...state.selected], zone_id })});
    toast("Zone applied");
    await refreshEntities();
  }catch(err){
    toast("Zone failed: "+err.message, false);
  }
}

async function loadBlocked(){
  try{
    const out = await api("/blocked-io");
    const rows = out.blocked || [];
    const tbody=$("blockedRows");
    tbody.replaceChildren();
    $("blockedEmpty").style.display = rows.length ? "none":"block";
    const selected=new Set();

    $("blockedChkAll").checked=false;
    $("blockedInfo").textContent="0 selected";

    const chkAll=$("blockedChkAll");
    chkAll.onchange = ()=>{
      selected.clear();
      if(chkAll.checked){
        rows.forEach(r=>selected.add(r.device_id+"|"+r.group_name+"|"+r.key));
      }
      render();
    };

    function render(){
      tbody.replaceChildren();
      rows.forEach(r=>{
        const k=r.device_id+"|"+r.group_name+"|"+r.key;
        const tr=document.createElement("tr");

        const td0=document.createElement("td");
        const c=document.createElement("input");
        c.type="checkbox";
        c.checked=selected.has(k);
        c.onchange=()=>{ c.checked?selected.add(k):selected.delete(k); $("blockedInfo").textContent=`${selected.size} selected`; };
        td0.appendChild(c); tr.appendChild(td0);

        ["device_id","group_name","key"].forEach(col=>{
          const td=document.createElement("td"); td.textContent=r[col]||""; tr.appendChild(td);
        });
        const tdR=document.createElement("td"); tdR.textContent=r.reason||""; tr.appendChild(tdR);

        const tdA=document.createElement("td");
        const b=document.createElement("button");
        b.className="btn danger";
        b.textContent="Unblock";
        b.onclick=async ()=>{
          try{
            await api("/blocked-io", {method:"DELETE", body: JSON.stringify({ device_id:r.device_id, group_name:r.group_name, key:r.key })});
            toast("Unblocked");
            loadBlocked();
          }catch(err){ toast("Unblock failed: "+err.message,false); }
        };
        tdA.appendChild(b);
        tr.appendChild(tdA);

        tbody.appendChild(tr);
      });
    }

    unblockSelected._selected = selected;
    unblockSelected._rows = rows;
    render();
  }catch(err){
    toast("Blocked load failed: "+err.message, false);
  }
}

async function unblockSelected(){
  const selected = unblockSelected._selected;
  const rows = unblockSelected._rows;
  if(!selected || !selected.size) return toast("Select rows first", false);
  if(!confirm("Unblock selected?")) return;
  try{
    for(const k of selected){
      const [device_id, group_name, key] = k.split("|");
      await api("/blocked-io", {method:"DELETE", body: JSON.stringify({ device_id, group_name, key })});
    }
    toast("Unblocked");
    loadBlocked();
  }catch(err){
    toast("Unblock failed: "+err.message,false);
  }
}

async function exportConfig(){
  try{
    const res = await fetch("/api/config/export", { credentials:"same-origin" });
    if(!res.ok) throw new Error(res.status+" "+res.statusText);
    const blob = await res.blob();
    const a=document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const d=new Date();
    const fn=`elaris_config_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.json`;
    a.download = fn;
    a.click();
    URL.revokeObjectURL(a.href);
    $("backupMsg").textContent="Exported.";
  }catch(err){
    $("backupMsg").textContent="Export failed: "+err.message;
    toast("Export failed: "+err.message,false);
  }
}

async function importConfig(e){
  const f=e.target.files?.[0];
  if(!f) return;
  try{
    const txt=await f.text();
    const payload=JSON.parse(txt);
    await api("/config/import", {method:"POST", body: JSON.stringify(payload)});
    $("backupMsg").textContent="Import ok.";
    toast("Import ok");
    await refreshEntities();
  }catch(err){
    $("backupMsg").textContent="Import failed: "+err.message;
    toast("Import failed: "+err.message,false);
  }finally{
    e.target.value="";
  }
}

(async function init(){
  bindUI();
  await loadAll();
  // load blocked if engineer
  try{
    const me=await api("/me");
    const meRole = me.role || "";
    if(meRole === "ENGINEER" || meRole === "ADMIN"){
      loadBlocked();
    }else{
      // hide engineer-only tabs
      $("blockedTabBtn")?.remove();
      $("backupTabBtn")?.remove();
      $("tab_blocked").style.display="none";
      $("tab_backup").style.display="none";
    }
  }catch(e){}
})();

// ── IO Manual Override ────────────────────────────────────────────────────────
function overrideDurationOptions(){
  return [
    { value:'300000', label:'5 minutes' },
    { value:'900000', label:'15 minutes' },
    { value:'1800000', label:'30 minutes' },
    { value:'3600000', label:'1 hour' },
    { value:'14400000', label:'4 hours' },
    { value:'43200000', label:'12 hours' },
    { value:'86400000', label:'24 hours' },
    { value:'PERM', label:'Permanent (until changed)' },
  ];
}

function openOverride(ioId, name, type, key) {
  var m = document.getElementById('ovrModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ovrModal';
    m.className = 'modal';
    m.style.display = 'none';
  m.innerHTML = '<div class="modalCard" style="max-width:420px">'
    + '<div class="modalHead"><div class="modalTitle" id="ovrTitle">Set Manual Value</div><button class="iconBtn" onclick="closeOverride()">✕</button></div>'
    + '<div class="modalBody" style="display:flex;flex-direction:column;gap:14px">'
    + '<div style="font-size:12px;color:var(--muted2)" id="ovrDesc"></div>'
    + '<div style="padding:10px 12px;border:1px solid var(--line2);border-radius:12px;background:rgba(245,158,11,.08);font-size:12px;color:var(--text)" id="ovrBehavior"></div>'
    + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Forced Value</div>'
    + '<div id="ovrInputWrap"></div>'
    + '<input type="hidden" id="ovrHiddenVal" value="'+(curVal||'')+'">'
    + '<div id="ovrInfo"></div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px" id="ovrRealWrap">'
    + '<input type="checkbox" id="ovrRealCheck" checked style="width:16px;height:16px;cursor:pointer">'
    + '<label for="ovrRealCheck" style="font-size:12px;font-weight:700;color:var(--text);cursor:pointer" id="ovrRealLabel">Send to Device (Real)</label>'
    + '</div>'
    + '<div style="font-size:10px;color:var(--muted2);margin-top:6px" id="ovrHint"></div></div>'
    + '<div><div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;margin-bottom:6px">Duration</div>'
    + '<select class="sel" id="ovrDuration"></select>'
    + '<div style="font-size:10px;color:var(--muted2);margin-top:6px">Timed overrides auto-release. Permanent stays active until you clear it.</div></div>'
    + '</div>'
    + '<div class="modalActions">'
    + '<button class="btn" style="color:var(--bad)" onclick="clearOverride(window._ovrId)">Clear (AUTO)</button>'
    + '<button class="btn" onclick="closeOverride()">Cancel</button>'
    + '<button class="btn primary" onclick="applyOverride()">Apply FORCE</button>'
    + '</div></div>';
    m.addEventListener('click', function(e){ if(e.target===m) closeOverride(); });
    document.body.appendChild(m);
  }
  window._ovrId = ioId;
  window._ovrType = type;
  document.getElementById('ovrTitle').textContent = 'Override: ' + (name || 'IO #'+ioId);
  var typeName = String(type||'').toUpperCase();
  
  // Έλεγχος αν είναι DI βάσει του key (π.χ. tele.di_1)
  var isDI = key && (key.includes('di_') || key.toUpperCase().includes('DI'));
  
  var isOutput = typeName === 'DO' || typeName === 'AO' || typeName === 'RELAY' || typeName === 'DIMMER';
  document.getElementById('ovrBehavior').textContent = isOutput
    ? 'Forced OUTPUT hold: while active, automation and scenes will not overwrite this IO.'
    : 'Forced INPUT/STATE: the engine will use this value instead of the real sensor until the override ends.';

  // Type-specific input
  var wrap = document.getElementById('ovrInputWrap');
  var cur = getActiveOverrideLocal(ioId);
  var curVal = cur && cur.active ? cur.value : '';
  document.getElementById('ovrHiddenVal').value = curVal || '';

  // Αν είναι DI (ακόμα και αν ο τύπος είναι sensor), το θεωρούμε Binary (ON/OFF)
  var isBinary = typeName === 'DO' || typeName === 'RELAY' || typeName === 'DI' || isDI;
  var isAnalog = typeName === 'AO' || typeName === 'DIMMER';
  var isNumeric = typeName === 'AI' || typeName === 'SENSOR';
  var isOutputIO = typeName === 'DO' || typeName === 'AO' || typeName === 'RELAY' || typeName === 'DIMMER';
  var realWrap = document.getElementById('ovrRealWrap');

  // Info box — explains what this override does
  var infoBox = document.getElementById('ovrInfo');
  if (isOutputIO) {
    infoBox.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.2);font-size:11px;color:#22d97a;line-height:1.4">'
      + '🟢 <strong>Real Mode:</strong> Sends MQTT command to device. The relay will click or AO voltage will change immediately.'
      + '</div>';
    if (realWrap) realWrap.style.display = 'flex';
  } else {
    infoBox.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);font-size:11px;color:#f59e0b;line-height:1.4">'
      + '🟡 <strong>Virtual Mode:</strong> Changes value in Elaris memory only. The Engine will use this value for automation rules, but the physical sensor state does not change.'
      + '</div>';
    if (realWrap) realWrap.style.display = 'none';
  }

  if (isBinary) {
    document.getElementById('ovrHint').textContent = 'Toggle between ON and OFF';
    wrap.innerHTML = '<div style="display:flex;gap:10px">'
      + '<button id="ovrOn" style="flex:1;padding:14px;border-radius:12px;border:2px solid '+(curVal.toUpperCase()==='ON'?'#22d97a':'var(--line)')+';background:'+(curVal.toUpperCase()==='ON'?'rgba(34,217,122,.12)':'rgba(255,255,255,.03)')+';color:'+(curVal.toUpperCase()==='ON'?'#22d97a':'var(--muted2)')+';font-size:16px;font-weight:800;cursor:pointer">ON</button>'
      + '<button id="ovrOff" style="flex:1;padding:14px;border-radius:12px;border:2px solid '+(curVal.toUpperCase()==='OFF'?'#ef4444':'var(--line)')+';background:'+(curVal.toUpperCase()==='OFF'?'rgba(239,68,68,.12)':'rgba(255,255,255,.03)')+';color:'+(curVal.toUpperCase()==='OFF'?'#ef4444':'var(--muted2)')+';font-size:16px;font-weight:800;cursor:pointer">OFF</button>'
      + '</div>';
    document.getElementById('ovrOn').addEventListener('click', function(){
      this.style.borderColor='#22d97a'; this.style.background='rgba(34,217,122,.12)'; this.style.color='#22d97a';
      var off=document.getElementById('ovrOff'); off.style.borderColor='var(--line)'; off.style.background='rgba(255,255,255,.03)'; off.style.color='var(--muted2)';
      document.getElementById('ovrHiddenVal').value = 'ON';
    });
    document.getElementById('ovrOff').addEventListener('click', function(){
      this.style.borderColor='#ef4444'; this.style.background='rgba(239,68,68,.12)'; this.style.color='#ef4444';
      var on=document.getElementById('ovrOn'); on.style.borderColor='var(--line)'; on.style.background='rgba(255,255,255,.03)'; on.style.color='var(--muted2)';
      document.getElementById('ovrHiddenVal').value = 'OFF';
    });
    window._ovrVal = curVal.toUpperCase() === 'OFF' ? 'OFF' : 'ON';

  } else if (isAnalog) {
    document.getElementById('ovrHint').textContent = '0-100% output level';
    var pct = curVal ? Math.max(0, Math.min(100, Number(curVal))) : 0;
    wrap.innerHTML = '<div style="display:flex;align-items:center;gap:12px">'
      + '<input type="range" id="ovrSlider" min="0" max="100" step="1" value="'+pct+'" style="flex:1">'
      + '<span id="ovrPct" style="font-size:22px;font-weight:900;color:#f5c842;min-width:50px;text-align:center">'+pct+'%</span>'
      + '</div>';
    document.getElementById('ovrSlider').addEventListener('input', function(){
      document.getElementById('ovrPct').textContent = this.value + '%';
      document.getElementById('ovrHiddenVal').value = this.value;
    });
    window._ovrVal = String(pct);

  } else {
    document.getElementById('ovrHint').textContent = 'Numeric value (e.g. 25.5 for temperature, 500 for lux)';
    wrap.innerHTML = '<input class="txt" id="ovrVal" type="number" step="any" placeholder="e.g. 25.5" style="font-size:18px;font-weight:700" value="'+(curVal||'')+'">';
    var numInput = document.getElementById('ovrVal');
    numInput.addEventListener('input', function(){
      document.getElementById('ovrHiddenVal').value = this.value;
    });
    window._ovrVal = curVal || '';
    setTimeout(function(){ numInput.focus(); numInput.select(); }, 50);
  }

  var sel = document.getElementById('ovrDuration');
  sel.innerHTML = overrideDurationOptions().map(function(opt){ return '<option value="'+opt.value+'">'+opt.label+'</option>'; }).join('');
  if(cur && cur.active){
    if(cur.permanent) sel.value = 'PERM';
    else {
      var remaining = Math.max(60000, Number(cur.expires_at || 0) - Date.now());
      var opts = overrideDurationOptions().map(function(o){ return o.value; });
      var closest = opts.filter(function(v){ return v !== 'PERM'; }).sort(function(a,b){ return Math.abs(Number(a)-remaining) - Math.abs(Number(b)-remaining); })[0] || '3600000';
      sel.value = closest;
    }
  } else {
    sel.value = '3600000';
  }
  m.style.display = 'flex';
}
function closeOverride() {
  var m = document.getElementById('ovrModal');
  if (m) m.style.display = 'none';
}
async function applyOverride() {
  var id = window._ovrId;
  var hidden = document.getElementById('ovrHiddenVal');
  var val = hidden ? hidden.value.trim() : (window._ovrVal || '').trim();
  var durationRaw = document.getElementById('ovrDuration') ? document.getElementById('ovrDuration').value : '3600000';
  var isReal = document.getElementById('ovrRealCheck') ? document.getElementById('ovrRealCheck').checked : true;
  
  if (!val && val !== 0) { toast('Enter a value', false); return; }
  try {
    var payload = { value: String(val), active: true, permanent: durationRaw === 'PERM', real: isReal };
    if (durationRaw !== 'PERM') payload.duration_ms = Number(durationRaw);
    
    var out = await api('/io/' + id + '/override', {method:'PATCH', body: JSON.stringify(payload)});
    state.ioOverrides[id] = out.override || { value: val, active: true, ts: Date.now(), permanent: payload.permanent, expires_at: payload.permanent ? null : (Date.now() + Number(payload.duration_ms || 0)) };
    
    closeOverride();
    applyFilterAndRender();
    toast('✅ ' + (isReal ? 'Real command sent: ' : 'Virtual override: ') + val);
  } catch(e) { toast('Error: ' + e.message, false); }
}
async function clearOverride(id) {
  try {
    await api('/io/' + id + '/override', {method:'PATCH', body: JSON.stringify({value: '', active: false})});
    delete state.ioOverrides[id];
    closeOverride();
    applyFilterAndRender();
    toast('Override cleared — AUTO mode');
  } catch(e) { toast('Error: ' + e.message, false); }
}
