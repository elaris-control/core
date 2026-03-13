// ELARIS app.js v22 — clean dashboard, no drag/drop

const $ = id => document.getElementById(id);

const state = {
  role:'USER', user:null, sites:[], siteId:null, siteName:null,
  devices:[], deviceId:null, zones:[], zonesLoaded:false,
  io:[], deviceState:new Map(), ws:null, wsOk:false, lastUpdate:0,
  navPages:[], _moduleInstances:[]
};

function canEngineerUI(){ return state.role==='ENGINEER' || state.role==='ADMIN'; }

function toast(msg,ms=3000){
  const el=$('toast'); if(!el) return;
  el.textContent=msg||'';
  if(ms>0) setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; },ms);
}

async function ensureZonesLoaded(){
  if(state.zonesLoaded) return;
  try{ const o=await api('/zones'); state.zones=o.zones||[]; }
  catch{ state.zones=[]; } finally{ state.zonesLoaded=true; }
}

// Edit entity modal
let _editItem=null;
function openEdit(item){
  _editItem=item; const m=$('editModal'); if(!m) return;
  $('editName').value=item.name||''; $('editDisable').checked=false;
  ensureZonesLoaded().then(()=>{
    const sel=$('editZone'); if(!sel) return; sel.innerHTML='';
    const o0=document.createElement('option'); o0.value=''; o0.textContent='(No zone)'; sel.appendChild(o0);
    (state.zones||[]).forEach(z=>{ const o=document.createElement('option'); o.value=String(z.id); o.textContent=z.name; sel.appendChild(o); });
    sel.value=item.zone_id?String(item.zone_id):'';
  }); m.style.display='flex';
}
function closeEdit(){ const m=$('editModal'); if(m) m.style.display='none'; _editItem=null; }
async function saveEdit(){
  if(!_editItem) return closeEdit();
  const name=$('editName').value.trim();
  const zone_id=$('editZone').value?Number($('editZone').value):null;
  const enabled=$('editDisable').checked?0:1;
  try{ await api('/io/update',{method:'POST',body:JSON.stringify({id:_editItem.id,name,zone_id,enabled})}); toast('Saved'); closeEdit(); await loadDeviceIOAndState(); }
  catch(e){ toast('Save failed: '+e.message); }
}
function bindEditModal(){
  $('editCloseBtn')?.addEventListener('click',closeEdit);
  $('editCancelBtn')?.addEventListener('click',closeEdit);
  $('editSaveBtn')?.addEventListener('click',saveEdit);
  $('editModal')?.addEventListener('click',e=>{ if(e.target?.id==='editModal') closeEdit(); });
}

// API
async function api(path,opts){
  const res=await fetch('/api'+path,{headers:{'Content-Type':'application/json'},...opts});
  if(!res.ok){ let j=null; try{j=await res.json();}catch{} throw new Error(j?.error||'HTTP '+res.status); }
  return res.json();
}

// Sites
function renderSites(){
  const w=$('sitesList'); if(!w) return; w.replaceChildren();
  for(const s of state.sites){
    const d=document.createElement('div'); d.className='item';
    const l=document.createElement('span'); l.textContent=s.name??'';
    const r=document.createElement('span'); r.className='muted'; r.textContent='#'+s.id;
    d.append(l,r); d.onclick=async()=>{ $('sitesMenu')?.classList.remove('show'); await selectSite(s.id); };
    w.appendChild(d);
  }
}
async function selectSite(siteId){
  const s=state.sites.find(x=>x.id===siteId);
  state.siteId=siteId; state.siteName=s?.name||'Site '+siteId;
  try{ localStorage.setItem('elaris_site_id',String(siteId)); }catch{}
  const p=$('sitePill'); if(p) p.textContent='Site: '+state.siteName;
  await loadDevicesForSite(); await loadDeviceIOAndState();
}
async function loadMe(){
  const me = window.ELARIS_ME || await api('/me');
  if(!me.ok||!me.user){ window.location.href='/login.html'; return; }
  const uiRole = (window.elarisComputeUiRole ? window.elarisComputeUiRole(me) : (window.ELARIS_UI_ROLE || me.role || 'USER'));
  state.role=uiRole; state.user=me.user;
  const al=$('adminLink'); if(al) al.style.display=uiRole==='ADMIN'?'':'none';
}
async function loadSites(){
  const o=await api('/sites'); state.sites=o.sites||[]; renderSites();
  let saved=null; try{ saved=Number(localStorage.getItem('elaris_site_id')||''); }catch{}
  const exists=saved&&state.sites.some(s=>s.id===saved);
  if(exists) await selectSite(saved);
  else if(state.sites.length) await selectSite(state.sites[0].id);
}
async function loadDevicesForSite(){
  const o=await api('/sites/'+state.siteId+'/devices');
  const raw=o.devices||[];
  state.devices=raw.map(d=>typeof d==='string'?d:d.id).filter(Boolean);
  state.deviceId=state.devices[0]??null;
}

