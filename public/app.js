// ELARIS app.js v22 — clean dashboard, no drag/drop
// Shared utilities ($, escapeHTML, api, toast) are in /js/core.js

const state = {
  role:'USER', user:null, sites:[], siteId:null, siteName:null,
  devices:[], deviceId:null, zones:[], zonesLoaded:false,
  io:[], deviceState:new Map(), ws:null, wsOk:false, lastUpdate:0,
  navPages:[], _moduleInstances:[]
};

function canEngineerUI(){ return state.role==='ENGINEER' || state.role==='ADMIN'; }

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
    (state.zones||[]).forEach(z=>{ const o=document.createElement('option'); o.value=String(z.id); o.textContent=z.site_id?z.name:'🌐 '+z.name; sel.appendChild(o); });
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

// Sites
function renderSites(){
  const w=$('sitesList'); if(!w) return; w.replaceChildren();
  for(const s of state.sites){
    const d=document.createElement('div'); d.className='item';
    const l=document.createElement('span');
    l.textContent=(s.is_private?'🔒 ':'')+(s.name??'');
    const r=document.createElement('span'); r.className='muted'; r.textContent='#'+s.id;
    d.append(l,r); d.onclick=async()=>{ $('sitesMenu')?.classList.remove('show'); await selectSite(s.id); };
    if(s.id===state.siteId) d.style.color='var(--blue)';
    w.appendChild(d);
  }
}
async function selectSite(siteId){
  const s=state.sites.find(x=>x.id===siteId);
  state.siteId=siteId; state.siteName=s?.name||'Site '+siteId;
  try{ localStorage.setItem('elaris_site_id',String(siteId)); }catch{}
  const p=$('sitePill'); if(p) p.textContent=(s?.is_private?'🔒 ':'')+'Site: '+state.siteName;
  renderSites();
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
  sendWsScope();
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
function sendWsScope(){
  try{
    const ws=state.ws;
    if(!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type:'register_client', siteId:state.siteId||null, deviceId:state.deviceId||null }));
  }catch{}
}
function connectWS(){
  updateWsBadge('connecting');
  try{
    const proto=location.protocol==='https:'?'wss':'ws';
    const ws=new WebSocket(proto+'://'+location.host+'/ws'); state.ws=ws;
    ws.onopen=()=>{ state.wsOk=true; setOffline(false); clearInterval(_wsRetryTimer); sendWsScope(); };
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
var _clockStyle = parseInt(localStorage.getItem('elaris_clock_style')||'0',10);
var _sunRise = null, _sunSet = null; // HH:MM strings from weather
function setClockStyle(n, btn){
  _clockStyle=n;
  localStorage.setItem('elaris_clock_style',n);
  document.querySelectorAll('.clock-style-btn').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  renderClockFrame();
}
function renderClockFrame(){
  var el=$('clockWidget'); if(!el) return;
  if(_clockStyle===0){
    el.innerHTML='<div class="ck-a"><div class="ck-time"><span id="wClockHM">--:--</span><span class="ck-sec" id="wClockSec">00</span></div><div class="ck-date" id="wClockDate">--</div><div class="ck-prog"><div class="ck-prog-fill" id="wDayProg" style="width:0%"></div></div><div class="ck-sun"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  } else if(_clockStyle===1){
    // Arc: viewBox 160x160, r=70, circumference≈440
    el.innerHTML='<div class="ck-b"><div class="ck-arc-wrap"><svg viewBox="0 0 160 160" class="ck-arc-svg"><circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="6"/><circle id="wArcFill" cx="80" cy="80" r="70" fill="none" stroke="var(--blue)" stroke-width="6" stroke-linecap="round" stroke-dasharray="440" stroke-dashoffset="440" transform="rotate(-90 80 80)"/></svg><div class="ck-arc-inner"><div class="ck-time" id="wClockHM">--:--</div><div class="ck-sec-sm" id="wClockSec2">00s</div><div class="ck-date" id="wClockDate">--</div></div></div><div class="ck-sun-row"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  } else if(_clockStyle===2){
    el.innerHTML='<div class="ck-c"><div class="ck-time" id="wClockHM">--:--</div><div class="ck-secbar"><div class="ck-secbar-fill" id="wSecBar" style="width:0%"></div></div><div class="ck-date" id="wClockDate">--</div><div class="ck-sun-row"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  } else if(_clockStyle===3){
    // Box style
    el.innerHTML='<div class="ck-d"><div class="ck-d-row"><div class="ck-d-block" id="wClockHH">--</div><div class="ck-d-sep">:</div><div class="ck-d-block" id="wClockMM">--</div></div><div class="ck-secbar"><div class="ck-secbar-fill" id="wSecBar" style="width:0%"></div></div><div class="ck-date" id="wClockDate">--</div><div class="ck-sun-row"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  } else if(_clockStyle===4){
    // Horizon style
    el.innerHTML='<div class="ck-e"><div class="ck-time" id="wClockHM">--:--</div><div class="ck-e-arc"><div class="ck-e-track"><div class="ck-e-dot" id="wSunDot" style="left:50%"></div></div><div class="ck-e-labels"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div><div class="ck-date" id="wClockDate">--</div></div>';
  } else if(_clockStyle===5){
    // Analog clock
    var marks5='';
    for(var mi=0;mi<12;mi++){var a5=mi*30*Math.PI/180;var r1=mi%3===0?62:70;var r2=74;marks5+='<line x1="'+(80+r1*Math.sin(a5)).toFixed(1)+'" y1="'+(80-r1*Math.cos(a5)).toFixed(1)+'" x2="'+(80+r2*Math.sin(a5)).toFixed(1)+'" y2="'+(80-r2*Math.cos(a5)).toFixed(1)+'" stroke="rgba(255,255,255,'+(mi%3===0?.3:.12)+')" stroke-width="'+(mi%3===0?2:1)+'"/>';}
    el.innerHTML='<div class="ck-f"><svg viewBox="0 0 160 160" width="140" height="140"><circle cx="80" cy="80" r="76" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.1)" stroke-width="2"/>'+marks5+'<line id="wAnalogH" x1="80" y1="80" x2="80" y2="44" stroke="var(--text)" stroke-width="5" stroke-linecap="round"/><line id="wAnalogM" x1="80" y1="80" x2="80" y2="28" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/><line id="wAnalogS" x1="80" y1="80" x2="80" y2="24" stroke="var(--blue)" stroke-width="1.5" stroke-linecap="round"/><circle cx="80" cy="80" r="4" fill="var(--blue)"/></svg><div class="ck-date" id="wClockDate">--</div><div class="ck-sun"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  } else {
    // Word clock
    el.innerHTML='<div class="ck-g"><div class="ck-g-phrase" id="wWordBody"></div><div class="ck-date" id="wClockDate">--</div><div class="ck-sun"><span id="wSunR">&#9728; --:--</span><span id="wSunS">&#9790; --:--</span></div></div>';
  }
  document.querySelectorAll('.clock-style-btn').forEach(function(b,i){b.classList.toggle('active',i===_clockStyle);});
}
function getWordClockWords(now){
  var HOURS=['','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE'];
  var h=now.getHours()%12||12, m=now.getMinutes();
  var seg=Math.round(m/5); if(seg===12){seg=0;h=h%12+1;}
  var lines=['IT IS'];
  if(seg===0){ lines.push(HOURS[h]); lines.push("O'CLOCK"); }
  else if(seg<=6){ var mins=[null,'FIVE','TEN','QUARTER','TWENTY','TWENTY FIVE','HALF'][seg]; mins.split(' ').forEach(function(w){lines.push(w);}); lines.push('PAST'); lines.push(HOURS[h]); }
  else{ var toH=h%12+1; var mins2=[null,'FIVE','TEN','QUARTER','TWENTY','TWENTY FIVE','HALF'][12-seg]; mins2.split(' ').forEach(function(w){lines.push(w);}); lines.push('TO'); lines.push(HOURS[toH]); }
  return lines;
}

let _clockInt=null;
function startClock(){
  if(_clockInt) clearInterval(_clockInt);
  renderClockFrame();
  function tick(){
    var now=new Date();
    var hm=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    var sec=now.getSeconds();
    var dateStr=now.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    var dayPct=((now.getHours()*3600+now.getMinutes()*60+sec)/86400*100).toFixed(1);
    var hm2=$('wClockHM'), de=$('wClockDate');
    if(hm2) hm2.textContent=hm;
    if(de) de.textContent=dateStr;
    if(_clockStyle===0){
      var sc=$('wClockSec'); if(sc) sc.textContent=(sec<10?'0':'')+sec;
      var dp=$('wDayProg'); if(dp) dp.style.width=dayPct+'%';
    } else if(_clockStyle===1){
      var arc=$('wArcFill');
      if(arc){ var offset=440-(sec/60*440); arc.setAttribute('stroke-dashoffset',offset.toFixed(1)); }
      var sc2=$('wClockSec2'); if(sc2) sc2.textContent=(sec<10?'0':'')+sec+'s';
    } else if(_clockStyle===2){
      var sb=$('wSecBar'); if(sb) sb.style.width=(sec/59*100)+'%';
    } else if(_clockStyle===3){
      var hh=$('wClockHH'); if(hh) hh.textContent=(now.getHours()<10?'0':'')+now.getHours();
      var mm=$('wClockMM'); if(mm) mm.textContent=(now.getMinutes()<10?'0':'')+now.getMinutes();
      var sb3=$('wSecBar'); if(sb3) sb3.style.width=(sec/59*100)+'%';
    } else if(_clockStyle===4){
      var nowMin=now.getHours()*60+now.getMinutes();
      var dot=$('wSunDot');
      if(dot) dot.style.left=(nowMin/1440*100).toFixed(1)+'%';
    } else if(_clockStyle===5){
      var nowH5=now.getHours()%12,nowM5=now.getMinutes(),nowS5=now.getSeconds();
      var hAng5=(nowH5+nowM5/60+nowS5/3600)/12*360;
      var mAng5=(nowM5+nowS5/60)/60*360;
      var sAng5=nowS5/60*360;
      var setHand=function(id,ang,len){var el2=document.getElementById(id);if(!el2)return;var rad=ang*Math.PI/180;el2.setAttribute('x2',(80+len*Math.sin(rad)).toFixed(1));el2.setAttribute('y2',(80-len*Math.cos(rad)).toFixed(1));};
      setHand('wAnalogH',hAng5,38);setHand('wAnalogM',mAng5,55);setHand('wAnalogS',sAng5,60);
    } else if(_clockStyle===6){
      var wb=document.getElementById('wWordBody');
      if(wb){ var words6=getWordClockWords(now); wb.innerHTML=words6.map(function(w){return '<span class="ck-g-word">'+w+'</span>';}).join(''); }
    }
    // Generic sun update for all styles
    var srEl=document.getElementById('wSunR'); if(srEl) srEl.textContent='\u2600 '+(_sunRise||'--:--');
    var ssEl=document.getElementById('wSunS'); if(ssEl) ssEl.textContent='\u263D '+(_sunSet||'--:--');
    document.querySelectorAll('.tz-time').forEach(function(s){ try{ s.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:s.dataset.tz}); }catch{} });
  }
  tick(); _clockInt=setInterval(tick,1000);
}

