// page.js v32 - generic module page renderer
// Shared utilities ($, escapeHTML, api, toast) are in /js/core.js
var pstate = { siteId:null, deviceId:null, deviceState:new Map(), ws:null, _instances:[], uiRole:'USER' };
function applyTheme(t){ document.documentElement.dataset.theme=t; var b=$('themeBtn'); if(b)b.textContent=t==='dark'?'\u2600\ufe0f':'\ud83c\udf19'; }
function toggleTheme(){ var c=document.documentElement.dataset.theme||'dark'; var n=c==='dark'?'light':'dark'; document.documentElement.dataset.theme=n; localStorage.setItem('elaris_theme',n); applyTheme(n); }

function canEngineerUI(){ return pstate.uiRole==='ENGINEER' || pstate.uiRole==='ADMIN'; }

async function loadMe(){ var me=window.ELARIS_ME || await api('/me'); if(!me.ok||!me.user){window.location.href='/login.html'; return;} pstate.uiRole=(window.elarisComputeUiRole?window.elarisComputeUiRole(me):(window.ELARIS_UI_ROLE||me.role||'USER')); }

async function loadSites(){
  var o=await api('/sites'); var sites=o.sites||[];
  var saved=null; try{saved=Number(localStorage.getItem('elaris_site_id')||'');}catch(e){}
  var site=(saved&&sites.find(function(s){return s.id===saved;}))||sites[0];
  if(!site)return;
  pstate.siteId=site.id;
  var p=$('sitePill'); if(p)p.textContent='Site: '+site.name;
  var o2=await api('/sites/'+site.id+'/devices');
  var raw=o2.devices||[];
  var devs=raw.map(function(d){return typeof d==='string'?d:d.id;}).filter(Boolean);
  pstate.deviceId=devs[0]||null;
  sendWsScope();
}

function updateWsBadge(s){ var el=$('wsPill'); if(!el)return; el.className='pill ws-badge'; if(s==='online'){el.className+=' online';el.textContent='Online';}else if(s==='offline'){el.className+=' offline';el.textContent='Offline';}else{el.className+=' connecting';el.textContent='Connecting...';} }
function sendWsScope(){ try{ var ws=pstate.ws; if(!ws||ws.readyState!==WebSocket.OPEN)return; ws.send(JSON.stringify({ type:'register_client', siteId:pstate.siteId||null, deviceId:pstate.deviceId||null })); }catch(e){} }
function connectWS(){ updateWsBadge('connecting'); try{ var proto=location.protocol==='https:'?'wss':'ws'; var ws=new WebSocket(proto+'://'+location.host+'/ws'); pstate.ws=ws; ws.onopen=function(){updateWsBadge('online');sendWsScope();}; ws.onclose=function(){updateWsBadge('offline');setTimeout(connectWS,5000);}; ws.onmessage=function(ev){var msg;try{msg=JSON.parse(ev.data);}catch(e){return;} if(msg.type==='mqtt'&&msg.deviceId===pstate.deviceId&&msg.key)pstate.deviceState.set(msg.key,msg.payload); }; }catch(e){} }

async function loadNav(){ try{
  var d=await fetch('/api/nav/pages').then(function(r){return r.json();}).catch(function(){return{pages:[]};});
  var custom=(d.pages||[]).filter(function(p){return!p.system;}); var c=$('navContainer'); if(!c)return;
  if(!custom.length){c.innerHTML='';return;}
  c.innerHTML='<div class="groupTitle">My Pages</div><nav class="nav">'+custom.map(function(p){return'<a href="/page.html?id='+Number(p.id)+'">'+escapeHTML(p.icon||'\ud83d\udcc4')+' '+escapeHTML(p.name)+'</a>';}).join('')+'</nav>';
  document.querySelectorAll('#navContainer a').forEach(function(a){if(a.href===location.href)a.classList.add('active');});
}catch(e){} }

function sparklineSVG(data,color){
  if(!data||data.length<2)return '';
  var vals=data.map(function(p){return p[1];}).filter(function(v){return v!=null;});
  if(!vals.length)return '';
  var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals),range=Math.max(mx-mn,1);
  var W=200,H=36;
  var pts=data.map(function(p,i){return((i/(data.length-1))*W).toFixed(1)+','+(H-((p[1]-mn)/range)*(H-4)-2).toFixed(1);}).join(' ');
  return '<svg width="'+W+'" height="'+H+'" style="overflow:visible"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