// Device IO
function renderIO(){
  const list=$('ioList'); if(!list) return; list.innerHTML='';
  if(!state.deviceId||!state.io.length){ const e=$('emptyIo'); if(e) e.style.display='block'; return; }
  const e=$('emptyIo'); if(e) e.style.display='none';
  const all=[...state.io.filter(x=>x.type==='relay'),...state.io.filter(x=>x.type!=='relay')];
  for(const item of all){
    const kf=item.group_name+'.'+item.key; const val=state.deviceState.get(kf);
    const isR=item.type==='relay';
    const row=document.createElement('div'); row.className='listRow'; if(isR) row.setAttribute('data-relay',item.key);
    const left=document.createElement('div'); left.className='rowLeft';
    const tit=document.createElement('div'); tit.className='rowTitle'; tit.textContent=item.name||item.key;
    const meta=document.createElement('div'); meta.className='rowMeta'; meta.textContent=state.deviceId+' \u00b7 '+kf;
    left.appendChild(tit); left.appendChild(meta);
    if(item.zone_name){ const z=document.createElement('span'); z.className='pill miniPill'; z.textContent=item.zone_name; left.appendChild(z); }
    const right=document.createElement('div'); right.className='rowRight';
    if(isR){
      const on=String(val||'').toUpperCase()==='ON';
      if(canEngineerUI()){
        const tgl=document.createElement('button'); tgl.className='tgl '+(on?'on':'off'); tgl.textContent=on?'ON':'OFF'; tgl.setAttribute('data-relay',item.key);
        tgl.onclick=()=>{ if(tgl.classList.contains('pending')) return; sendRelay(item.key,on?'OFF':'ON'); }; right.appendChild(tgl);
      }else{
        const b=document.createElement('span'); b.className='pill valuePill';
        b.textContent=on?'ON':'OFF'; right.appendChild(b);
      }
    }else{
      const b=document.createElement('span'); b.className='pill valuePill'; const u=item.unit?String(item.unit):'';
      b.textContent=val==null?'\u2014':u?String(val)+u:String(val); right.appendChild(b);
    }
    const ed=document.createElement('button'); ed.className='iconBtn editBtn'; ed.textContent='\u270e'; ed.onclick=()=>openEdit(item); right.appendChild(ed);
    row.append(left,right); list.appendChild(row);
  }
}
async function loadDeviceIOAndState(){
  if(!state.deviceId){ state.io=[]; state.deviceState=new Map(); renderIO(); return; }
  const [io,st]=await Promise.all([api('/devices/'+state.deviceId+'/io'),api('/devices/'+state.deviceId+'/state')]);
  state.io=io.io||[]; state.deviceState=new Map((st.state||[]).map(r=>[r.key,r.value])); state.lastUpdate=Date.now();
  for(const k of state.deviceState.keys()){ if(k.startsWith('state.')){ const rk=k.split('.')[1]; if(rk) clearPending(state.deviceId,rk); } }
  renderIO();
}