// Weather
function wmoGradient(code, isDay){
  var d=isDay!==false;
  if(code===0) return d?'linear-gradient(135deg,#0c4a6e,#0369a1)':'linear-gradient(135deg,#0f172a,#1e1b4b)';
  if(code<=2)  return d?'linear-gradient(135deg,#1e3a5f,#334155)':'linear-gradient(135deg,#0f172a,#1e293b)';
  if(code<=3)  return 'linear-gradient(135deg,#1e293b,#334155)';
  if(code<=48) return 'linear-gradient(135deg,#374151,#4b5563)';
  if(code<=65) return 'linear-gradient(135deg,#082f49,#1e3a5f)';
  if(code<=75) return 'linear-gradient(135deg,#1e3a5f,#3b82f6)';
  if(code<=82) return 'linear-gradient(135deg,#0c4a6e,#1e3a5f)';
  return 'linear-gradient(135deg,#1e1b4b,#312e81)';
}
function renderWeatherMinimal(w){
  if(!w||!w.current) return '<div style="color:var(--muted);font-size:12px">No weather data</div>';
  var c=w.current;
  var fc=(w.forecast||[]).slice(0,5);
  var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var grad=wmoGradient(c.code,c.is_day);
  var tabS='display:inline-block;padding:4px 12px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted2);font-family:inherit;';
  var tabA='background:rgba(29,140,255,.12);border-color:var(--blue);color:var(--blue);';
  var h='';
  // Tabs
  h+='<div style="display:flex;gap:6px;margin-bottom:10px">';
  h+='<button style="'+tabS+tabA+'" onclick="wTab(0,this)">Today</button>';
  h+='<button style="'+tabS+'" onclick="wTab(1,this)">5 Days</button>';
  h+='</div>';
  // TODAY tab
  h+='<div id="wTabToday">';
  h+='<div style="background:'+grad+';border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:8px">';
  h+=meteoconImg(c.code,c.is_day,60);
  h+='<div style="flex:1;min-width:0"><div style="font-size:44px;font-weight:900;line-height:1;color:#fff">'+c.temp+'<span style="font-size:18px;opacity:.65">°</span></div>';
  h+='<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.desc+'</div></div>';
  h+='<div style="text-align:right;font-size:11px;color:rgba(255,255,255,.6);line-height:1.9;flex-shrink:0">';
  h+='<div>&#128167; '+c.humidity+'%</div><div>&#128168; '+c.wind_speed+'km/h</div></div></div>';
  h+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted2)">';
  h+='<span>&#9728; '+(_sunRise||w.sunrise||'--:--')+'</span>';
  h+='<span>Feels '+c.feels_like+'°</span>';
  h+='<span>&#9790; '+(_sunSet||w.sunset||'--:--')+'</span>';
  h+='</div></div>';
  // WEEK tab
  h+='<div id="wTabWeek" style="display:none">';
  if(fc.length){
    var allMin=Math.min.apply(null,fc.map(function(d){return d.min;}));
    var allMax=Math.max.apply(null,fc.map(function(d){return d.max;}));
    var rng=Math.max(allMax-allMin,1);
    fc.forEach(function(d,i){
      var lbl=d.date?DAYS[new Date(d.date+'T12:00:00').getDay()]:'';
      var isToday=i===0;
      var barW=Math.round(((d.max-allMin)/rng)*100);
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 2px;'+(i<fc.length-1?'border-bottom:1px solid var(--line)':'')+'">';
      h+='<div style="font-size:11px;font-weight:800;color:'+(isToday?'var(--blue)':'var(--muted2)')+';width:28px;flex-shrink:0">'+(isToday?'NOW':lbl)+'</div>';
      h+=meteoconImg(d.code,true,22);
      h+='<div style="font-size:10px;color:var(--muted2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+d.desc+'</div>';
      h+='<div style="font-size:10px;color:var(--muted2);flex-shrink:0;width:22px;text-align:right">'+d.min+'°</div>';
      h+='<div style="width:36px;height:3px;background:rgba(255,255,255,.08);border-radius:2px;flex-shrink:0;position:relative"><div style="position:absolute;left:0;top:0;height:3px;background:var(--blue);border-radius:2px;width:'+barW+'%"></div></div>';
      h+='<div style="font-size:11px;font-weight:700;width:22px;text-align:right;flex-shrink:0">'+d.max+'°</div>';
      h+='</div>';
    });
  }
  h+='</div>';
  return h;
}
function wmoToMeteocon(code, isDay) {
  var d = isDay !== false;
  var map = {
    0: d?'clear-day':'clear-night',
    1: d?'mostly-clear-day':'mostly-clear-night',
    2: d?'partly-cloudy-day':'partly-cloudy-night',
    3: 'overcast',
    45:'fog', 48:'extreme-fog',
    51:'drizzle', 53:'drizzle', 55:'extreme-drizzle',
    61:'rain', 63:'rain', 65:'extreme-rain',
    71:'snow', 73:'snow', 75:'extreme-snow',
    80:'rain', 81:'rain', 82:'extreme-rain',
    95:'thunderstorms', 96:'thunderstorms-rain', 99:'thunderstorms-extreme-rain',
  };
  return map[code] || 'not-available';
}
function meteoconImg(code, isDay, size) {
  var name = wmoToMeteocon(code, isDay);
  var sz = size || 48;
  return '<img src="https://api.iconify.design/meteocons:'+name+'.svg" width="'+sz+'" height="'+sz+'" style="display:block" alt="" onerror="this.style.display=\'none\'">';
}
function renderWeatherWidget(w){
  if(!w||!w.current) return '';
  var c=w.current, fc=(w.forecast||[]).slice(0,5);
  var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var tabStyle='display:inline-block;padding:5px 14px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted2);font-family:inherit;';
  var tabActiveStyle='background:rgba(29,140,255,.12);border-color:var(--blue);color:var(--blue);';
  var h='<div>';
  // Tabs
  h+='<div style="display:flex;gap:6px;margin-bottom:12px">';
  h+='<button style="'+tabStyle+tabActiveStyle+'" onclick="wTab(0,this)">Today</button>';
  h+='<button style="'+tabStyle+'" onclick="wTab(1,this)">5 Days</button>';
  h+='</div>';
  // Today tab
  h+='<div id="wTabToday">';
  h+='<div style="display:flex;align-items:center;gap:12px">';
  h+=meteoconImg(c.code, c.is_day, 64);
  h+='<div>';
  h+='<div style="font-size:42px;font-weight:900;line-height:1;color:var(--text)">'+c.temp+'<span style="font-size:20px;color:var(--muted2)">&deg;</span></div>';
  h+='<div style="font-size:12px;color:var(--muted2);margin-top:2px">'+c.desc+'</div>';
  h+='</div></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px">';
  h+='<div style="text-align:center;padding:8px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:8px"><div style="font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Feels</div><div style="font-size:15px;font-weight:700;margin-top:3px">'+c.feels_like+'&deg;</div></div>';
  h+='<div style="text-align:center;padding:8px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:8px"><div style="font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Humidity</div><div style="font-size:15px;font-weight:700;margin-top:3px">'+c.humidity+'%</div></div>';
  h+='<div style="text-align:center;padding:8px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:8px"><div style="font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Wind</div><div style="font-size:15px;font-weight:700;margin-top:3px">'+c.wind_speed+'<span style="font-size:10px;color:var(--muted2)">km/h '+c.wind_dir+'</span></div></div>';
  h+='</div></div>';
  // Week tab
  h+='<div id="wTabWeek" style="display:none">';
  fc.forEach(function(d,i){
    var lbl=d.date?DAYS[new Date(d.date+'T12:00:00').getDay()]:'';
    var isToday=i===0;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--line)'+(i===fc.length-1?';border-bottom:none':'')+'">';
    h+='<div style="font-size:11px;font-weight:800;color:'+(isToday?'var(--blue)':'var(--muted2)')+';width:28px">'+(isToday?'NOW':lbl)+'</div>';
    h+=meteoconImg(d.code, true, 28);
    h+='<div style="font-size:11px;color:var(--muted2);flex:1">'+d.desc+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2)">'+d.min+'&deg;</div>';
    h+='<div style="width:40px;height:4px;background:rgba(255,255,255,.08);border-radius:2px;margin:0 4px;position:relative"><div style="position:absolute;left:0;top:0;height:4px;background:var(--blue);border-radius:2px;width:'+(fc.length>1?Math.round(((d.max-(Math.min.apply(null,fc.map(function(x){return x.min;}))))/(((Math.max.apply(null,fc.map(function(x){return x.max;})))-(Math.min.apply(null,fc.map(function(x){return x.min;}))||1))))*100)+'%':50+'%')+'"></div></div>';
    h+='<div style="font-size:12px;font-weight:700;width:26px;text-align:right">'+d.max+'&deg;</div>';
    if(d.precip>0) h+='<div style="font-size:10px;color:#60a5fa;width:28px;text-align:right">'+d.precip+'mm</div>';
    h+='</div>';
  });
  h+='</div>';
  h+='</div>';
  return h;
}