async function renderSolar(inst){
  var sRes={},hRes={};
  try{sRes=await api('/automation/solar/'+inst.id+'/status');}catch(e){}
  try{hRes=await api('/automation/solar/'+inst.id+'/history?hours=6');}catch(e){}
  var sp=sRes.setpoints||{};
  var tempS=sRes.tempSolar!=null?Number(sRes.tempSolar).toFixed(1):null;
  var tempB=sRes.tempBoiler!=null?Number(sRes.tempBoiler).toFixed(1):null;
  var diff=sRes.diff!=null?sRes.diff:null;
  var pumpOn=sRes.pumpOn; var pumpSpd=sRes.pumpSpeed; var isPaused=sRes.paused;
  var profile=sp.profile||'basic';
  var forceOn=sp.force_pump_on==='1'||sp.force_pump_on===1;
  var manualOn=sp.manual_override==='1'||sp.manual_override===1;
  var testMode=sp.test_mode==='1'||sp.test_mode===1;
  var manualSpd=parseFloat(sp.manual_speed||50);
  var hasInverter=(inst.mappings||[]).some(function(m){return m.input_key==='pump_speed'&&m.io_id;});
  var history=(hRes&&hRes.history)||{};
  var h='';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">';
  h+='<div style="background:rgba(255,154,58,.1);border:1px solid rgba(255,154,58,.2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;font-weight:800;color:#ff9a3a;text-transform:uppercase">Solar</div><div style="font-size:28px;font-weight:900;margin-top:4px">'+(tempS!==null?tempS+'\u00b0':'\u2014')+'</div></div>';
  h+='<div style="background:rgba(29,140,255,.1);border:1px solid rgba(29,140,255,.2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;font-weight:800;color:#1d8cff;text-transform:uppercase">Boiler</div><div style="font-size:28px;font-weight:900;margin-top:4px">'+(tempB!==null?tempB+'\u00b0':'\u2014')+'</div></div>';
  h+='<div style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.2);border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;font-weight:800;color:var(--good);text-transform:uppercase">\u0394T</div><div style="font-size:28px;font-weight:900;margin-top:4px">'+(diff!==null?(diff>=0?'+':'')+diff+'\u00b0':'\u2014')+'</div></div>';
  h+='</div>';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)"><span style="font-weight:700">\ud83d\udca7 Pump</span>';
  h+='<span style="font-weight:800;font-size:14px;color:'+(pumpOn?'var(--good)':'var(--bad)')+'">'+( pumpOn?'\u25cf ON':'\u25cb OFF')+(pumpSpd!=null?' \u00b7 '+Math.round(pumpSpd)+'%':'')+'</span></div>';
  if(history.temp_solar)h+='<div style="margin:8px 0 4px;opacity:.7">'+sparklineSVG(history.temp_solar,'#ff9a3a')+'</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><span class="pill" style="font-size:10px">profile: '+profile+'</span>'+(testMode?'<span class="pill" style="font-size:10px;border-color:rgba(255,201,71,.35);color:#ffd978">TEST MODE</span>':'')+'</div>';
  if(hasInverter){
    h+='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:12px;font-weight:700">Manual Override</span>';
    h+='<button onclick="toggleSolarManual('+inst.id+','+manualOn+')" style="padding:4px 14px;border-radius:999px;border:1px solid '+(manualOn?'rgba(245,158,11,.5)':'var(--line2)')+';background:'+(manualOn?'rgba(245,158,11,.15)':'rgba(255,255,255,.05)')+';color:'+(manualOn?'#f59e0b':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">'+(manualOn?'\u25cf MANUAL':'\u25cb AUTO')+'</button></div>';
    if(manualOn){h+='<input type="range" min="25" max="100" value="'+Math.round(manualSpd)+'" style="width:100%;accent-color:var(--orange)" oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="setSolarManualSpeed('+inst.id+',this.value)"><div style="text-align:right;font-size:11px;color:var(--muted2)">'+Math.round(manualSpd)+'%</div>';}
    h+='</div>';
  }
  h+='<button onclick="toggleSolarForce('+inst.id+','+forceOn+')" style="width:100%;margin-top:12px;padding:9px;border-radius:9px;border:1px solid '+(forceOn?'rgba(239,68,68,.5)':'var(--line2)')+';background:'+(forceOn?'rgba(239,68,68,.15)':'rgba(255,255,255,.03)')+';color:'+(forceOn?'#ef4444':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+( forceOn?'\u2715 Force ON — Click to cancel':'\ud83d\udd34 Force Pump ON')+'</button>';
  h+='<button onclick="toggleSolarPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:6px;padding:9px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'\u25b6 Resume':'\u23f8 Pause Automation')+'</button>';
  return h;
}

async function toggleSolarPause(id,cur){ await api('/automation/solar/'+id+'/override',{method:'POST',body:JSON.stringify({paused:!cur})}); rerenderInstance(id); }
async function toggleSolarManual(id,cur){ await api('/automation/solar/'+id+'/setpoints',{method:'PATCH',body:JSON.stringify({key:'manual_override',value:cur?'0':'1'})}); rerenderInstance(id); }
async function toggleSolarForce(id,cur){ try{await api('/automation/solar/'+id+'/setpoints',{method:'PATCH',body:JSON.stringify({key:'force_pump_on',value:cur?'0':'1'})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }
async function setSolarManualSpeed(id,val){ await api('/automation/solar/'+id+'/setpoints',{method:'PATCH',body:JSON.stringify({key:'manual_speed',value:String(val)})}); }
async function renderThermostat(inst){
  var sR={};try{sR=await api('/automation/status/'+inst.id);}catch(e){}
  var vals=sR.values||{},sp=sR.settings||{};
  var mode=String(sp.mode||'heating').toLowerCase();
  var modeKey=(mode==='off')?'off':(mode==='cooling'?'cooling':'heating');
  var mc=modeKey==='cooling'?'#1d8cff':(modeKey==='heating'?'#f97316':'var(--muted2)');
  var setpoint=parseFloat(sp.setpoint||(modeKey==='cooling'?24:21));
  var hyst=parseFloat(sp.hysteresis||0.5),paused=!!sR.paused;
  var mappings=inst.mappings||[];
  var hasZoned=mappings.some(function(m){ return m && m.input_key && (String(m.input_key).indexOf('zone_')===0 || String(m.input_key)==='central_pump'); }) || Object.keys(vals).some(function(k){ return String(k).indexOf('zone_')===0 || String(k)==='central_pump'; }) || Object.keys(sp).some(function(k){ return String(k).indexOf('_zone_')===0; });

  function modeBtn(label,key,icon){
    var active=modeKey===key;
    var accent=key==='cooling'?'#1d8cff':(key==='heating'?'#f97316':'#a1a1aa');
    var bg = active ? (key==='cooling'?'rgba(29,140,255,.12)':(key==='heating'?'rgba(249,115,22,.12)':'rgba(255,255,255,.08)')) : 'rgba(255,255,255,.04)';
    return '<button onclick="setThermoMode('+inst.id+',\''+key+'\')" style="flex:1;min-width:0;padding:9px 10px;border-radius:999px;border:1px solid '+(active?accent:'var(--line2)')+';background:'+bg+';color:'+(active?accent:'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">'+icon+' '+label+'</button>';
  }
  function pill(label,val,color){ return '<span class="pill" style="font-size:10px;border-color:'+(color||'var(--line2)')+';color:'+(color||'var(--muted2)')+'">'+label+': '+val+'</span>'; }

  if(!hasZoned){
    var tRoom=vals.temp_room!=null?parseFloat(vals.temp_room).toFixed(1):null;
    var tOut=vals.temp_outdoor!=null?parseFloat(vals.temp_outdoor).toFixed(1):null;
    var acOn=vals.ac_relay==='ON';
    var h='';
    h+='<div style="display:flex;gap:8px;flex-wrap:nowrap;margin-bottom:10px">'+modeBtn('Heat','heating','🔥')+modeBtn('Cool','cooling','❄')+modeBtn('Off','off','⏻')+'</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
    h+='<div style="background:rgba(29,140,255,.08);border:1px solid rgba(29,140,255,.18);border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;font-weight:800;color:var(--muted2);text-transform:uppercase">Room</div><div style="font-size:28px;font-weight:900;margin-top:4px">'+(tRoom!==null?tRoom+'°':'—')+'</div></div>';
    h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;font-weight:800;color:var(--muted2);text-transform:uppercase">Target</div><div style="font-size:28px;font-weight:900;margin-top:4px;color:'+mc+'">'+setpoint+'°</div></div>';
    h+='</div>';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)"><span style="font-size:12px;color:var(--muted2)">Setpoint</span><div style="display:flex;align-items:center;gap:8px">';
    h+='<button onclick="adjThermoSP('+inst.id+','+setpoint+',-0.5)" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:18px">-</button>';
    h+='<span style="font-size:22px;font-weight:900;min-width:56px;text-align:center;color:'+mc+'">'+setpoint+'°</span>';
    h+='<button onclick="adjThermoSP('+inst.id+','+setpoint+',0.5)" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:18px">+</button>';
    h+='</div></div>';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)"><span style="font-weight:700">Status</span><span style="font-weight:800;font-size:14px;color:'+(acOn?mc:'var(--muted)')+'">'+(acOn?'● ON':'○ OFF')+'</span></div>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'+pill('mode',modeKey)+(tOut!==null?pill('outdoor',tOut+'°'):'')+(String(sp.test_mode||'0')==='1'?pill('TEST MODE','#ffd978','rgba(255,201,71,.35)'):'')+pill('hyst','±'+hyst+'°')+'</div>';
    if(canEngineerUI()) h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:12px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
    return h;
  }

  function zoneHas(idx){
    var keys=['zone_'+idx+'_temp','zone_'+idx+'_call','zone_'+idx+'_output','zone_'+idx+'_pump'];
    if(idx===1) keys.push('temp_room','ac_relay');
    return keys.some(function(k){ return mappings.some(function(m){ return m.input_key===k && m.io_id; }) || vals[k]!=null; }) || sp['_zone_'+idx+'_state']!=null;
  }
  function stateOn(v){ return v==='ON' || v===1 || v==='1' || v===true || v==='true'; }
  var zones=[]; var callingCount=0;
  for(var i=1;i<=6;i++){
    if(!zoneHas(i)) continue;
    var tempKey='zone_'+i+'_temp', callKey='zone_'+i+'_call', outKey='zone_'+i+'_output', pumpKey='zone_'+i+'_pump';
    if(i===1){ if(vals[tempKey]==null && vals.temp_room!=null) tempKey='temp_room'; if(vals[outKey]==null && vals.ac_relay!=null) outKey='ac_relay'; }
    var tempVal=vals[tempKey];
    var callVal=vals[callKey];
    var outVal=vals[outKey];
    var pumpVal=vals[pumpKey];
    var demand = stateOn(sp['_zone_'+i+'_demand']) || stateOn(outVal) || stateOn(pumpVal) || stateOn(sp['_zone_'+i+'_state']) || stateOn(callVal);
    if(demand) callingCount++;
    zones.push({
      idx:i,
      temp: tempVal!=null && !isNaN(parseFloat(tempVal)) ? parseFloat(tempVal).toFixed(1) : null,
      call: callVal,
      source: sp['_zone_'+i+'_source'] || (callVal!=null ? 'call' : (tempVal!=null ? 'temp' : 'none')),
      reason: sp['_zone_'+i+'_reason'] || '',
      outputOn: stateOn(outVal) || stateOn(sp['_zone_'+i+'_output_state']),
      pumpOn: stateOn(pumpVal) || stateOn(sp['_zone_'+i+'_pump_state']),
      demand: demand
    });
  }
  var configuredZones = parseInt(sp._central_configured_zones || zones.length || 0, 10) || zones.length;
  var centralOn=stateOn(vals.central_pump) || stateOn(sp._central_state);
  var centralReason = sp._central_reason || '';
  var h='';
  h+='<div style="display:flex;gap:6px;flex-wrap:nowrap;margin-bottom:8px">'+modeBtn('Heat','heating','🔥')+modeBtn('Cool','cooling','❄')+modeBtn('Off','off','⏻')+'</div>';
  // Global override row — sets ALL zones + global setpoint at once
  h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)">';
  h+='<div><div style="font-size:10px;font-weight:800;color:var(--muted2);text-transform:uppercase;letter-spacing:.5px">All Zones</div><div style="font-size:9px;color:var(--muted);margin-top:1px">Override all at once</div></div>';
  h+='<div style="display:flex;align-items:center;gap:6px">';
  h+='<button onclick="setAllZonesSP('+inst.id+','+setpoint+',-0.5)" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">−</button>';
  h+='<span style="font-size:18px;font-weight:900;min-width:44px;text-align:center;color:var(--muted2)">'+setpoint+'°</span>';
  h+='<button onclick="setAllZonesSP('+inst.id+','+setpoint+',0.5)" style="width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center">+</button>';
  h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-left:4px">';
  h+='<span class="pill" style="font-size:10px">'+configuredZones+' zones</span>';
  h+='<span class="pill" style="font-size:10px;border-color:rgba(34,217,122,.22);color:#22d97a">'+callingCount+' calling</span>';
  h+='<span class="pill" title="'+String(centralReason||'').replace(/"/g,'&quot;')+'" style="font-size:10px;border-color:'+(centralOn?'rgba(34,217,122,.22)':'var(--line2)')+';color:'+(centralOn?'#22d97a':'var(--muted2)')+'">Pump '+(centralOn?'ON':'OFF')+'</span>';
  h+='</div></div></div>';
  h+='<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:2px;margin-bottom:8px">'+pill('mode',modeKey)+(paused?pill('automation','paused','#f59e0b'):'')+(String(sp.test_mode||'0')==='1'?pill('TEST MODE','#ffd978','rgba(255,201,71,.35)'):'')+pill('hyst','±'+hyst+'°')+'</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
  zones.forEach(function(z){
    var invalidCall = z.source==='invalid_call' || z.source==='call_unreadable';
    var srcLabel = invalidCall ? 'CALL !' : (z.source==='call' ? 'DI' : (z.source==='temp' ? (z.temp!==null ? z.temp+'°' : 'TEMP') : 'NO INPUT'));
    var hasZonePump = z.pumpOn || mappings.some(function(m){return m.input_key==='zone_'+z.idx+'_pump'&&m.io_id;}) || vals['zone_'+z.idx+'_pump']!=null;
    var title = 'Zone '+z.idx+' • '+(z.demand?'Demand ON':'Demand OFF');
    if(z.reason) title += ' • ' + String(z.reason).replace(/"/g,'&quot;');
    var border = invalidCall ? 'rgba(239,68,68,.28)' : (z.demand?'rgba(34,217,122,.24)':'var(--line)');
    var bg = invalidCall ? 'rgba(239,68,68,.07)' : (z.demand?'rgba(34,217,122,.06)':'rgba(255,255,255,.03)');
    var stateColor = invalidCall ? '#ef4444' : (z.demand?'#22d97a':'var(--muted2)');
    var srcColor = invalidCall ? '#ef4444' : (z.temp!==null?mc:'var(--muted2)');
    // Per-zone setpoint: use zone override if set, else global
    var rawZSP = sp['zone_'+z.idx+'_setpoint'];
    var zsp = (rawZSP !== undefined && rawZSP !== '' && !isNaN(parseFloat(rawZSP))) ? parseFloat(rawZSP) : setpoint;
    var zspIsOverride = (rawZSP !== undefined && rawZSP !== '' && !isNaN(parseFloat(rawZSP)));
    h+='<div title="'+title.replace(/"/g,'&quot;')+'" style="border:1px solid '+border+';background:'+bg+';border-radius:9px;padding:7px 8px">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:4px">';
    h+='<strong style="font-size:11px">Z'+z.idx+'</strong>';
    h+='<span style="font-size:10px;font-weight:800;color:'+stateColor+'">'+(invalidCall?'ERR':(z.demand?'ON':'OFF'))+'</span>';
    h+='</div>';
    h+='<div style="font-size:10px;color:'+srcColor+';font-weight:'+(invalidCall||z.temp!==null?'800':'700')+';margin-top:3px;line-height:1.1">'+srcLabel+'</div>';
    h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">';
    h+='<span class="pill" style="font-size:9px;padding:2px 6px">OUT '+(z.outputOn?'ON':'OFF')+'</span>';
    if(hasZonePump) h+='<span class="pill" style="font-size:9px;padding:2px 6px">P '+(z.pumpOn?'ON':'OFF')+'</span>';
    if(z.source==='call') h+='<span class="pill" style="font-size:9px;padding:2px 6px">CALL</span>';
    else if(z.source==='temp') h+='<span class="pill" style="font-size:9px;padding:2px 6px">TEMP</span>';
    else if(invalidCall) h+='<span class="pill" style="font-size:9px;padding:2px 6px;border-color:rgba(239,68,68,.28);color:#ef4444">INVALID</span>';
    h+='</div>';
    // Per-zone setpoint row
    h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;padding-top:5px;border-top:1px solid var(--line)">';
    h+='<span style="font-size:9px;font-weight:800;color:'+(zspIsOverride?mc:'var(--muted)')+';text-transform:uppercase">'+(zspIsOverride?'SP':'SP*')+'</span>';
    h+='<div style="display:flex;align-items:center;gap:3px">';
    h+='<button onclick="adjZoneSP('+inst.id+','+z.idx+','+zsp+',-0.5)" style="width:20px;height:20px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">−</button>';
    h+='<span style="font-size:12px;font-weight:900;min-width:36px;text-align:center;color:'+mc+'">'+zsp+'°</span>';
    h+='<button onclick="adjZoneSP('+inst.id+','+z.idx+','+zsp+',0.5)" style="width:20px;height:20px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">+</button>';
    h+='</div></div>';
    h+='</div>';
  });
  h+='</div>';
  if(canEngineerUI()) h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:12px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  return h;
}
async function adjThermoSP(id,cur,delta){ var v=Math.round((parseFloat(cur)+parseFloat(delta))*10)/10; try{await api('/automation/thermostat/'+id+'/control',{method:'POST',body:JSON.stringify({setpoint:v})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }
async function adjZoneSP(id,zone,cur,delta){ var v=Math.round((parseFloat(cur)+parseFloat(delta))*10)/10; var body={}; body['zone_'+zone+'_setpoint']=v; try{await api('/automation/thermostat/'+id+'/control',{method:'POST',body:JSON.stringify(body)});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }
async function setAllZonesSP(id,cur,delta){ var v=Math.round((parseFloat(cur)+parseFloat(delta))*10)/10; try{await api('/automation/thermostat/'+id+'/control',{method:'POST',body:JSON.stringify({all_zones_setpoint:v})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }
async function setThermoMode(id,mode){ try{await api('/automation/thermostat/'+id+'/control',{method:'POST',body:JSON.stringify({mode:mode})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }
async function toggleThermoPause(id,cur){ try{await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }


async function irrigationCommand(id, command, args){
  try{
    await api('/automation/instances/'+id+'/command',{method:'POST',body:JSON.stringify(Object.assign({command:command}, args||{}))});
  }catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}
async function renderIrrigation(inst){
  var sR={}; try{sR=await api('/automation/status/'+inst.id);}catch(e){}
  var settings=sR.settings||{}, live=sR.state||sR.live||sR||{}, vals=sR.values||{};
  var status=String(live.status||live.phase||'idle').toLowerCase();
  var paused=!!sR.paused;
  var currentZone=live.current_zone||null;
  var remSec=Math.max(0, Number(live.remaining_sec||0));
  var remTxt=remSec? (Math.floor(remSec/60)+'m '+String(remSec%60).padStart(2,'0')+'s') : '—';
  var zoneNames=[1,2,3].map(function(i){ return settings['zone_'+i+'_name'] || ('Zone '+i); });
  var configured=[1,2,3].filter(function(i){ return !!vals['zone_'+i] || (inst.mappings||[]).some(function(m){return m.input_key==='zone_'+i && m.io_id;}); });
  var running=status==='running' || status==='soak';
  var lockout=live.lockout_reason||'';
  function on(v){ return v==='ON' || v===1 || v==='1' || v===true || v==='true'; }
  var h='';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">';
  h+='<div><div style="font-size:26px;font-weight:900;color:'+(running?'#22d97a':(status==='blocked'?'#f59e0b':'var(--muted2)'))+'">'+String(status).toUpperCase()+'</div><div style="font-size:12px;color:var(--muted2)">'+(lockout?lockout:(running?(currentZone?zoneNames[currentZone-1]:'Cycle active'):'Ready'))+'</div></div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<div style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.2);border-radius:10px;padding:10px 12px;text-align:center;min-width:72px"><div style="font-size:10px;font-weight:800;color:var(--good);text-transform:uppercase">Zone</div><div style="font-size:22px;font-weight:900;margin-top:4px">'+(currentZone?('Z'+currentZone):'—')+'</div></div>';
  h+='<div style="background:rgba(29,140,255,.08);border:1px solid rgba(29,140,255,.2);border-radius:10px;padding:10px 12px;text-align:center;min-width:84px"><div style="font-size:10px;font-weight:800;color:#1d8cff;text-transform:uppercase">Time Left</div><div style="font-size:18px;font-weight:900;margin-top:6px">'+remTxt+'</div></div>';
  h+='</div></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">';
  if(String(settings.test_mode||'0')==='1') h+='<span class="pill" style="font-size:10px;border-color:rgba(255,201,71,.35);color:#ffd978">TEST MODE</span>';
  h+='<span class="pill" style="font-size:10px">Zones '+configured.length+'</span>';
  h+='<span class="pill" style="font-size:10px;border-color:'+(on(vals.master_valve)?'rgba(34,217,122,.22)':'var(--line2)')+';color:'+(on(vals.master_valve)?'#22d97a':'var(--muted2)')+'">Master '+(on(vals.master_valve)?'ON':'OFF')+'</span>';
  if(vals.flow_sensor!=null) h+='<span class="pill" style="font-size:10px">Flow '+vals.flow_sensor+'</span>';
  if(vals.soil_moisture!=null) h+='<span class="pill" style="font-size:10px">Soil '+vals.soil_moisture+'%</span>';
  if(vals.rain_sensor!=null) h+='<span class="pill" style="font-size:10px">'+(on(vals.rain_sensor)?'RAIN':'DRY')+'</span>';
  if(vals.temp_outdoor!=null) h+='<span class="pill" style="font-size:10px">'+vals.temp_outdoor+'°</span>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px">';
  configured.forEach(function(i){
    var active=on(vals['zone_'+i]);
    var isCurrent=currentZone===i;
    h+='<div style="border:1px solid '+(active?'rgba(34,217,122,.26)':'var(--line)')+';background:'+(active?'rgba(34,217,122,.06)':'rgba(255,255,255,.03)')+';border-radius:9px;padding:7px 8px">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">Z'+i+'</strong><span style="font-size:10px;font-weight:800;color:'+(active?'#22d97a':'var(--muted2)')+'">'+(active?'ON':'OFF')+'</span></div>';
    h+='<div style="font-size:10px;color:'+(isCurrent?'#22d97a':'var(--muted2)')+';font-weight:'+(isCurrent?'800':'700')+';margin-top:3px;line-height:1.1">'+zoneNames[i-1]+'</div>';
    h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">';
    if(isCurrent) h+='<span class="pill" style="font-size:9px;padding:2px 6px;border-color:rgba(34,217,122,.22);color:#22d97a">RUNNING</span>';
    h+='<span class="pill" style="font-size:9px;padding:2px 6px">MIN '+(settings['zone_'+i+'_min']||0)+'</span>';
    h+='</div></div>';
  });
  h+='</div>';
  if(canEngineerUI()){
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">';
    h+='<button onclick="irrigationCommand('+inst.id+',\'start_cycle\')" class="btn btn-sm" style="flex:1 1 140px">▶ Start Cycle</button>';
    h+='<button onclick="irrigationCommand('+inst.id+',\'stop_cycle\')" class="btn btn-sm btn-danger" style="flex:1 1 120px">■ Stop</button>';
    h+='<button onclick="irrigationCommand('+inst.id+',\'skip_zone\')" class="btn btn-sm" style="flex:1 1 120px">↷ Skip Zone</button>';
    h+='</div>';
    if(configured.length){
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
      configured.forEach(function(i){ h+='<button onclick="irrigationCommand('+inst.id+',\'run_zone\',{zone:'+i+'})" class="btn btn-sm ghost" style="flex:1 1 90px">Run Z'+i+'</button>'; });
      h+='</div>';
    }
    h+='<button onclick="toggleIrrigationPause('+inst.id+','+paused+')" style="width:100%;margin-top:10px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  }
  return h;
}
async function toggleIrrigationPause(id,cur){ try{await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }


async function waterManagerCommand(id, command){
  try{
    await api('/automation/instances/'+id+'/command',{method:'POST',body:JSON.stringify({command})});
  }catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}
async function renderWaterManager(inst){
  var sR={}; try{sR=await api('/automation/status/'+inst.id);}catch(e){}
  var live=sR.state||sR.live||sR||{}, vals=sR.values||{}, paused=!!sR.paused;
  var status=String(live.status || (live.alarm ? 'alarm' : 'idle')).toLowerCase();
  var alarm=status==='alarm' || !!live.alarm;
  function on(v){ return v==='ON' || v===1 || v==='1' || v===true || v==='true'; }
  var leakStates=[1,2,3,4].map(function(i){ return { idx:i, mapped:(inst.mappings||[]).some(function(m){return m.input_key==='leak_sensor_'+i && m.io_id;}), wet:on(vals['leak_sensor_'+i]) }; }).filter(function(z){ return z.mapped; });
  var h='';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">';
  h+='<div><div style="font-size:26px;font-weight:900;color:'+(alarm?'#ff6b6b':(paused?'#f59e0b':'#22d97a'))+'">'+(alarm?'ALARM':(paused?'PAUSED':'IDLE'))+'</div><div style="font-size:12px;color:var(--muted2)">'+(live.lockout_reason|| (alarm?'Leak protection active':'Water protection ready'))+'</div></div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<div style="background:rgba(29,140,255,.08);border:1px solid rgba(29,140,255,.2);border-radius:10px;padding:10px 12px;text-align:center;min-width:72px"><div style="font-size:10px;font-weight:800;color:#1d8cff;text-transform:uppercase">Valve</div><div style="font-size:18px;font-weight:900;margin-top:6px;color:'+(live.shutoff_closed?'#ff6b6b':'#22d97a')+'">'+(live.shutoff_closed?'CLOSED':'OPEN')+'</div></div>';
  h+='<div style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.2);border-radius:10px;padding:10px 12px;text-align:center;min-width:72px"><div style="font-size:10px;font-weight:800;color:var(--good);text-transform:uppercase">Leaks</div><div style="font-size:18px;font-weight:900;margin-top:6px">'+leakStates.filter(function(z){return z.wet;}).length+'/'+leakStates.length+'</div></div>';
  h+='</div></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">';
  h+='<span class="pill" style="font-size:10px;border-color:'+(alarm?'rgba(255,107,107,.35)':'var(--line2)')+';color:'+(alarm?'#ff6b6b':'var(--muted2)')+'">'+(alarm?'ALARM ACTIVE':'PROTECTED')+'</span>';
  h+='<span class="pill" style="font-size:10px">Main '+(live.shutoff_closed?'Closed':'Open')+'</span>';
  if(vals.flow_sensor!=null) h+='<span class="pill" style="font-size:10px">Flow '+vals.flow_sensor+'</span>';
  if(vals.pressure_sensor!=null) h+='<span class="pill" style="font-size:10px">Pressure '+vals.pressure_sensor+'</span>';
  if(live.last_trip_ts) h+='<span class="pill" style="font-size:10px">Trip '+new Date(live.last_trip_ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+'</span>';
  h+='</div>';
  if(leakStates.length){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:10px">';
    leakStates.forEach(function(z){
      h+='<div title="'+(z.wet?'Leak sensor wet':'Leak sensor dry')+'" style="border:1px solid '+(z.wet?'rgba(255,107,107,.28)':'var(--line)')+';background:'+(z.wet?'rgba(255,107,107,.08)':'rgba(255,255,255,.03)')+';border-radius:9px;padding:7px 8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">Leak '+z.idx+'</strong><span style="font-size:10px;font-weight:800;color:'+(z.wet?'#ff6b6b':'var(--muted2)')+'">'+(z.wet?'WET':'DRY')+'</span></div>';
      h+='</div>';
    });
    h+='</div>';
  }
  if(canEngineerUI()){
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">';
    h+='<button onclick="waterManagerCommand('+inst.id+',\'reset_alarm\')" class="btn btn-sm" style="flex:1 1 160px">🧯 Reset Alarm</button>';
    h+='</div>';
    h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:10px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  }
  return h;
}


async function renderLoadShifter(inst){
  var d={};
  try{ d=await api('/automation/status/'+inst.id); }catch(e){}
  var sp=d.settings||{}, state=d.state||{}, paused=d.paused||false;
  var power=state.power!=null?Math.round(Number(state.power)):null;
  var threshold=Number(state.threshold!=null?state.threshold:sp.power_threshold||8000);
  var restore=Number(state.restore_below!=null?state.restore_below:sp.restore_below||6000);
  var status=String(state.status||'monitoring').toUpperCase();
  var reason=String(state.last_reason || (d.lastLog&&d.lastLog[0]&&d.lastLog[0].reason) || 'Monitoring power').slice(0,80);
  var shedCount=Number(state.shed_count||0);
  var waitMs=Number(state.wait_restore_ms||0);
  var waitTxt=waitMs>0?Math.ceil(waitMs/1000)+'s':'—';
  var loads=Array.isArray(state.load_states)?state.load_states:[];
  var h='<div style="display:flex;flex-direction:column;gap:10px">';
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
  h+='<div>';
  h+='<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Load Shifter</div>';
  h+='<div title="'+escHtml(reason)+'" style="margin-top:3px;font-size:24px;font-weight:900;color:'+(status==='SHED'?'#ff6b6b':status==='NO_DATA'?'#f59e0b':'#22d97a')+'">'+(power!=null?power+'W':'—')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(reason)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<span style="background:rgba(255,255,255,.05);border:1px solid '+(status==='SHED'?'rgba(255,107,107,.35)':status==='NO_DATA'?'rgba(245,158,11,.35)':'rgba(34,217,122,.35)')+';border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;color:'+(status==='SHED'?'#ff6b6b':status==='NO_DATA'?'#f59e0b':'#22d97a')+'">'+escHtml(status)+'</span>';
  if(shedCount>0) h+='<span style="background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#ff6b6b">SHED '+shedCount+'</span>';
  h+='</div>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">Threshold</div><div style="font-size:16px;font-weight:900;margin-top:2px">'+threshold+'W</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">Restore</div><div style="font-size:16px;font-weight:900;margin-top:2px">'+restore+'W</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">Wait</div><div style="font-size:16px;font-weight:900;margin-top:2px">'+waitTxt+'</div></div>';
  h+='</div>';
  if(loads.length){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
    loads.forEach(function(l){ if(!l.mapped) return; var badge=l.shed?'SHED':(l.on?'ON':'OFF'); var color=l.shed?'#ff6b6b':(l.on?'#22d97a':'var(--muted2)'); var border=l.shed?'rgba(255,107,107,.28)':(l.on?'rgba(34,217,122,.28)':'var(--line)');
      h+='<div title="'+escHtml((l.io_name||l.key)+' • '+(l.raw_state||'—'))+'" style="border:1px solid '+border+';background:'+(l.shed?'rgba(255,107,107,.08)':'rgba(255,255,255,.03)')+';border-radius:9px;padding:7px 8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">'+escHtml(String(l.key).replace('load_','L'))+'</strong><span style="font-size:10px;font-weight:800;color:'+color+'">'+badge+'</span></div>';
      h+='<div style="font-size:10px;color:var(--muted2);margin-top:3px">'+escHtml(l.io_name||l.key)+'</div>';
      h+='</div>'; });
    h+='</div>';
  }
  if(canEngineerUI()) h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:4px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  h+='</div>';
  return h;
}


async function setPresenceArmed(id, armed){
  try{ await api('/automation/settings/'+id,{method:'PATCH',body:JSON.stringify({armed: armed ? '1' : '0'})}); }
  catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}
async function renderPresenceSimulator(inst){
  var d={}; try{ d=await api('/automation/status/'+inst.id); }catch(e){}
  var sp=d.settings||{}, state=d.state||{}, vals=d.values||{}, paused=!!d.paused;
  var armed=!!state.armed || String(sp.armed||'0')==='1';
  var status=String(state.status || (armed?'armed':'disarmed')).toUpperCase();
  var reason=String(state.last_reason || (armed?'Presence simulation armed':'Presence simulation idle')).slice(0,80);
  var mappedLights=Number(state.mapped_lights || ['light_1','light_2','light_3','light_4'].filter(function(k){ return (inst.mappings||[]).some(function(m){return m.input_key===k && m.io_id;}); }).length);
  var activeLights=Number(state.active_lights||0);
  var tvOn=!!state.tv_on, awningOn=!!state.awning_on;
  var eveningStart=state.evening_start || sp.evening_start || '18:00';
  var eveningEnd=state.evening_end || sp.evening_end || '23:00';
  var inEvening=!!state.in_evening;
  function on(v){ return v==='ON' || v===1 || v==='1' || v===true || v==='true'; }
  var h='<div style="display:flex;flex-direction:column;gap:10px">';
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
  h+='<div>';
  h+='<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Presence Simulator</div>';
  h+='<div title="'+escHtml(reason)+'" style="margin-top:3px;font-size:24px;font-weight:900;color:'+(armed?'#a855f7':(paused?'#f59e0b':'var(--muted2)'))+'">'+(armed?'ARMED':'DISARMED')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(reason)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<span style="background:rgba(255,255,255,.05);border:1px solid '+(armed?'rgba(168,85,247,.35)':(paused?'rgba(245,158,11,.35)':'var(--line)'))+';border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;color:'+(armed?'#a855f7':(paused?'#f59e0b':'var(--muted2)'))+'">'+escHtml(status)+'</span>';
  if(inEvening) h+='<span style="background:rgba(29,140,255,.08);border:1px solid rgba(29,140,255,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#1d8cff">EVENING</span>';
  h+='</div></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">Lights</div><div style="font-size:16px;font-weight:900;margin-top:2px">'+activeLights+'/'+mappedLights+'</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">TV</div><div style="font-size:16px;font-weight:900;margin-top:2px;color:'+(tvOn?'#22d97a':'var(--muted2)')+'">'+(tvOn?'ON':'OFF')+'</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:10px;padding:8px"><div style="font-size:10px;color:var(--muted2);font-weight:800;text-transform:uppercase">Awning</div><div style="font-size:16px;font-weight:900;margin-top:2px;color:'+(awningOn?'#22d97a':'var(--muted2)')+'">'+(awningOn?'ON':'OFF')+'</div></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:-2px">';
  h+='<span class="pill" style="font-size:10px">'+escHtml(eveningStart)+'–'+escHtml(eveningEnd)+'</span>';
  if(String(sp.tv_enable||'0')==='1') h+='<span class="pill" style="font-size:10px">TV READY</span>';
  if(String(sp.awning_enable||'0')==='1') h+='<span class="pill" style="font-size:10px">AWNING READY</span>';
  h+='</div>';
  var mapped=[1,2,3,4].map(function(i){ return { idx:i, io:(inst.mappings||[]).find(function(m){return m.input_key==='light_'+i && m.io_id;}), on:on(vals['light_'+i]) }; }).filter(function(z){ return !!z.io; });
  if(mapped.length){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
    mapped.forEach(function(z){
      h+='<div title="'+escHtml((z.io.io_name||('light_'+z.idx))+' • '+(z.on?'ON':'OFF'))+'" style="border:1px solid '+(z.on?'rgba(34,217,122,.28)':'var(--line)')+';background:'+(z.on?'rgba(34,217,122,.06)':'rgba(255,255,255,.03)')+';border-radius:9px;padding:7px 8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">L'+z.idx+'</strong><span style="font-size:10px;font-weight:800;color:'+(z.on?'#22d97a':'var(--muted2)')+'">'+(z.on?'ON':'OFF')+'</span></div>';
      h+='<div style="font-size:10px;color:var(--muted2);margin-top:3px">'+escHtml(z.io.io_name||('light_'+z.idx))+'</div>';
      h+='</div>';
    });
    h+='</div>';
  }
  if(canEngineerUI()){
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">';
    h+='<button onclick="setPresenceArmed('+inst.id+',true)" class="btn btn-sm" style="flex:1 1 120px">Arm</button>';
    h+='<button onclick="setPresenceArmed('+inst.id+',false)" class="btn btn-sm ghost" style="flex:1 1 120px">Disarm</button>';
    h+='</div>';
    h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:4px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  }
  h+='</div>';
  return h;
}


async function markMaintenanceServiced(id, idx, hours){
  try{
    var body={}; body['_hours_at_service_'+idx]=String(Number(hours||0).toFixed(2));
    await api('/automation/settings/'+id,{method:'PATCH',body:JSON.stringify(body)});
    toast('Service acknowledged');
  }catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}
async function renderMaintenance(inst){
  var d={}; try{ d=await api('/automation/status/'+inst.id); }catch(e){}
  var st=d.state||{}, sp=d.settings||{}, paused=!!d.paused;
  var tracked=Array.isArray(st.equipment) ? st.equipment : [];
  if(!tracked.length){
    tracked=[1,2,3,4].map(function(i){
      var map=(inst.mappings||[]).find(function(m){ return m.input_key==='equipment_'+i && m.io_id; });
      if(!map) return null;
      var hours=Number(sp['_hours_'+i]||0), svc=Number(sp['_hours_at_service_'+i]||0), interval=Number(sp['service_interval_h_'+i]||0);
      return { idx:i, name:sp['equipment_name_'+i]||('Equipment '+i), io_name:map.io_name||('equipment_'+i), on:false, hours:hours, interval:interval, hours_since_service:Math.max(0,hours-svc), due: interval>0 && (hours-svc)>=interval };
    }).filter(Boolean);
  }
  var dueCount=Number(st.due_count!=null ? st.due_count : tracked.filter(function(t){return t.due;}).length);
  var runningCount=Number(st.running_count!=null ? st.running_count : tracked.filter(function(t){return t.on;}).length);
  var status=String(st.status || (dueCount>0 ? 'service_due' : (tracked.length ? 'monitoring' : 'idle'))).toUpperCase();
  var reason=String(st.last_reason || (dueCount>0 ? (dueCount+' equipment item(s) due for service') : (tracked.length ? (tracked.length+' equipment item(s) tracked') : 'No equipment mapped'))).slice(0,80);
  var h='';
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">';
  h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Maintenance</div>';
  h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(status==='SERVICE_DUE'?'#ff6b6b':(paused?'#f59e0b':'#22d97a'))+'">'+(status==='SERVICE_DUE'?'SERVICE DUE':tracked.length?'MONITORING':'IDLE')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(reason)+'</div></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<span class="pill" style="border-color:'+(status==='SERVICE_DUE'?'rgba(255,107,107,.35)':paused?'rgba(245,158,11,.35)':'rgba(34,217,122,.35)')+';color:'+(status==='SERVICE_DUE'?'#ff6b6b':paused?'#f59e0b':'#22d97a')+'">'+escHtml(status)+'</span>';
  if(dueCount>0) h+='<span class="pill">DUE '+dueCount+'</span>';
  h+='</div></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px">';
  h+='<div class="compact-badge"><span class="k">Tracked</span><span class="v">'+tracked.length+'</span></div>';
  h+='<div class="compact-badge"><span class="k">Running</span><span class="v">'+runningCount+'</span></div>';
  h+='<div class="compact-badge"><span class="k">Due</span><span class="v">'+dueCount+'</span></div>';
  h+='</div>';
  if(tracked.length){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
    tracked.forEach(function(eq){
      var due=!!eq.due, on=!!eq.on, since=Number(eq.hours_since_service!=null ? eq.hours_since_service : Math.max(0, Number(eq.hours||0) - Number(sp['_hours_at_service_'+eq.idx]||0)));
      var interval=Number(eq.interval||0);
      h+='<div title="'+escHtml((eq.io_name||eq.name||('Equipment '+eq.idx))+' • '+(on?'RUNNING':'OFF'))+'" style="border:1px solid '+(due?'rgba(255,107,107,.28)':(on?'rgba(34,217,122,.28)':'var(--line)'))+';background:'+(due?'rgba(255,107,107,.08)':(on?'rgba(34,217,122,.06)':'rgba(255,255,255,.03)'))+';border-radius:10px;padding:8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">'+escHtml(eq.name||('Equipment '+eq.idx))+'</strong><span style="font-size:10px;font-weight:800;color:'+(due?'#ff6b6b':(on?'#22d97a':'var(--muted2)'))+'">'+(due?'DUE':(on?'ON':'OFF'))+'</span></div>';
      h+='<div style="font-size:10px;color:var(--muted2);margin-top:3px">'+escHtml(eq.io_name||('equipment_'+eq.idx))+'</div>';
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
      h+='<span class="pill" style="font-size:10px">'+Number(since).toFixed(0)+'h since service</span>';
      if(interval>0) h+='<span class="pill" style="font-size:10px">INT '+interval+'h</span>';
      h+='</div>';
      if(canEngineerUI()) h+='<button onclick="markMaintenanceServiced('+inst.id+','+eq.idx+','+Number(eq.hours||0)+')" style="width:100%;margin-top:6px;padding:7px;border-radius:8px;border:1px solid '+(due?'rgba(255,107,107,.3)':'var(--line2)')+';background:'+(due?'rgba(255,107,107,.08)':'rgba(255,255,255,.03)')+';color:'+(due?'#ff6b6b':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Mark serviced</button>';
      h+='</div>';
    });
    h+='</div>';
  }
  if(canEngineerUI()) h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:8px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  return h;
}

async function renderHydronic(inst){
  var d={}; try{ d=await api('/automation/status/'+inst.id); }catch(e){}
  var state=d.state||{}, settings=d.settings||{}, paused=!!d.paused;
  var topology=String(state.topology || settings.topology || ((inst.mappings||[]).some(function(m){return m.input_key==='mixing_valve' && m.io_id;}) ? 'mixing' : 'direct')).toLowerCase();
  var mode=String(state.mode || settings.mode || 'heating').toLowerCase();
  var status=String(state.status || (state.calling_zones>0 ? 'running' : 'idle')).toUpperCase();
  var reason=String(state.last_reason || (state.calling_zones>0 ? (state.calling_zones+' zone(s) calling') : 'Waiting for demand')).slice(0,88);
  var valve=state.valve_pct!=null ? Math.round(Number(state.valve_pct))+'%' : '—';
  var supply=state.temp_supply!=null ? Number(state.temp_supply).toFixed(1)+'°C' : '—';
  var buffer=state.temp_buffer!=null ? Number(state.temp_buffer).toFixed(1)+'°C' : '—';
  var sp=state.computed_supply_sp!=null ? Number(state.computed_supply_sp).toFixed(1)+'°C' : '—';
  var outdoor=state.temp_outdoor!=null ? Number(state.temp_outdoor).toFixed(1)+'°C' : '—';
  var rh=state.humidity_room!=null ? Math.round(Number(state.humidity_room))+'%' : '—';
  var configured=Number(state.configured_zones||0), calling=Number(state.calling_zones||0), activePumps=Number(state.active_zone_pumps||0);
  var zones=Array.isArray(state.zones)?state.zones:[];
  var source1On=!!state.source_1_on, source2On=!!state.source_2_on, mainPumpOn=!!state.main_pump_on, resistanceOn=!!state.resistance_on;
  var statusColor=status==='RUNNING'?'#22d97a':(status==='BLOCKED'?'#f59e0b':status==='THERMAL_DUMP'?'#ff6b6b':paused?'#f59e0b':'var(--muted2)');
  var h='';
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">';
  h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Hydronic</div>';
  h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+statusColor+'">'+escHtml(status.replace(/_/g,' '))+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(reason)+'</div></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<span class="pill" style="border-color:'+(status==='RUNNING'?'rgba(34,217,122,.35)':status==='BLOCKED'?'rgba(245,158,11,.35)':'var(--line)')+';color:'+statusColor+'">'+escHtml(status)+'</span>';
  h+='<span class="pill">'+escHtml(topology.toUpperCase())+'</span>';
  h+='<span class="pill">'+escHtml(mode.toUpperCase())+'</span>';
  h+='</div></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px">';
  h+='<div class="compact-badge"><span class="k">Supply</span><span class="v">'+escHtml(supply)+'</span></div>';
  h+='<div class="compact-badge"><span class="k">Buffer</span><span class="v">'+escHtml(buffer)+'</span></div>';
  h+='<div class="compact-badge"><span class="k">Valve</span><span class="v">'+escHtml(topology==='mixing'?valve:'DIRECT')+'</span></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  function pill(txt,color,border){ return '<span class="pill" style="color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+escHtml(txt)+'</span>'; }
  h+=pill('zones '+configured,'var(--text)','var(--line)');
  h+=pill('calls '+calling,'#22d97a','rgba(34,217,122,.3)');
  h+=pill('pumps '+activePumps,'var(--text)','var(--line)');
  h+=pill('sp '+sp,'var(--text)','var(--line)');
  h+=pill('out '+outdoor,'var(--muted2)','var(--line)');
  h+=pill('rh '+rh,'var(--muted2)','var(--line)');
  if(source1On) h+=pill('source1 on','#22d97a','rgba(34,217,122,.3)');
  if(source2On) h+=pill('source2 on','#22d97a','rgba(34,217,122,.3)');
  if(mainPumpOn) h+=pill('main pump','#1d8cff','rgba(29,140,255,.28)');
  if(resistanceOn) h+=pill('resistance','#f0c040','rgba(240,192,64,.3)');
  if(state.purge_active) h+=pill('purge','#f59e0b','rgba(245,158,11,.35)');
  if(state.dump_active) h+=pill('thermal dump','#ff6b6b','rgba(255,107,107,.35)');
  if(state.condensation_lock) h+=pill('cond lock','#f59e0b','rgba(245,158,11,.35)');
  if(state.flow_fault) h+=pill('flow fault','#ff6b6b','rgba(255,107,107,.35)');
  if(state.src1_fault) h+=pill('hp1 fault','#ff6b6b','rgba(255,107,107,.35)');
  if(state.src2_fault) h+=pill('hp2 fault','#ff6b6b','rgba(255,107,107,.35)');
  h+='</div>';
  if(zones.length){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
    zones.forEach(function(z){
      h+='<div style="border:1px solid '+(z.calling?'rgba(34,217,122,.28)':'var(--line)')+';background:'+(z.calling?'rgba(34,217,122,.06)':'rgba(255,255,255,.03)')+';border-radius:10px;padding:8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px"><strong style="font-size:11px">Zone '+Number(z.n||0)+'</strong><span style="font-size:10px;font-weight:800;color:'+(z.calling?'#22d97a':'var(--muted2)')+'">'+(z.calling?'CALL':'IDLE')+'</span></div>';
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
      h+='<span class="pill" style="font-size:10px">THERMO '+(z.thermostat_mapped?'OK':'—')+'</span>';
      h+='<span class="pill" style="font-size:10px">PUMP '+(z.pump_on?'ON':(z.pump_mapped?'READY':'—'))+'</span>';
      h+='</div></div>';
    });
    h+='</div>';
  }
  if(canEngineerUI()){
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">';
    h+='<button onclick="hydronicResetFault('+inst.id+',1)" style="padding:8px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.08);color:#ff6b6b;font-size:11px;font-weight:800;cursor:pointer">Reset HP1 Fault</button>';
    h+='<button onclick="hydronicResetFault('+inst.id+',2)" style="padding:8px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.08);color:#ff6b6b;font-size:11px;font-weight:800;cursor:pointer">Reset HP2 Fault</button>';
    h+='</div>';
    h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:8px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  }
  return h;
}

async function hydronicResetFault(id,n){
  try{ await api('/automation/settings/'+id,{method:'PATCH',body:JSON.stringify({key:n===1?'_hp1_reset':'_hp2_reset',value:'1'})}); }
  catch(e){ toast('Error: '+e.message); }
  setTimeout(function(){ rerenderInstance(id); },300);
}
async function poolSpaCommand(id, command){
  try{
    await api('/automation/instances/'+id+'/command',{method:'POST',body:JSON.stringify({command:command})});
  }catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}

async function poolSpaResetFault(id, n){
  try{
    await api('/automation/settings/'+id,{method:'PATCH',body:JSON.stringify({key:n===1?'_hp1_reset':'_hp2_reset',value:'1'})});
  }catch(e){ toast('Error: '+e.message); }
  setTimeout(function(){ rerenderInstance(id); },300);
}

async function togglePoolSpaPause(id, cur){
  try{ await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})}); }
  catch(e){ toast('Error: '+e.message); }
  rerenderInstance(id);
}

async function renderPoolSpa(inst){
  var d={}; try{ d=await api('/automation/status/'+inst.id); }catch(e){}
  var state=d.state||{}, values=d.values||{}, settings=d.settings||{}, paused=!!d.paused;

  function pick(){
    for(var i=0;i<arguments.length;i++){
      var v=arguments[i];
      if(v!==undefined && v!==null && v!=='') return v;
    }
    return null;
  }
  function fmt1(v,suffix){ return v!=null ? Number(v).toFixed(1)+(suffix||'') : '—'; }
  function fmt2(v,suffix){ return v!=null ? Number(v).toFixed(2)+(suffix||'') : '—'; }
  function pill(txt,color,border){
    return '<span class="pill" style="color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+escHtml(txt)+'</span>';
  }
  function mini(label,val,hi){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+label+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(hi?'#22d97a':'var(--text)')+'">'+escHtml(val)+'</div></div>';
  }

  var status=String(state.status || (state.flow_fault ? 'fault' : (state.spa_active ? 'spa' : (state.filtration_active ? 'active' : 'idle')))).toUpperCase();
  var reason=String(state.last_reason || 'Waiting for schedule or demand').slice(0,96);
  var statusColor=status==='FAULT' ? '#ff6b6b' : (status==='BACKWASH' ? '#f59e0b' : (status==='SPA' ? '#a855f7' : (status==='ANTI_FREEZE' ? '#06b6d4' : (paused ? '#f59e0b' : '#22d97a'))));

  var tempWater=pick(state.temp_water, values.temp_water);
  var tempCollector=pick(state.temp_collector, values.temp_collector);
  var tempBuffer=pick(state.temp_buffer, values.temp_buffer);
  var tempOutdoor=pick(state.temp_outdoor, values.temp_outdoor);
  var pressure=pick(state.pressure, values.pressure_sensor);
  var phValue=pick(state.ph_value, values.ph_sensor);
  var orpValue=pick(state.orp_value, values.orp_sensor);

  var waterTxt=fmt1(tempWater,'°C');
  var targetTxt=state.target_pool_temp!=null ? Number(state.target_pool_temp).toFixed(1)+'°C' : (settings.pool_temp_target!=null ? Number(settings.pool_temp_target).toFixed(1)+'°C' : '—');
  var filterHours=state.filt_hours_today!=null ? Number(state.filt_hours_today).toFixed(1) : (settings._filt_hours_today!=null ? Number(settings._filt_hours_today).toFixed(1) : '0.0');
  var filterTarget=state.filt_target_today!=null ? Number(state.filt_target_today).toFixed(0) : (settings._filt_target_today!=null ? Number(settings._filt_target_today).toFixed(0) : '—');
  var pressureTxt=fmt2(pressure,' bar');
  var phTxt=phValue!=null ? Number(phValue).toFixed(2) : '—';
  var orpTxt=orpValue!=null ? Math.round(Number(orpValue))+' mV' : '—';
  var spaRemaining=state.spa_active ? Math.max(0, Number(state.spa_remaining_min||0)) : 0;

  var levelLabel=state.level_ok==null ? '—' : (state.level_ok ? 'OK' : 'LOW');
  var flowLabel=state.flow_switch_ok==null ? '—' : (state.flow_switch_ok ? 'OK' : 'NO FLOW');
  var hasSource2=(inst.mappings||[]).some(function(m){ return m.input_key==='heat_source_2' && m.io_id; });

  var h='';
  h+='<div style="display:flex;flex-direction:column;gap:10px">';

  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
  h+='<div>';
  h+='<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Pool & Spa</div>';
  h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+statusColor+'">'+escHtml(status.replace(/_/g,' '))+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(reason)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
  h+='<span class="pill" style="border-color:'+(status==='FAULT'?'rgba(255,107,107,.35)':status==='SPA'?'rgba(168,85,247,.35)':status==='BACKWASH'?'rgba(245,158,11,.35)':status==='ANTI_FREEZE'?'rgba(6,182,212,.35)':'rgba(34,217,122,.35)')+';color:'+statusColor+'">'+escHtml(status)+'</span>';
  if(state.spa_active) h+='<span class="pill" style="border-color:rgba(168,85,247,.35);color:#a855f7">SPA '+spaRemaining+'m</span>';
  if(state.backwash_running) h+='<span class="pill" style="border-color:rgba(245,158,11,.35);color:#f59e0b">BACKWASH</span>';
  if(state.flow_fault) h+='<span class="pill" style="border-color:rgba(255,107,107,.35);color:#ff6b6b">FLOW FAULT</span>';
  h+='</div>';
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:2px">';
  h+='<div style="background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);border-radius:12px;padding:10px;text-align:center"><div style="font-size:10px;font-weight:800;color:#06b6d4;text-transform:uppercase;letter-spacing:1px">Water</div><div style="font-size:24px;font-weight:900;margin-top:4px">'+waterTxt+'</div><div style="font-size:11px;color:var(--muted2)">target '+targetTxt+'</div></div>';
  h+='<div style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.2);border-radius:12px;padding:10px;text-align:center"><div style="font-size:10px;font-weight:800;color:#22d97a;text-transform:uppercase;letter-spacing:1px">Filter Today</div><div style="font-size:24px;font-weight:900;margin-top:4px">'+filterHours+'h</div><div style="font-size:11px;color:var(--muted2)">target '+filterTarget+'h</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:12px;padding:10px;text-align:center"><div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Pressure</div><div style="font-size:24px;font-weight:900;margin-top:4px;color:'+(state.pressure_high?'#ff6b6b':'var(--text)')+'">'+pressureTxt+'</div><div style="font-size:11px;color:var(--muted2)">'+(state.pressure_high?'high':'normal')+'</div></div>';
  h+='</div>';

  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  if(String(settings.test_mode||'0')==='1') h+=pill('TEST MODE','#ffd978','rgba(255,201,71,.35)');
  h+=pill('filter '+(state.filter_pump_on?'on':'off'), state.filter_pump_on?'#22d97a':'var(--muted2)', state.filter_pump_on?'rgba(34,217,122,.3)':'var(--line)');
  h+=pill('target '+(state.filter_target_met?'met':'pending'), state.filter_target_met?'#22d97a':'#f59e0b', state.filter_target_met?'rgba(34,217,122,.3)':'rgba(245,158,11,.35)');
  if(state.solar_active || state.configured_solar) h+=pill('solar '+(state.solar_active?'active':'ready'), state.solar_active?'#f59e0b':'var(--muted2)', state.solar_active?'rgba(245,158,11,.35)':'var(--line)');
  if(state.configured_heating) h+=pill('sources '+((state.heat_source_1_on||state.heat_source_2_on)?'active':'ready'), (state.heat_source_1_on||state.heat_source_2_on)?'#ff9a3a':'var(--muted2)', (state.heat_source_1_on||state.heat_source_2_on)?'rgba(255,154,58,.28)':'var(--line)');
  if(state.configured_spa) h+=pill('spa '+(state.spa_active?'active':'ready'), state.spa_active?'#a855f7':'var(--muted2)', state.spa_active?'rgba(168,85,247,.3)':'var(--line)');
  if(state.configured_backwash) h+=pill('backwash '+(state.backwash_running?'running':(state.backwash_needed?'needed':'ready')), (state.backwash_running||state.backwash_needed)?'#f59e0b':'var(--muted2)', (state.backwash_running||state.backwash_needed)?'rgba(245,158,11,.35)':'var(--line)');
  if(state.anti_freeze_active) h+=pill('anti-freeze', '#06b6d4', 'rgba(6,182,212,.3)');
  if(state.lights_on || state.spa_jets_on || state.configured_spa) h+=pill('lights/jets '+((state.lights_on||state.spa_jets_on)?'on':'ready'), (state.lights_on||state.spa_jets_on)?'#1d8cff':'var(--muted2)', (state.lights_on||state.spa_jets_on)?'rgba(29,140,255,.28)':'var(--line)');
  if(state.configured_dosing) h+=pill('dosing '+(state.dosing_active?'active':'ready'), state.dosing_active?'#06b6d4':'var(--muted2)', state.dosing_active?'rgba(6,182,212,.28)':'var(--line)');
  if(state.flow_fault || state.hp1_fault || state.hp2_fault) h+=pill('faults active', '#ff6b6b', 'rgba(255,107,107,.35)');
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">';
  h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px">';
  h+='<div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Filtration</div>';
  h+=mini('Pump', state.filter_pump_on?'ON':'OFF', !!state.filter_pump_on);
  h+=mini('Window', state.filter_window_slot?String(state.filter_window_slot).replace('_',' ').toUpperCase():'OFF', !!state.filter_window_active);
  h+=mini('Today', filterHours+'h / '+filterTarget+'h', !!state.filter_target_met);
  h+='</div>';

  h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px">';
  h+='<div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Heating</div>';
  h+=mini('Solar', state.solar_active?'ACTIVE':'OFF', !!state.solar_active);
  h+=mini('Source 1', state.heat_source_1_on ? ((state.source_1_type||'source 1').toUpperCase()+' ON') : ((state.source_1_type||'source 1').toUpperCase()+' READY'), !!state.heat_source_1_on);
  h+=mini('Source 2', hasSource2 ? (state.heat_source_2_on ? ((state.source_2_type||'source 2').toUpperCase()+' ON') : ((state.source_2_type||'source 2').toUpperCase()+' READY')) : '—', !!state.heat_source_2_on);
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'+pill('collector '+fmt1(tempCollector,'°C'))+pill('buffer '+fmt1(tempBuffer,'°C'))+pill('out '+fmt1(tempOutdoor,'°C'))+'</div>';
  h+='</div>';

  h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px">';
  h+='<div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Chemistry</div>';
  h+=mini('pH', phTxt, !(state.ph_alert));
  h+=mini('ORP', orpTxt, !(state.orp_alert));
  h+=mini('Dosing', state.dosing_active?'ACTIVE':'IDLE', !!state.dosing_active);
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
  if(state.dose_ph_minus_active) h+=pill('pH-','#f59e0b','rgba(245,158,11,.35)');
  if(state.dose_ph_plus_active) h+=pill('pH+','#22d97a','rgba(34,217,122,.28)');
  if(state.dose_cl_active) h+=pill('Cl','#06b6d4','rgba(6,182,212,.28)');
  if(state.ph_alert) h+=pill('pH alert','#ff6b6b','rgba(255,107,107,.35)');
  if(state.orp_alert) h+=pill('ORP alert','#ff6b6b','rgba(255,107,107,.35)');
  h+='</div></div>';

  h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px">';
  h+='<div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Spa / Safety</div>';
  h+=mini('Spa', state.spa_active?('ACTIVE • '+spaRemaining+'m'):'READY', !!state.spa_active);
  h+=mini('Backwash', state.backwash_running?'RUNNING':(state.backwash_needed?'NEEDED':'READY'), !!(state.backwash_running||state.backwash_needed));
  h+=mini('Flow / Level', flowLabel+' • '+levelLabel, state.flow_switch_ok!==false && state.level_ok!==false);
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
  if(state.lights_on) h+=pill('lights','#1d8cff','rgba(29,140,255,.28)');
  if(state.spa_jets_on) h+=pill('jets','#a855f7','rgba(168,85,247,.3)');
  if(state.anti_freeze_active) h+=pill('anti-freeze','#06b6d4','rgba(6,182,212,.3)');
  if(state.pressure_high) h+=pill('pressure high','#ff6b6b','rgba(255,107,107,.35)');
  if(state.flow_fault) h+=pill('flow fault','#ff6b6b','rgba(255,107,107,.35)');
  if(state.hp1_fault) h+=pill('hp1 fault','#ff6b6b','rgba(255,107,107,.35)');
  if(state.hp2_fault) h+=pill('hp2 fault','#ff6b6b','rgba(255,107,107,.35)');
  h+='</div></div>';
  h+='</div>';

  if(canEngineerUI()){
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:6px">';
    h+='<button onclick="poolSpaCommand('+inst.id+',\'start_spa_boost\')" style="padding:8px;border-radius:9px;border:1px solid rgba(168,85,247,.3);background:rgba(168,85,247,.08);color:#a855f7;font-size:11px;font-weight:800;cursor:pointer">Start Spa Boost</button>';
    h+='<button onclick="poolSpaCommand('+inst.id+',\'stop_spa_boost\')" style="padding:8px;border-radius:9px;border:1px solid rgba(168,85,247,.3);background:rgba(168,85,247,.08);color:#a855f7;font-size:11px;font-weight:800;cursor:pointer">Stop Spa</button>';
    h+='<button onclick="poolSpaCommand('+inst.id+',\'reset_flow_fault\')" style="padding:8px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.08);color:#ff6b6b;font-size:11px;font-weight:800;cursor:pointer">Reset Flow Fault</button>';
    h+='<button onclick="poolSpaResetFault('+inst.id+',1)" style="padding:8px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.08);color:#ff6b6b;font-size:11px;font-weight:800;cursor:pointer">Reset HP1 Fault</button>';
    if(hasSource2) h+='<button onclick="poolSpaResetFault('+inst.id+',2)" style="padding:8px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.08);color:#ff6b6b;font-size:11px;font-weight:800;cursor:pointer;grid-column:span 2">Reset HP2 Fault</button>';
    h+='</div>';
    h+='<button onclick="togglePoolSpaPause('+inst.id+','+paused+')" style="width:100%;margin-top:8px;padding:9px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause')+'</button>';
  }

  h+='</div>';
  return h;
}

var MODULE_ACCENT={solar:'#ff9a3a',thermostat:'#1d8cff',lighting:'#f5c842',energy:'#f59e0b',custom:'#a855f7',awning:'#22d97a',water_manager:'#3ab8ff',load_shifter:'#f59e0b',presence_simulator:'#a855f7',maintenance:'#94a3b8',hydronic_manager:'#ff6b35',pool_spa:'#06b6d4'};
var MODULE_ICON={solar:'\u2600\ufe0f',thermostat:'\ud83c\udf21\ufe0f',lighting:'\ud83d\udca1',energy:'\u26a1',custom:'\u2699\ufe0f',awning:'\ud83e\ude9f',water_manager:'\ud83d\udca7',load_shifter:'\u26a1',presence_simulator:'\ud83c\udfe0',maintenance:'\ud83d\udd27',hydronic_manager:'🌡️',pool_spa:'🏊'};

async function renderInstance(inst){
  var grid=$('pageGrid'); if(!grid)return;
  var cardId='inst-card-'+inst.id;
  var card=document.getElementById(cardId);
  var isNew=!card;
  if(isNew){card=document.createElement('div');card.id=cardId;card.className='inst-card';card.style.setProperty('--inst-accent',MODULE_ACCENT[inst.module_id]||'#1d8cff');grid.appendChild(card);}
  card.classList.toggle('wide-card', false);
  card.classList.toggle('thermo-card', inst.module_id==='thermostat');
  var icon=MODULE_ICON[inst.module_id]||'\ud83d\udce6';
  if(isNew){card.innerHTML='<div class="inst-header"><div class="inst-name">'+icon+' '+escapeHTML(inst.name||'Instance #'+inst.id)+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>';}
  var content='';
  try{
    if(inst.module_id==='solar')content=await renderSolar(inst);
    else if(inst.module_id==='thermostat')content=await renderThermostat(inst);
    else if(inst.module_id==='lighting')content=await renderLighting(inst);
    else if(inst.module_id==='awning')content=await renderAwning(inst);
    else if(inst.module_id==='smart_lighting')content=await renderSmartLighting(inst);
    else if(inst.module_id==='irrigation')content=await renderIrrigation(inst);
    else if(inst.module_id==='pool_spa')content=await renderPoolSpa(inst);
    else if(inst.module_id==='water_manager')content=await renderWaterManager(inst);
    else if(inst.module_id==='load_shifter')content=await renderLoadShifter(inst);
    else if(inst.module_id==='presence_simulator')content=await renderPresenceSimulator(inst);
    else if(inst.module_id==='energy')content=await renderEnergy(inst);
    else content='<div style="color:var(--muted);font-size:12px">'+escapeHTML(inst.module_id)+' \u2014 coming soon</div>';
  }catch(e){content='<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>';}
  var body=document.getElementById('inst-body-'+inst.id); if(body)body.innerHTML=content;
}

async function rerenderInstance(id){ var inst=pstate._instances.find(function(i){return i.id===id;}); if(inst)await renderInstance(inst); }

var _rt=null;
async function refreshAll(){ clearTimeout(_rt); for(var i=0;i<pstate._instances.length;i++)await renderInstance(pstate._instances[i]); _rt=setTimeout(refreshAll,15000); }

(async function(){
  applyTheme(localStorage.getItem('elaris_theme')||'dark');
  try{
    await loadMe(); await loadSites(); connectWS(); await loadNav();
    var params=new URLSearchParams(location.search);
    var mf=params.get('module'); var pid=params.get('id')?Number(params.get('id')):null;
    var d=await api('/modules/instances');
    var all=(d.instances||[]).filter(function(i){return i.active!==false;});
    var show=[]; var title='';
    if(mf){ show=all.filter(function(i){return i.module_id===mf;}); title=(MODULE_ICON[mf]||'')+' '+mf.charAt(0).toUpperCase()+mf.slice(1); }
    else if(pid){ var nd=await fetch('/api/nav/pages').then(function(r){return r.json();}).catch(function(){return{pages:[]};});
      var pg=(nd.pages||[]).find(function(p){return p.id===pid;});
      if(pg){var ids=JSON.parse(pg.instances_json||'[]');show=all.filter(function(i){return ids.indexOf(i.id)!==-1;});title=(pg.icon||'')+' '+pg.name;} }
    var te=$('pageTitle'); if(te)te.textContent=title;
    document.title='ELARIS \u2014 '+(title||'Page');
    var grid=$('pageGrid');
    if(!show.length){grid.innerHTML='<div style="color:var(--muted);font-size:14px;padding:20px">No modules found.<br><a href="/modules.html" style="color:var(--blue)">Configure modules \u2192</a></div>';return;}
    grid.innerHTML=''; pstate._instances=show; await refreshAll();
  }catch(e){ console.error('[ELARIS page.js]',e); var g=$('pageGrid'); if(g)g.innerHTML='<div style="color:var(--bad);font-size:13px;padding:20px">Error: '+escapeHTML(e.message)+'</div>'; }
})();

// ── Lighting Widget ──────────────────────────────────────────────────────────
async function renderLighting(inst){
  var st={};
  try{st=await api('/automation/status/'+inst.id);}catch(e){}
  var v=st.values||{}, sp=st.settings||{}, isPaused=st.paused||false;
  var state=st.state||{};
  var mode=(sp.mode||state.mode||'auto').toLowerCase();
  var lux=v.lux_sensor!=null?Number(v.lux_sensor).toFixed(0):null;
  var pir=v.pir_sensor;
  var motion=pir==='ON'||pir==='1'||pir==='true'||pir===1||pir===true;
  var motionAI=v.motion_ai!=null?Number(v.motion_ai).toFixed(0):null;
  var dimVal=v.dimmer_output!=null?Math.round(Number(v.dimmer_output)):(state.dimmer_level!=null?Math.round(Number(state.dimmer_level)):null);
  var hasDimmer=dimVal!==null || (inst.mappings||[]).some(function(m){ return m.input_key==='dimmer_output'; });
  var relayVal=v.light_relay;
  var relayOn=relayVal==='ON'||relayVal==='1'||relayVal===1||relayVal===true;
  var isOn=hasDimmer ? (Number(dimVal||0)>(Number(sp.dim_off_level||0)+5)) : !!(state.output_on||relayOn);
  var source=String(state.source||'manual').toLowerCase();
  var lastReason=state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action';
  var modeColorMap={auto:'#22d97a',pir:'#1d8cff',lux:'#f5c842',combined:'#22d97a',schedule:'#a855f7',manual:'#6b7a90'};
  var sourceLabelMap={manual:'Manual', motion:'Motion', pir:'Motion', schedule:'Schedule', lux:'Lux', combined:'Combined', auto:'Auto'};
  var reasonTitle=escHtml(lastReason);

  var h='<div style="display:flex;flex-direction:column;gap:10px">';

  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
  h+='<div>';
  h+='<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Lighting</div>';
  h+='<div title="'+reasonTitle+'" style="margin-top:3px;font-size:24px;font-weight:900;color:'+(isOn?'#f5c842':'var(--muted2)')+'">'+(hasDimmer?(dimVal!=null?dimVal:0)+'%':(isOn?'ON':'OFF'))+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(sourceLabelMap[source]||sourceLabelMap[mode]||'Auto')+' • '+escHtml(lastReason.length>42?(lastReason.slice(0,42)+'…'):lastReason)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;gap:8px;align-items:center">';
  h+='<button onclick="manualLight('+inst.id+','+isOn+')" style="padding:9px 14px;border-radius:10px;border:1px solid '+(isOn?'rgba(245,200,66,.5)':'var(--line2)')+';background:'+(isOn?'rgba(245,200,66,.15)':'rgba(255,255,255,.05)')+';color:'+(isOn?'#f5c842':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isOn?'Turn OFF':'Turn ON')+'</button>';
  h+='</div>';
  h+='</div>';

  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<span style="background:rgba(255,255,255,.05);border:1px solid '+(modeColorMap[mode]||'var(--line)')+';border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;color:'+(modeColorMap[mode]||'var(--muted2)')+'">'+escHtml(mode.toUpperCase())+'</span>';
  h+='<span style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:'+(isOn?'#22d97a':'var(--muted2)')+'">'+(isOn?'LIGHT ON':'LIGHT OFF')+'</span>';
  if(state.manual_active) h+='<span style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#f59e0b">MANUAL</span>';
  if(state.schedule_active) h+='<span style="background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#a855f7">SCHEDULE</span>';
  if(state.motion_active || motion) h+='<span style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#22d97a">MOTION</span>';
  if(state.dark===true || (lux!==null && sp.lux_threshold && Number(lux)<Number(sp.lux_threshold))) h+='<span style="background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#f5c842">DARK</span>';
  h+='</div>';

  if(hasDimmer){
    var shownDim = dimVal!=null?dimVal:0;
    h+='<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center">';
    h+='<span style="font-size:11px;color:var(--muted2);font-weight:700">DIM</span>';
    h+='<input type="range" min="0" max="100" value="'+shownDim+'" style="width:100%" oninput="this.nextSibling.textContent=this.value+\'%\'" onchange="setDimmer('+inst.id+',this.value)">';
    h+='<span style="font-size:11px;color:var(--muted2);min-width:38px;text-align:right">'+shownDim+'%</span>';
    h+='</div>';
  }

  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
  function miniStat(label,val,hi){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+label+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(hi?'#22d97a':'var(--text)')+'">'+val+'</div></div>';
  }
  h+=miniStat('Source', escHtml(sourceLabelMap[source]||sourceLabelMap[mode]||'Auto'), false);
  h+=miniStat('Motion', motion ? 'Detected' : 'Idle', motion || !!state.motion_active);
  var luxText = lux!==null ? lux+' lux' : (motionAI!==null ? 'AI '+motionAI : '—');
  h+=miniStat('Lux / AI', escHtml(luxText), lux!==null && sp.lux_threshold && Number(lux)<Number(sp.lux_threshold));
  h+='</div>';

  h+='<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--muted2)">';
  if(sp.schedule_on) h+='<span>⏰ '+sp.schedule_on+' – '+(sp.schedule_off||'?')+'</span>';
  if((mode==='pir'||mode==='auto'||mode==='combined')&&sp.pir_timeout) h+='<span>timeout '+sp.pir_timeout+'s</span>';
  if(mode!=='pir'&&sp.lux_threshold) h+='<span>dark &lt; '+sp.lux_threshold+' lux</span>';
  h+='</div>';

  if(canEngineerUI()){
    h+='<button onclick="toggleLightPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'▶ Resume':'⏸ Pause Automation')+'</button>';
  }
  h+='</div>';
  return h;
}
async function setDimmer(id,val){
  try{await api('/automation/lighting/'+id+'/level',{method:'POST',body:JSON.stringify({level:Number(val)})});}catch(e){toast('Error: '+e.message);}
  setTimeout(function(){rerenderInstance(id);},400);
}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
async function manualLight(id,isOn){
  try{await api('/automation/lighting/'+id+'/manual',{method:'POST',body:JSON.stringify({on:!isOn})});}catch(e){toast('Cannot control');}
  setTimeout(function(){rerenderInstance(id);},300);
}
async function toggleLightPause(id,cur){ try{await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }

// ── Awning / Blind Widget ────────────────────────────────────────────────────
async function renderAwning(inst){
  var d={};
  try{d=await api('/automation/status/'+inst.id);}catch(e){}
  var v=d.values||{}, sp=d.settings||{}, isPaused=d.paused||false;
  var wind=v.wind_sensor!=null?Number(v.wind_sensor).toFixed(1):null;
  var rain=v.rain_sensor;
  var lux=v.lux_sensor!=null?Number(v.lux_sensor).toFixed(0):null;
  var isRaining=rain==='ON'||rain==='1';
  var windHigh=wind!==null&&Number(wind)>=(sp.wind_retract||40);
  var lastLog=(d.lastLog||[]);
  var lastReason=lastLog[0]?lastLog[0].reason:'—';

  // Determine visual state from last log or relay states
  var relayOpen=v.relay_open==='ON', relayClosed=v.relay_close==='ON';
  var stateLabel='Unknown'; var stateColor='var(--muted2)';
  if(relayOpen){stateLabel='Opening…';stateColor='#22d97a';}
  else if(relayClosed){stateLabel='Closing…';stateColor='#f59e0b';}
  else if(lastReason.toLowerCase().includes('deploy')||lastReason.toLowerCase().includes('open')){stateLabel='Open';stateColor='#22d97a';}
  else if(lastReason.toLowerCase().includes('retract')||lastReason.toLowerCase().includes('clos')){stateLabel='Closed';stateColor='#f59e0b';}

  var h='<div style="display:flex;flex-direction:column;gap=10px">';

  // State header
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
  h+='<div><div style="font-size:22px;font-weight:800;color:'+stateColor+'">🪟 '+stateLabel+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(lastReason)+'</div></div>';
  if(windHigh||isRaining) h+='<span style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800">'+(windHigh?'⚠️ HIGH WIND':'🌧️ RAIN')+'</span>';
  h+='</div>';

  // Manual controls
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px">';
  var btnStyle='padding:10px 6px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer;text-align:center';
  h+='<button onclick="awningCmd('+inst.id+',\'open\')" style="'+btnStyle+';border-color:rgba(34,217,122,.4);color:#22d97a">▲ Open</button>';
  h+='<button onclick="awningCmd('+inst.id+',\'stop\')" style="'+btnStyle+'">⏹ Stop</button>';
  h+='<button onclick="awningCmd('+inst.id+',\'close\')" style="'+btnStyle+';border-color:rgba(245,158,11,.4);color:#f59e0b">▼ Close</button>';
  h+='</div>';

  // Sensor pills
  var pills=[];
  if(wind!==null) pills.push({icon:'💨',val:wind+' km/h',warn:windHigh});
  if(rain!==null) pills.push({icon:'🌧️',val:isRaining?'Rain':'Dry',warn:isRaining});
  if(lux!==null)  pills.push({icon:'☀️',val:lux+' lux',warn:false});
  if(pills.length){
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">';
    pills.forEach(function(p){
      h+='<span style="background:rgba(255,255,255,.05);border:1px solid '+(p.warn?'rgba(239,68,68,.4)':'var(--line)')+';border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:'+(p.warn?'#ef4444':'var(--text)')+'">'+p.icon+' '+p.val+'</span>';
    });
    h+='</div>';
  }

  // Setpoints mini row
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">';
  if(String(sp.test_mode||'0')==='1') h+='<span class="pill" style="font-size:10px;border-color:rgba(255,201,71,.35);color:#ffd978">TEST MODE</span>';
  h+='<span style="font-size:10px;color:var(--muted2)">Retract ≥ '+(sp.wind_retract||40)+' km/h</span>';
  h+='<span style="font-size:10px;color:var(--muted2)">•</span>';
  h+='<span style="font-size:10px;color:var(--muted2)">Rain: '+(sp.rain_retract==='1'||sp.rain_retract===1?'enabled':'disabled')+'</span>';
  h+='</div>';

  // Pause
  if(canEngineerUI()){
    h+='<button onclick="toggleAwningPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:6px;padding:8px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'▶ Resume':'⏸ Pause Automation')+'</button>';
  }
  h+='</div>';
  return h;
}
async function awningCmd(id,cmd){
  try{await api('/automation/awning/'+id+'/control',{method:'POST',body:JSON.stringify({action:cmd})});}catch(e){toast('Error: '+e.message);}
  setTimeout(function(){rerenderInstance(id);},400);
}
async function toggleAwningPause(id,cur){ try{await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})});}catch(e){toast('Error: '+e.message);} rerenderInstance(id); }

// ─── Smart Lighting widget ─────────────────────────────────────────────────
async function renderSmartLighting(inst){
  var statusData={}, liveData={};
  try{ statusData=await api('/automation/smart_lighting/'+inst.id+'/status'); }catch(e){}
  try{ liveData=await api('/automation/status/'+inst.id); }catch(e){}
  var settings=liveData.settings||{};
  var state=liveData.state||{};
  var scenarios=[];
  try{ scenarios=JSON.parse(settings.scenarios||'[]'); }catch(e){}
  if(!Array.isArray(scenarios)) scenarios=[];
  var activeId=(statusData.active_scenario&&statusData.active_scenario.id)|| state.active_scene || null;
  var active=scenarios.find(function(s){return s.id===activeId;}) || null;
  var enabledScenarios=scenarios.filter(function(s){ return s.enabled!==false; });
  var lastReason=state.last_reason || 'No active scenario';

  var h='';
  if(!enabledScenarios.length){
    h+='<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px 0">No scenarios configured.<br>';
    h+='<a href="/modules.html" style="color:var(--blue);font-size:11px">Edit in Modules →</a></div>';
    return h;
  }

  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
  h+='<div>';
  h+='<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Smart Lighting</div>';
  h+='<div title="'+escHtml(lastReason)+'" style="margin-top:3px;font-size:22px;font-weight:900;color:'+(active?'#f0c040':'var(--muted2)')+'">'+escHtml(active?active.name:'Idle')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(lastReason.length>46?(lastReason.slice(0,46)+'…'):lastReason)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;gap:8px;align-items:center">';
  h+='<button onclick="slActivate('+inst.id+',null)" style="padding:9px 12px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">Off</button>';
  h+='</div>';
  h+='</div>';

  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  function pill(txt,color,border){ return '<span style="background:rgba(255,255,255,.05);border:1px solid '+(border||'var(--line)')+';border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;color:'+(color||'var(--muted2)')+'">'+escHtml(txt)+'</span>'; }
  h+=pill(String(state.status|| (active?'active':'idle')).toUpperCase(), state.status==='panic'?'#ef4444':active?'#f0c040':'var(--muted2)', state.status==='panic'?'rgba(239,68,68,.35)':active?'rgba(240,192,64,.28)':'var(--line)');
  if(String(settings.test_mode||'0')==='1') h+=pill('TEST MODE','#ffd978','rgba(255,201,71,.35)');
  if(state.manual_override) h+=pill('MANUAL','#f59e0b','rgba(245,158,11,.35)');
  if(state.motion_active) h+=pill('MOTION','#22d97a','rgba(34,217,122,.35)');
  if(state.schedule_active) h+=pill('SCHEDULE','#a855f7','rgba(168,85,247,.35)');
  if(state.lux_value!=null) h+=pill(Math.round(Number(state.lux_value))+' lux','var(--muted2)','var(--line)');
  h+=pill(enabledScenarios.length+' scenes','var(--muted2)','var(--line)');
  h+='</div>';

  if(active){
    h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
    var outs=(active.outputs||[]);
    var dimmers=outs.filter(function(o){ return !(String(o.io_key||'').startsWith('do_')); }).length;
    var relays=outs.filter(function(o){ return String(o.io_key||'').startsWith('do_'); }).length;
    function mini(label,val,hi){ return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+label+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(hi?'#f0c040':'var(--text)')+'">'+escHtml(val)+'</div></div>'; }
    h+=mini('Trigger', String(active.trigger||'manual').toUpperCase(), false);
    h+=mini('Outputs', String(outs.length), false);
    h+=mini('Types', (relays?relays+' relay ':'')+(dimmers?dimmers+' dim':'') || '—', false);
    h+='</div>';
  }

  h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
  enabledScenarios.slice(0,6).forEach(function(s){
    var isActive=s.id===activeId;
    var triggerLabels={manual:'Manual',time:'Time',sunset:'Sunset',sunrise:'Sunrise',pir:'Motion',switch:'Switch'};
    h+='<button onclick="slActivate('+inst.id+',\''+String(s.id).replace(/'/g,'&#39;')+'\')" style="text-align:left;padding:9px 10px;border-radius:10px;border:1px solid '+(isActive?'rgba(240,192,64,.32)':'var(--line)')+';background:'+(isActive?'rgba(240,192,64,.08)':'rgba(255,255,255,.03)')+';cursor:pointer">';
    h+='<div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">'+(s.icon||'💡')+'</span><div style="min-width:0;flex:1"><div style="font-size:12px;font-weight:800;color:'+(isActive?'#f0c040':'var(--text)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(s.name||'Scenario')+'</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">'+escHtml(triggerLabels[s.trigger||'manual']||String(s.trigger||'manual'))+'</div></div>'+(isActive?'<span style="font-size:10px;color:#f0c040;font-weight:800">●</span>':'')+'</div>';
    h+='</button>';
  });
  h+='</div>';

  if(enabledScenarios.length>6){
    h+='<div style="font-size:11px;color:var(--muted2);text-align:center">+'+(enabledScenarios.length-6)+' more scenarios in module settings</div>';
  }

  var sensorMappings=(inst.mappings||[]).filter(function(m){return m.io_id&&(m.input_key.startsWith('di_')||m.input_key.startsWith('ai_'));});
  if(sensorMappings.length){
    var ioParams=sensorMappings.map(function(m){return m.io_id;}).join(',');
    h+='<a href="/history.html?io='+ioParams+'" style="display:block;text-align:center;font-size:11px;color:var(--blue);padding-top:4px">📈 View sensor history</a>';
  }
  return h;
}
async function slActivate(instId, scenarioId){
  try {
    if(scenarioId){
      await api('/automation/smart_lighting/'+instId+'/activate',{method:'POST',body:JSON.stringify({scenario_id:scenarioId})});
    } else {
      // send OFF to all outputs
      await api('/automation/smart_lighting/'+instId+'/activate',{method:'POST',body:JSON.stringify({scenario_id:null})});
    }
    setTimeout(function(){ rerenderInstance(instId); }, 300);
  } catch(e){ console.error('slActivate:',e); }
}

function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ─── Energy Monitor widget ─────────────────────────────────────────────────
async function renderEnergy(inst){
  var st={};
  try{ st=await api('/energy/'+inst.id+'/status'); }catch(e){}

  var state=st.state||{}, values=st.values||{}, settings=st.settings||{}, paused=!!st.paused;
  var watts = state.watts!=null ? Number(state.watts) : (values['power_w']!=null ? Number(values['power_w']) : null);
  var kwhToday = Number(state.kwh_today!=null ? state.kwh_today : (settings['_kwh_today']||0));
  var kwhMonth = Number(state.kwh_month!=null ? state.kwh_month : (settings['_kwh_month']||0));
  var kwhTotal = Number(state.kwh_total!=null ? state.kwh_total : (settings['_kwh_total']||0));
  var peakD = Number(state.peak_today!=null ? state.peak_today : (settings['_peak_w_today']||0));
  var peakM = Number(state.peak_month!=null ? state.peak_month : (settings['_peak_w_month']||0));
  var tariff = Number(state.tariff!=null ? state.tariff : (settings['tariff']||0.20));
  var costToday = Number(state.cost_today!=null ? state.cost_today : (kwhToday * tariff));
  var costMonth = Number(state.cost_month!=null ? state.cost_month : (kwhMonth * tariff));
  var alertAbove = Number(state.alert_above!=null ? state.alert_above : (settings['alert_above_w']||0));
  var status = String(state.status || (paused ? 'paused' : 'monitoring')).toUpperCase();
  var reason = String(state.last_reason || (watts!=null ? ('Monitoring '+Math.round(watts)+'W live load') : 'Waiting for live power data'));
  var wattColor = watts!=null && alertAbove>0 && watts>alertAbove ? 'var(--bad)' : watts!=null && watts>0 ? '#f59e0b' : 'var(--muted2)';
  var pwMap=(inst.mappings||[]).find(function(m){return m.input_key==='power_w'&&m.io_id;});
  var relayMap=(inst.mappings||[]).find(function(m){return m.input_key==='relay'&&m.io_id;});

  var h='';
  h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<span class="pill" style="border-color:'+(status==='ALERT'?'rgba(255,107,107,.35)':status==='PAUSED'?'rgba(245,158,11,.35)':'rgba(34,217,122,.35)')+';color:'+(status==='ALERT'?'#ff6b6b':status==='PAUSED'?'#f59e0b':'#22d97a')+'">'+status+'</span>';
  if(alertAbove>0) h+='<span class="pill">Alert '+Math.round(alertAbove)+'W</span>';
  if(relayMap) h+='<span class="pill">Relay '+(state.relay_on?'ON':'Ready')+'</span>';
  h+='</div>';
  h+='<div style="font-size:11px;color:var(--muted2);text-align:right">'+escHtml(reason).slice(0,44)+'</div>';
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px;margin-bottom:10px">';
  h+='<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:10px;text-align:center">';
  h+='<div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Live power</div>';
  h+='<div style="font-size:30px;font-weight:900;color:'+wattColor+';line-height:1.05;margin-top:4px">'+(watts!=null?Math.round(watts):'—')+'</div>';
  h+='<div style="font-size:11px;color:var(--muted2)">W</div>';
  h+='</div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:12px;padding:10px;text-align:center">';
  h+='<div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Today</div>';
  h+='<div style="font-size:18px;font-weight:900;margin-top:4px">'+kwhToday.toFixed(2)+'<span style="font-size:11px;color:var(--muted2)"> kWh</span></div>';
  h+='<div style="font-size:11px;color:var(--muted2)">€'+costToday.toFixed(2)+'</div>';
  h+='</div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:12px;padding:10px;text-align:center">';
  h+='<div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Month</div>';
  h+='<div style="font-size:18px;font-weight:900;margin-top:4px">'+kwhMonth.toFixed(2)+'<span style="font-size:11px;color:var(--muted2)"> kWh</span></div>';
  h+='<div style="font-size:11px;color:var(--muted2)">€'+costMonth.toFixed(2)+'</div>';
  h+='</div>';
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px">';
  h+='<div class="compact-badge"><span class="k">Peak today</span><span class="v">'+Math.round(peakD||0)+'W</span></div>';
  h+='<div class="compact-badge"><span class="k">Peak month</span><span class="v">'+Math.round(peakM||0)+'W</span></div>';
  h+='<div class="compact-badge"><span class="k">Total</span><span class="v">'+kwhTotal.toFixed(1)+'kWh</span></div>';
  h+='</div>';

  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  h+='<span class="pill">Tariff €'+tariff.toFixed(2)+'/kWh</span>';
  if(pwMap) h+='<span class="pill">Meter mapped</span>';
  if(relayMap) h+='<span class="pill">Relay mapped</span>';
  h+='</div>';

  if(pwMap){
    h+='<a href="/history.html?io='+pwMap.io_id+'" style="display:block;text-align:center;font-size:11px;color:var(--blue);margin-top:4px;padding-top:8px;border-top:1px solid var(--line)">📈 View power history</a>';
  }

  if(canEngineerUI()){
    h+='<button onclick="toggleEnergyPause('+inst.id+','+paused+')" style="width:100%;margin-top:10px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Monitoring')+'</button>';
  }
  return h;
}

async function toggleEnergyPause(id,cur){
  try{ await api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})}); }catch(e){toast('Error: '+e.message);}
  rerenderInstance(id);
}