// Relay pending
const pendingMap=new Map();
function markRelayPending(k,p){ document.querySelectorAll('[data-relay="'+k+'"]').forEach(el=>el.classList.toggle('pending',p)); }
function setPending(dev,k,ms=4500){
  const key=dev+'|'+k; clearPending(dev,k); markRelayPending(k,true);
  const t=setTimeout(()=>{ markRelayPending(k,false); toast('No feedback: '+k); pendingMap.delete(key); },ms); pendingMap.set(key,t);
}
function clearPending(dev,k){
  const key=dev+'|'+k; const t=pendingMap.get(key); if(t) clearTimeout(t); pendingMap.delete(key); markRelayPending(k,false);
}
async function sendRelay(key,val){
  if(!state.deviceId) return; setPending(state.deviceId,key);
  try{ toast('Sending '+key+'='+val+'...'); await api('/devices/'+state.deviceId+'/command',{method:'POST',body:JSON.stringify({key,value:val})}); toast('Sent '+key+'='+val); setTimeout(loadDeviceIOAndState,350); }
  catch(e){ clearPending(state.deviceId,key); toast('Error: '+e.message); }
}

// WS
const sensorLastSeen=new Map();
const STALE_MS=5*60*1000;
function markSensorSeen(k,ts){ sensorLastSeen.set(k,ts||Date.now()); }
function isSensorStale(k){ const t=sensorLastSeen.get(k); return t?(Date.now()-t)>STALE_MS:false; }

let _wsRetryTimer=null,_wsRetryIn=0;
function updateWsBadge(s){
  const el=$('wsPill'); if(!el) return; el.className='pill ws-badge';
  if(s==='online'){ el.className+=' online'; el.textContent='\u25cf Online'; setTimeout(()=>{ if(el.textContent==='\u25cf Online') el.style.opacity='0.5'; },3000); el.style.opacity='1'; }
  else if(s==='offline'){ el.className+=' offline'; el.textContent='\u2715 Offline'; el.style.opacity='1'; }
  else{ el.className+=' connecting'; el.textContent='\u27f3 Connecting\u2026'; el.style.opacity='1'; }
}
function setOffline(off){
  const b=$('offlineBanner'); if(b) b.style.display=off?'block':'none'; updateWsBadge(off?'offline':'online');
}
function startRetryCountdown(sec){
  _wsRetryIn=sec; const el=$('offlineCountdown'); clearInterval(_wsRetryTimer);
  _wsRetryTimer=setInterval(()=>{ _wsRetryIn--; if(el) el.textContent='Reconnecting in '+Math.max(0,_wsRetryIn)+'s...'; if(_wsRetryIn<=0) clearInterval(_wsRetryTimer); },1000);
  if(el) el.textContent='Reconnecting in '+sec+'s...';
}
function connectWS(){
  updateWsBadge('connecting');
  try{
    const proto=location.protocol==='https:'?'wss':'ws';
    const ws=new WebSocket(proto+'://'+location.host+'/ws'); state.ws=ws;
    ws.onopen=()=>{ state.wsOk=true; setOffline(false); clearInterval(_wsRetryTimer); };
    ws.onclose=()=>{ state.wsOk=false; setOffline(true); startRetryCountdown(5); setTimeout(connectWS,5000); };
    ws.onmessage=ev=>{
      let msg; try{ msg=JSON.parse(ev.data); }catch{ return; }
      if(msg.device_id&&msg.state){ for(const[k,v] of Object.entries(msg.state)){ state.deviceState.set(k,v); markSensorSeen(k,msg.ts); } renderIO(); }
      if(msg.type==='mqtt'&&msg.deviceId===state.deviceId&&msg.key){
        if(msg.key.startsWith('tele.')||msg.key.startsWith('state.')){
          state.deviceState.set(msg.key,msg.payload); markSensorSeen(msg.key,msg.ts);
          if(msg.key.startsWith('state.')){ const rk=msg.key.split('.')[1]; if(rk) clearPending(state.deviceId,rk); }
          renderIO();
        }
      }
      if(msg.type==='scene_activated') loadScenesWidget();
    };
  }catch{}
}