function wTab(idx, btn){
  var tod=$('wTabToday'), wk=$('wTabWeek');
  if(tod) tod.style.display=idx===0?'':'none';
  if(wk)  wk.style.display=idx===1?'':'none';
  var btns=btn&&btn.parentElement?btn.parentElement.querySelectorAll('button'):[];
  btns.forEach(function(b){b.style.background='transparent';b.style.borderColor='var(--line)';b.style.color='var(--muted2)';});
  if(btn){btn.style.background='rgba(29,140,255,.12)';btn.style.borderColor='var(--blue)';btn.style.color='var(--blue)';}
}
async function loadWeatherWidget(){
  const el=$('weatherContainer'); if(!el||!state.siteId) return;
  try{
    const d=await api('/weather/'+state.siteId);
    if(d.ok&&d.weather){
      if(d.weather.sunrise) _sunRise=d.weather.sunrise;
      if(d.weather.sunset)  _sunSet=d.weather.sunset;
      el.innerHTML=renderWeatherMinimal(d.weather);
    } else {
      el.innerHTML='<div style="color:var(--muted);font-size:12px">'+(d.error||'No weather data')+'</div>';
    }
  }catch{ el.innerHTML='<div style="color:var(--muted);font-size:12px">Weather unavailable</div>'; }
}

