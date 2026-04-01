(function(){
  var THERMO_FAMILY_IDS = new Set(['basic_thermostat','call_thermostat','zoned_thermostat','thermostat']);
  function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function badge(txt, color, border){ return '<span class="pill" style="display:inline-flex;align-items:center;white-space:nowrap;font-size:10px;padding:4px 10px;color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+esc(txt)+'</span>'; }
  function thermoMeta(moduleId){ switch(String(moduleId||'')){ case 'basic_thermostat': return { label:'Basic Thermostat', hasSetpoint:true, isZoned:false }; case 'call_thermostat': return { label:'Call Thermostat', hasSetpoint:false, isZoned:false }; case 'zoned_thermostat': return { label:'Zoned Thermostat', hasSetpoint:true, isZoned:true }; case 'thermostat': return { label:'Advanced Thermostat', hasSetpoint:true, isZoned:true }; default: return { label:'Thermostat', hasSetpoint:true, isZoned:false }; } }
  function thermoControl(moduleId,id,payload){ return api('/automation/'+moduleId+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)}).catch(function(){ toast('Cannot control '+moduleId); }).finally(function(){ setTimeout(function(){ rerenderInstance(id); }, 220); }); }
  function computeThermoState(st){
    var v=st.values||{}, state=st.state||{}, sp=st.settings||{};
    var lastReason=String(state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action');
    var mode=String(state.mode || sp.mode || 'off').toLowerCase();
    var temp=[v.temp_room,v.zone_1_temp,v.temp,state.temp_room,state.zone_1_temp,state.temp].find(function(x){ return x!==undefined&&x!==null&&x!==''; });
    temp=temp!=null&&Number.isFinite(Number(temp))?Number(temp):null;
    var setpoint=[sp.setpoint,sp.zone_1_setpoint,state.setpoint].find(function(x){ return x!==undefined&&x!==null&&x!==''; });
    setpoint=setpoint!=null&&Number.isFinite(Number(setpoint))?Number(setpoint):21;
    var manualActive=!!state.manual_active || /manual/i.test(lastReason);
    var demand=!!state.heating_on || !!state.cooling_on || !!state.call_active || state.output_on===true || /calling|heat|cool/i.test(lastReason);
    var callingZones=Number(state.calling_zones||sp._central_calling_zones||0)||0;
    var configuredZones=Number(state.configured_zones||sp._central_configured_zones||0)||0;
    var diCalling=Number(state.di_calling||sp._central_di_calling||0)||0;
    var tempCalling=Number(state.temp_calling||sp._central_temp_calling||0)||0;
    var callActive=state.call_active!=null?!!state.call_active:null;
    return { v:v,state:state,sp:sp,lastReason:lastReason,mode:mode,temp:temp,setpoint:setpoint,manualActive:manualActive,demand:demand,callingZones:callingZones,configuredZones:configuredZones,diCalling:diCalling,tempCalling:tempCalling,callActive:callActive };
  }
  function zoneCards(inst, x){
    var cards=''; var moduleId=String(inst.module_id||'');
    for(var n=1;n<=6;n++){
      var name=String(x.sp['zone_'+n+'_name']||x.sp['_zone_'+n+'_name']||'').trim();
      var reason=String(x.sp['_zone_'+n+'_reason']||'').trim();
      var status=String(x.sp['_zone_'+n+'_status']||'').trim();
      var source=String(x.sp['_zone_'+n+'_source']||'').trim();
      var fromSched=x.sp['_zone_'+n+'_from_schedule']==='1';
      var zt=[x.v['zone_'+n+'_temp'],x.state['zone_'+n+'_temp']].find(function(vv){ return vv!==undefined&&vv!==null&&vv!==''; });
      zt=zt!=null&&Number.isFinite(Number(zt))?Number(zt):null;
      var zsp=x.sp['_zone_'+n+'_setpoint']||x.sp['zone_'+n+'_setpoint'];
      zsp=(zsp!=null&&zsp!==''&&Number.isFinite(Number(zsp)))?Number(zsp):null;
      if(!status) continue;
      if(!name) name='Zone '+n;
      var isOnZone=status==='on';
      var srcBadge='';
      if(source==='call') srcBadge=badge('DI','#1d8cff','rgba(29,140,255,.3)');
      else if(source==='temp') srcBadge=badge('Temp','#22d97a','rgba(34,217,122,.3)');
      if(fromSched) srcBadge+=badge('Schedule','#a855f7','rgba(168,85,247,.3)');
      var instId=inst.id;
      cards+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px">';
      cards+='<div style="display:flex;justify-content:space-between;gap:6px;align-items:center">';
      cards+='<div style="display:flex;align-items:center;gap:5px;min-width:0">';
      cards+='<div style="font-size:11px;font-weight:900;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="zt-name-'+instId+'-'+n+'">'+esc(name)+'</div>';
      cards+='<button onclick="zoneThermoRename(\''+moduleId+'\','+instId+','+n+')" style="background:none;border:none;color:var(--muted2);cursor:pointer;padding:0 2px;font-size:10px;line-height:1" title="Rename">✏️</button>';
      cards+='</div>';
      cards+='<div style="font-size:10px;font-weight:800;color:'+(isOnZone?'#22d97a':'var(--muted2)')+';white-space:nowrap">'+(status?status.toUpperCase():('Z'+n))+'</div>';
      cards+='</div>';
      var effectiveSp=zsp!=null?zsp:(x.setpoint!=null?x.setpoint:21);
      var isGlobalSp=zsp==null;
      cards+='<div style="margin-top:6px;display:flex;justify-content:space-between;gap:8px">';
      cards+='<div><div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Room</div><div style="font-size:14px;font-weight:900;color:var(--text)">'+(zt!=null?esc(zt.toFixed(1)+'°'):'—')+'</div></div>';
      if(source!=='call'){
        var spM=Math.round((effectiveSp-0.5)*10)/10, spP=Math.round((effectiveSp+0.5)*10)/10;
        var spKey='zone_'+n+'_setpoint';
        cards+='<div style="text-align:right">';
        cards+='<div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Setpoint'+(isGlobalSp?' <span style="font-size:9px;opacity:.6">(global)</span>':'')+'</div>';
        cards+='<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;margin-top:2px">';
        cards+='<button onclick="var p={};p[\''+spKey+'\']='+spM+';thermoControl(\''+moduleId+'\','+instId+',p)" style="padding:2px 7px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">−</button>';
        cards+='<span style="font-size:14px;font-weight:900;color:#f5c842;min-width:34px;text-align:center">'+esc(effectiveSp.toFixed(1)+'°')+'</span>';
        cards+='<button onclick="var p={};p[\''+spKey+'\']='+spP+';thermoControl(\''+moduleId+'\','+instId+',p)" style="padding:2px 7px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">+</button>';
        cards+='</div></div>';
      }
      cards+='</div>';
      if(srcBadge||reason){ cards+='<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">'+srcBadge; if(reason) cards+='<span style="font-size:10px;color:var(--muted2)">'+esc(reason.length>32?(reason.slice(0,32)+'…'):reason)+'</span>'; cards+='</div>'; }
      cards+='</div>';
    }
    return cards;
  }
  function modeBtn(inst, activeMode, mode, label, color, bg, border){ var active=activeMode===mode; return '<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{mode:\''+mode+'\'})" style="width:100%;padding:9px 12px;border-radius:16px;border:1px solid '+(active?border:'var(--line2)')+';background:'+(active?bg:'rgba(255,255,255,.05)')+';color:'+(active?color:'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+label+'</button>'; }
  async function renderThermoFamily(inst){ var st={}; try{ st=await api('/automation/status/'+inst.id); }catch(e){}
    var x=computeThermoState(st), meta=thermoMeta(inst.module_id), paused=!!st.paused;
    var isZoned=meta.isZoned && x.configuredZones>0;
    var h='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(meta.label)+'</div>';
    h+='<div style="margin-top:4px;font-size:24px;font-weight:900;color:var(--text)">'+(x.temp!=null?esc(x.temp.toFixed(1)+'°'):'—')+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(x.lastReason.length>52?(x.lastReason.slice(0,52)+'…'):x.lastReason)+'</div></div>';
    h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">'+modeBtn(inst,x.mode,'heating','🔥 Heat','#f5c842','rgba(245,200,66,.14)','rgba(245,200,66,.45)')+modeBtn(inst,x.mode,'cooling','❄ Cool','#1d8cff','rgba(29,140,255,.14)','rgba(29,140,255,.45)')+modeBtn(inst,x.mode,'off','⏻ Off','#f59e0b','rgba(245,158,11,.12)','rgba(245,158,11,.4)')+'</div>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">'+badge(x.mode==='heating'?'Heating':x.mode==='cooling'?'Cooling':'Off',x.mode==='heating'?'#f5c842':x.mode==='cooling'?'#1d8cff':'#f59e0b',x.mode==='heating'?'rgba(245,200,66,.35)':x.mode==='cooling'?'rgba(29,140,255,.35)':'rgba(245,158,11,.35)')+badge(x.demand?'Demand ON':'Idle',x.demand?'#22d97a':'var(--muted2)',x.demand?'rgba(34,217,122,.35)':'var(--line)')+(x.manualActive?badge('Manual','#f59e0b','rgba(245,158,11,.35)'):'')+'</div>';
    h+='<div style="display:grid;grid-template-columns:'+(meta.hasSetpoint?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))')+';gap:8px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Mode</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:var(--text)">'+esc(x.mode.charAt(0).toUpperCase()+x.mode.slice(1))+'</div></div>';
    if(isZoned){
      var zct=x.callingZones+' / '+x.configuredZones;
      var zcsub=x.diCalling>0&&x.tempCalling>0?x.diCalling+' DI · '+x.tempCalling+' temp':x.diCalling>0?x.diCalling+' via DI':x.tempCalling>0?x.tempCalling+' via temp':'';
      h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Zones calling</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:'+(x.callingZones>0?'#22d97a':'var(--text)')+'">'+esc(zct)+'</div>'+(zcsub?'<div style="font-size:10px;color:var(--muted2);margin-top:2px">'+esc(zcsub)+'</div>':'')+'</div>';
    } else if(inst.module_id==='call_thermostat'){
      var callTxt=x.callActive===true?'Calling':x.callActive===false?'Idle':'—';
      var callColor=x.callActive===true?'#22d97a':x.callActive===false?'var(--muted2)':'var(--muted2)';
      h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">DI Call</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:'+callColor+'">'+esc(callTxt)+'</div></div>';
    } else {
      h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Room</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:var(--text)">'+(x.temp!=null?esc(x.temp.toFixed(1)+'°'):'—')+'</div></div>';
    }
    if(meta.hasSetpoint) h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Setpoint</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:#f5c842">'+(x.setpoint!=null?esc(x.setpoint.toFixed(1)+'°'):'—')+'</div></div>';
    h+='</div>';
    if(meta.hasSetpoint){
      var dpMinus=meta.isZoned?'{setpoint_delta:-0.5}':'{setpoint:'+(Math.round((x.setpoint-0.5)*10)/10)+'}';
      var dpPlus =meta.isZoned?'{setpoint_delta:0.5}' :'{setpoint:'+(Math.round((x.setpoint+0.5)*10)/10)+'}';
      var spLabel=meta.isZoned?'Global − 0.5°':'− 0.5°';
      var spLabelP=meta.isZoned?'Global + 0.5°':'+ 0.5°';
      h+='<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+','+dpMinus+')" style="padding:8px 12px;border-radius:12px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">'+spLabel+'</button>';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+','+dpPlus+')" style="padding:8px 12px;border-radius:12px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">'+spLabelP+'</button>';
      if(meta.isZoned) h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{all_zones_setpoint:'+(Math.round(x.setpoint*10)/10)+'})" style="padding:8px 12px;border-radius:12px;border:1px solid rgba(245,200,66,.35);background:rgba(245,200,66,.10);color:#f5c842;font-size:12px;font-weight:800;cursor:pointer">Apply global to all zones</button>';
      if(x.manualActive) h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{clear_manual:true})" style="padding:8px 12px;border-radius:12px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
      h+='</div>';
    }
    if(meta.isZoned){ var zc=zoneCards(inst,x); if(zc) h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">'+zc+'</div>'; }
    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+paused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>';
    return h;
  }
  window.zoneThermoRename = function(moduleId, instId, zoneN){
    var nameEl=document.getElementById('zt-name-'+instId+'-'+zoneN);
    if(!nameEl || nameEl.querySelector('input')) return;
    var cur=nameEl.textContent;
    var inp=document.createElement('input');
    inp.value=cur;
    inp.style.cssText='width:100%;font-size:11px;font-weight:900;background:rgba(255,255,255,.08);border:1px solid var(--line2);border-radius:6px;padding:2px 5px;color:var(--text);outline:none';
    nameEl.textContent='';
    nameEl.appendChild(inp);
    inp.focus(); inp.select();
    function save(){
      var val=inp.value.trim();
      nameEl.textContent=val||('Zone '+zoneN);
      if(val!==cur){ var p={}; p['zone_'+zoneN+'_name']=val; thermoControl(moduleId,instId,p); }
    }
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();save();} if(e.key==='Escape'){nameEl.textContent=cur;} });
    inp.addEventListener('blur',save);
  };
  window.MODULE_ACCENT=window.MODULE_ACCENT||{}; window.MODULE_ICON=window.MODULE_ICON||{};
  ['basic_thermostat','call_thermostat','zoned_thermostat','thermostat'].forEach(function(id){ window.MODULE_ACCENT[id]='#1d8cff'; window.MODULE_ICON[id]='🌡️'; });
  var prevRender=window.renderInstance; if(typeof prevRender!=='function') return;
  window.renderInstance=async function(inst){ if(!inst||!THERMO_FAMILY_IDS.has(String(inst.module_id||''))) return prevRender(inst); var grid=document.getElementById('pageGrid'); if(!grid) return; var cardId='inst-card-'+inst.id, card=document.getElementById(cardId), isNew=!card; if(isNew){ card=document.createElement('div'); card.id=cardId; card.className='inst-card'; card.style.setProperty('--inst-accent','#1d8cff'); grid.appendChild(card); } card.classList.remove('wide-card'); card.classList.remove('thermo-card'); if(isNew){ card.innerHTML='<div class="inst-header"><div class="inst-name">🌡️ '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>'; } var body=document.getElementById('inst-body-'+inst.id); if(body){ try{ body.innerHTML=await renderThermoFamily(inst); } catch(e){ body.innerHTML='<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; } } };
  window.thermoControl=thermoControl;
})();