// Theme
function toggleTheme(){
  const cur=document.documentElement.dataset.theme||'dark'; const next=cur==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next; localStorage.setItem('elaris_theme',next);
  const b=$('themeBtn'); if(b) b.textContent=next==='dark'?'\u2600\ufe0f':'\ud83c\udf19';
}
function applyTheme(t){
  document.documentElement.dataset.theme=t; const b=$('themeBtn'); if(b) b.textContent=t==='dark'?'\u2600\ufe0f':'\ud83c\udf19';
}

// Sidebar mobile
function openSidebar(){ document.body.classList.add('sideOpen'); }
function closeSidebar(){ document.body.classList.remove('sideOpen'); }

// Clock
let _clockInt=null;
function startClock(){
  if(_clockInt) clearInterval(_clockInt);
  function tick(){
    const now=new Date();
    const te=$('wClockTime'); const de=$('wClockDate');
    if(te) te.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if(de) de.textContent=now.toLocaleDateString([],{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    document.querySelectorAll('.tz-time').forEach(s=>{ try{ s.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:s.dataset.tz}); }catch{} });
  }
  tick(); _clockInt=setInterval(tick,1000);
}

// Weather
function renderWeatherWidget(w){
  if(!w||!w.current) return '';
  var c=w.current, fc=(w.forecast||[]).slice(0,5);
  var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var h='<div>';
  h+='<div style="font-size:38px;font-weight:900;color:var(--orange2)">'+(c.temp||0)+'&deg;</div>';
  h+='<div style="font-size:12px;color:var(--muted2);margin-top:2px">Feels '+(c.feels_like||0)+'&deg; &middot; '+(c.desc||'')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:6px">'+(c.humidity||0)+'% &middot; '+(c.wind_speed||0)+' km/h '+(c.wind_dir||'')+'</div>';
  if(fc.length){
    h+='<div style="display:grid;grid-template-columns:repeat('+fc.length+',1fr);gap:4px;margin-top:10px">';
    fc.forEach(function(d){
      var lbl=d.date?DAYS[new Date(d.date).getDay()]:'';
      h+='<div style="text-align:center;padding:6px 2px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:6px">';
      h+='<div style="font-size:9px;font-weight:800;color:var(--muted)">'+lbl+'</div>';
      h+='<div style="font-size:14px;margin:3px 0">'+(d.emoji||'?')+'</div>';
      h+='<div style="font-size:10px;font-weight:700">'+(d.max||0)+'&deg;</div>';
      h+='<div style="font-size:9px;color:var(--muted)">'+(d.min||0)+'&deg;</div></div>';
    });
    h+='</div>';
  }
  h+='</div>';
  return h;
}

async function loadWeatherWidget(){
  const el=$('weatherContainer'); if(!el||!state.siteId) return;
  try{
    const d=await api('/weather/'+state.siteId);
    el.innerHTML=(d.ok&&d.weather)?renderWeatherWidget(d.weather):'<div style="color:var(--muted);font-size:12px">'+(d.error||'No weather data')+'</div>';
  }catch{ el.innerHTML='<div style="color:var(--muted);font-size:12px">Weather unavailable</div>'; }
}