// Scenes widget
async function loadScenesWidget(){
  const body=$('wScenesBody'); if(!body) return;
  try{
    const sid=state.siteId;
    const d=await api('/scenes'+(sid?'?site_id='+sid:'')); const scenes=d.scenes||[];
    if(!scenes.length){ body.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">No scenes yet. <a href="/scenes.html" style="color:var(--blue)">Create one &rarr;</a></div>'; return; }
    let html='<div class="summary-grid">';
    scenes.forEach(s=>{
      var col=s.color||'#6366f1';
      var sn=(s.name||'').replace(/'/g,"\\'");
      html+='<div class="sum-card" onclick="activateScene('+s.id+',\''+sn+'\')" id="sbtn-'+s.id+'" style="border-left:3px solid '+col+'88;cursor:pointer">';
      html+='<span class="sum-icon">'+escapeHTML(s.icon||'\ud83c\udfac')+'</span>';
      html+='<span class="sum-info"><div class="sum-name">'+escapeHTML(s.name)+'</div>';
      html+='<div class="sum-status">\u25b6 Activate</div></span></div>';
    });
    html+='</div>'; body.innerHTML=html;
  }catch{ body.innerHTML='<div style="color:var(--muted);font-size:12px">Error loading scenes</div>'; }
}
async function activateScene(id,name){
  const card=document.getElementById('sbtn-'+id);
  const st=card?card.querySelector('.sum-status'):null;
  if(st){st.textContent='\u23f3 Running\u2026';}
  try{
    await fetch('/api/scenes/'+id+'/activate',{method:'POST',headers:{'Content-Type':'application/json'}});
    toast('\u2705 '+name+' activated');
    if(st){st.textContent='\u2705 Done!';setTimeout(function(){if(st)st.textContent='\u25b6 Activate';},2000);}
  }catch(e){
    toast('Error: '+e.message);
    if(st){st.textContent='\u274c Error';setTimeout(function(){if(st)st.textContent='\u25b6 Activate';},2500);}
  }
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
      cards+='<span class="sum-icon">'+escapeHTML(page.icon||'\ud83d\udcc4')+'</span><span class="sum-info"><div class="sum-name">'+escapeHTML(page.name)+'</div>';
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
      return '<div class="ev-row"><span class="ev-time">'+t+'</span><span class="ev-action">'+escapeHTML(log.action||'\u2014')+'</span><span class="ev-reason">'+escapeHTML(log.reason||'')+'</span></div>';
    }).join('');
  }catch{ body.innerHTML='<div style="color:var(--muted);font-size:12px">No recent events.</div>'; }
}