// Scenes widget
async function loadScenesWidget(){
  const body=$('wScenesBody'); if(!body) return;
  try{
    const d=await api('/scenes'); const scenes=d.scenes||[];
    if(!scenes.length){ body.innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px 0">No scenes yet.</div>'; return; }
    let html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px">';
    scenes.forEach(s=>{
      html+='<button onclick="activateScene('+s.id+',\''+((s.name||'').replace(/'/g,"\\'"))+'\')" style="padding:10px 6px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:'+(s.color||'#6366f1')+'18;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:5px;font-family:inherit">';
      html+='<span style="font-size:22px">'+(s.icon||'\ud83c\udfac')+'</span>';
      html+='<span style="font-size:11px;font-weight:800;color:var(--text)">'+s.name+'</span></button>';
    });
    html+='</div>'; body.innerHTML=html;
  }catch{ body.innerHTML='<div style="color:var(--muted);font-size:12px">Error loading scenes</div>'; }
}
async function activateScene(id,name){
  try{ await fetch('/api/scenes/'+id+'/activate',{method:'POST',headers:{'Content-Type':'application/json'}}); toast('Scene: '+name); }
  catch(e){ toast('Error: '+e.message); }
}

// Module instances
async function loadModuleInstances(){
  try{ const d=await api('/modules/instances'); state._moduleInstances=(d.instances||[]).filter(i=>i.active!==false); }
  catch{ state._moduleInstances=[]; }
}

// Summary cards
async function loadSummaryCards(){
  const grid=$('summaryGrid'); if(!grid) return;
  try{
    const [navD]=await Promise.all([fetch('/api/nav/pages').then(r=>r.json()).catch(()=>({pages:[]}))]);
    const pages=(navD.pages||[]).filter(p=>!p.system);
    const instances=state._moduleInstances||[];
    const MG=[
      {id:'solar',            icon:'☀️', label:'Solar',           color:'#ff9a3a'},
      {id:'thermostat',       icon:'🌡️', label:'Heating',         color:'#1d8cff'},
      {id:'lighting',         icon:'💡', label:'Lighting',        color:'#f5c842'},
      {id:'smart_lighting',   icon:'✨', label:'Smart Lighting',  color:'#f0c040'},
      {id:'energy',           icon:'⚡', label:'Energy',          color:'#f59e0b'},
      {id:'custom',           icon:'⚙️', label:'Automation',      color:'#a855f7'},
      {id:'awning',           icon:'🪟', label:'Shutters',        color:'#22d97a'},
      {id:'irrigation',       icon:'🌱', label:'Irrigation',      color:'#22d97a'},
      {id:'pool_spa',         icon:'🏊', label:'Pool & Spa',      color:'#06b6d4'},
      {id:'water_manager',    icon:'💧', label:'Water',           color:'#3ab8ff'},
      {id:'hydronic_manager', icon:'♨️', label:'Hydronic',        color:'#ff6b35'},
      {id:'load_shifter',     icon:'🔋', label:'Load Shifter',    color:'#a855f7'},
      {id:'maintenance',      icon:'🔧', label:'Maintenance',     color:'#64748b'},
      {id:'presence_simulator', icon:'👤', label:'Presence',      color:'#6366f1'},
    ];
    let cards='';
    for(const mg of MG){
      const insts=instances.filter(i=>i.module_id===mg.id); if(!insts.length) continue;
      cards+='<a class="sum-card" href="/page.html?module='+mg.id+'" style="border-left:3px solid '+mg.color+'33">';
      cards+='<span class="sum-icon">'+mg.icon+'</span><span class="sum-info"><div class="sum-name">'+mg.label+'</div>';
      cards+='<div class="sum-status">'+insts.length+' instance'+(insts.length!==1?'s':'')+'</div></span><span style="color:var(--muted);">&rsaquo;</span></a>';
    }
    for(const page of pages){
      const ids=JSON.parse(page.instances_json||'[]');
      cards+='<a class="sum-card" href="/page.html?id='+page.id+'" style="border-left:3px solid rgba(99,102,241,.3)">';
      cards+='<span class="sum-icon">'+(page.icon||'\ud83d\udcc4')+'</span><span class="sum-info"><div class="sum-name">'+page.name+'</div>';
      cards+='<div class="sum-status">'+ids.length+' module'+(ids.length!==1?'s':'')+'</div></span><span style="color:var(--muted);">&rsaquo;</span></a>';
    }
    grid.innerHTML=cards||(canEngineerUI() ? '<div style="color:var(--muted);font-size:12px;grid-column:1/-1">No modules. <a href="/modules.html" style="color:var(--blue)">Add modules &rarr;</a></div>' : '<div style="color:var(--muted);font-size:12px;grid-column:1/-1">No modules yet.</div>');
  }catch{ grid.innerHTML='<div style="color:var(--muted);font-size:12px">Error</div>'; }
}

// Events
async function loadEventsWidget(){
  const body=$('eventsBody'); if(!body) return;
  try{
    const d=await api('/logs?limit=12'); const logs=d.logs||[];
    if(!logs.length){ body.innerHTML='<div style="color:var(--muted);font-size:12px">No recent events.</div>'; return; }
    body.innerHTML=logs.map(log=>{
      const t=new Date(log.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      return '<div class="ev-row"><span class="ev-time">'+t+'</span><span class="ev-action">'+(log.action||'\u2014')+'</span><span class="ev-reason">'+(log.reason||'')+'</span></div>';
    }).join('');
  }catch{ body.innerHTML='<div style="color:var(--muted);font-size:12px">No recent events.</div>'; }
}

// Nav pages
async function loadNavPages(){
  try{ const d=await fetch('/api/nav/pages').then(r=>r.json()).catch(()=>({pages:[]})); state.navPages=d.pages||[]; renderNav(); }catch{}
}
function renderNav(){
  const c=$('navContainer'); if(!c) return;
  const custom=state.navPages.filter(p=>!p.system);
  if(!custom.length){ c.innerHTML=''; return; }
  c.innerHTML='<div class="groupTitle">My Pages</div><nav class="nav">'+
    custom.map(p=>'<a href="/page.html?id='+p.id+'">'+(p.icon||'\ud83d\udcc4')+' '+p.name+'</a>').join('')+'</nav>';
}

// Page manager
function openPageManager(){ if(!canEngineerUI()) return toast('Engineer access required'); loadPmPages(); $('pageManagerModal').style.display='flex'; }
function closePageManager(){ $('pageManagerModal').style.display='none'; }
async function loadPmPages(){
  const el=$('pmPagesList'); if(!el) return;
  const d=await fetch('/api/nav/pages').then(r=>r.json()).catch(()=>({pages:[]}));
  const custom=(d.pages||[]).filter(p=>!p.system);
  if(!custom.length){ el.innerHTML='<div style="color:var(--muted);font-size:12px">No custom pages yet.</div>'; return; }
  el.innerHTML=custom.map(p=>{
    const cnt=JSON.parse(p.instances_json||'[]').length;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)">'+
      '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">'+(p.icon||'\ud83d\udcc4')+'</span>'+
      '<div><div style="font-weight:800;font-size:13px">'+p.name+'</div><div style="font-size:11px;color:var(--muted)">'+cnt+' modules</div></div></div>'+
      '<div style="display:flex;gap:6px">'+
      '<a href="/page.html?id='+p.id+'" class="btn" style="padding:4px 10px;font-size:11px;text-decoration:none">Open</a>'+
      '<button class="btn" style="padding:4px 10px;font-size:11px" onclick="openPageEditor('+p.id+')">Edit</button>'+
      '<button class="btn" style="padding:4px 10px;font-size:11px;background:rgba(255,69,69,.1);border-color:rgba(255,69,69,.3);color:var(--bad)" onclick="deletePage('+p.id+')">Del</button>'+
      '</div></div>';
  }).join('');
}

let _peEditId=null;
async function openPageEditor(editId){
  if(!canEngineerUI()) return toast('Engineer access required');
  _peEditId=editId; $('peTitle').textContent=editId?'Edit Page':'New Page';
  $('pe_icon').value=''; $('pe_name').value='';
  await loadModuleInstances();
  const instances=state._moduleInstances||[];
  const MI={solar:'\u2600\ufe0f',thermostat:'\ud83c\udf21\ufe0f',lighting:'\ud83d\udca1',energy:'\u26a1',custom:'\u2699\ufe0f',awning:'\ud83e\ude9f'};
  let selectedIds=[];
  if(editId){
    const d=await fetch('/api/nav/pages').then(r=>r.json()).catch(()=>({pages:[]}));
    const pg=(d.pages||[]).find(p=>p.id===editId);
    if(pg){ $('pe_icon').value=pg.icon||''; $('pe_name').value=pg.name||''; selectedIds=JSON.parse(pg.instances_json||'[]'); }
  }
  const el=$('pe_instances'); if(!el) return;
  if(!instances.length){ el.innerHTML='<div style="color:var(--muted);font-size:12px">No modules yet. <a href="/modules.html" style="color:var(--blue)">Add modules</a></div>'; }
  else{
    el.innerHTML=instances.map(inst=>{
      const icon=MI[inst.module_id]||'\ud83d\udce6'; const chk=selectedIds.includes(inst.id)?'checked':'';
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);cursor:pointer">'+
        '<input type="checkbox" value="'+inst.id+'" '+chk+' style="width:16px;height:16px">'+
        '<span style="font-size:16px">'+icon+'</span><span>'+
        '<div style="font-weight:800;font-size:13px">'+(inst.name||'Instance #'+inst.id)+'</div>'+
        '<div style="font-size:11px;color:var(--muted)">'+inst.module_id+'</div></span></label>';
    }).join('');
  }
  $('pageEditorModal').style.display='flex';
}
function closePageEditor(){ $('pageEditorModal').style.display='none'; }
async function savePage(){
  if(!canEngineerUI()) return toast('Engineer access required');
  const name=$('pe_name').value.trim(); const icon=$('pe_icon').value.trim()||'\ud83d\udcc4';
  if(!name){ toast('Enter a name'); return; }
  const ids=Array.from(document.querySelectorAll('#pe_instances input:checked')).map(c=>Number(c.value));
  try{
    const url='/api/nav/pages'+(_peEditId?'/'+_peEditId:'');
    const method=_peEditId?'PUT':'POST';
    await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({name,icon,instances:ids})});
    closePageEditor(); closePageManager(); await loadNavPages(); await loadSummaryCards(); toast('Page saved');
  }catch(e){ toast('Error: '+e.message); }
}
async function deletePage(id){
  if(!canEngineerUI()) return toast('Engineer access required');
  if(!confirm('Delete this page?')) return;
  await fetch('/api/nav/pages/'+id,{method:'DELETE'});
  await loadNavPages(); await loadPmPages(); await loadSummaryCards(); toast('Page deleted');
}

// UI bindings
document.addEventListener('DOMContentLoaded',()=>{
  $('sitesBtn')?.addEventListener('click',()=>$('sitesMenu')?.classList.toggle('show'));
  document.addEventListener('click',e=>{ if(!e.target.closest('.dropdown')) $('sitesMenu')?.classList.remove('show'); });
  $('addSiteBtn')?.addEventListener('click',async()=>{
    $('sitesMenu')?.classList.remove('show'); const name=prompt('New site name:'); if(!name) return;
    try{ await api('/sites',{method:'POST',body:JSON.stringify({name})}); await loadSites(); toast('Site created.'); }
    catch(e){ toast('Failed: '+e.message); }
  });
  const mb=$('menuBtn'); if(mb){ mb.style.display=''; mb.onclick=openSidebar; }
  document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>closeSidebar()));
  document.querySelectorAll('.side a').forEach(a=>{ if(a.href===location.href) a.classList.add('active'); });
  applyTheme(localStorage.getItem('elaris_theme')||'dark');
  bindEditModal();
});

// Boot
(async function(){
  try{
    applyTheme(localStorage.getItem('elaris_theme')||'dark');
    await loadMe();
    await loadSites();
    await loadDeviceIOAndState();
    connectWS();
    await loadModuleInstances();
    startClock();
    await Promise.all([loadWeatherWidget(),loadScenesWidget(),loadSummaryCards(),loadEventsWidget(),loadNavPages()]);
    setInterval(loadWeatherWidget,15*60*1000);
    setInterval(loadEventsWidget,60*1000);
    setInterval(loadScenesWidget,30*1000);
    setInterval(loadSummaryCards,60*1000);
  }catch(e){
    console.error('[ELARIS] Boot error:',e);
    const t=$('toast'); if(t) t.textContent='Init error: '+e.message;
  }
})();