// Pinned sensors widget
async function loadPinnedSensors(){
  const el=$('wPinnedBody'); if(!el) return;
  try{
    const d=await api('/io/pinned'); const ios=d.io||[];
    if(!ios.length){
      el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:4px 0">No pinned sensors.<br><a href="/entities.html" style="color:var(--blue)">Pin some \u2192</a></div>';
      return;
    }
    const TYPE_ICON={relay:'\ud83d\udca1',DI:'\ud83d\udd0c',AO:'\ud83c\udf9a\ufe0f',AI:'\ud83d\udcca'};
    let html='';
    ios.forEach(function(io){
      var icon=TYPE_ICON[io.type]||'\ud83d\udcca';
      var n=(io.name||io.key||'').toLowerCase();
      if(n.includes('temp')||n.includes('therm')) icon='\ud83c\udf21\ufe0f';
      else if(n.includes('humid')) icon='\ud83d\udca7';
      else if(n.includes('solar')||n.includes('sun')) icon='\u2600\ufe0f';
      else if(n.includes('power')||n.includes('watt')) icon='\u26a1';
      var val=io.value!==undefined&&io.value!==null?io.value:'\u2014';
      var unit=io.unit?' '+io.unit:'';
      if(io.type==='relay'){val=(val==='1'||val==='ON'||val==='true'||val===1)?'ON':'OFF';unit='';}
      html+='<div class="sum-card" style="border-left:3px solid rgba(34,217,122,.3)">';
      html+='<span class="sum-icon">'+icon+'</span>';
      html+='<span class="sum-info"><div class="sum-name">'+escapeHTML(io.name||io.key||'IO #'+io.id)+'</div>';
      html+='<div class="sum-status" id="pv-'+io.id+'" style="font-family:monospace">'+escapeHTML(val)+escapeHTML(unit)+'</div></span></div>';
    });
    el.innerHTML=html;
  }catch(e){
    el.innerHTML='<div style="color:var(--muted);font-size:12px">Error</div>';
  }
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
      '<div><div style="font-weight:800;font-size:13px">'+escapeHTML(p.name)+'</div><div style="font-size:11px;color:var(--muted)">'+escapeHTML(String(cnt))+' modules</div></div></div>'+
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
        '<div style="font-weight:800;font-size:13px">'+escapeHTML(inst.name||'Instance #'+inst.id)+'</div>'+
        '<div style="font-size:11px;color:var(--muted)">'+escapeHTML(inst.module_id)+'</div></span></label>';
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
  $('addSiteBtn')?.addEventListener('click',()=>{
    $('sitesMenu')?.classList.remove('show');
    window.location.href='/admin.html#sites';
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
    await Promise.all([loadWeatherWidget(),loadScenesWidget(),loadSummaryCards(),loadEventsWidget(),loadNavPages(),loadPinnedSensors()]);
    const _qs=new URLSearchParams(location.search);
    if(_qs.get('newPage')==='1'){ history.replaceState(null,'','/'); openPageEditor(); }
    else if(_qs.get('editPages')==='1'){ history.replaceState(null,'','/'); openPageManager(); }
    setInterval(loadWeatherWidget,15*60*1000);
    setInterval(loadEventsWidget,60*1000);
    setInterval(loadScenesWidget,30*1000);
    setInterval(loadSummaryCards,60*1000);
    setInterval(loadPinnedSensors,15*1000);
  }catch(e){
    console.error('[ELARIS] Boot error:',e);
    const t=$('toast'); if(t) t.textContent='Init error: '+e.message;
  }
})();
