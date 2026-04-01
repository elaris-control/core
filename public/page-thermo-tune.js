(function(){
  var THERMO_FAMILY_IDS = new Set(['basic_thermostat','call_thermostat','zoned_thermostat']);

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function badge(txt, color, border){
    return '<span class="pill" style="display:inline-flex;align-items:center;white-space:nowrap;font-size:10px;padding:4px 10px;color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+esc(txt)+'</span>';
  }
  function thermoMeta(moduleId){
    switch(String(moduleId||'')){
      case 'basic_thermostat': return { label:'Basic Thermostat', hasSetpoint:true };
      case 'call_thermostat': return { label:'Call Thermostat', hasSetpoint:false };
      case 'zoned_thermostat': return { label:'Zoned Thermostat', hasSetpoint:true };
      default: return { label:'Thermostat', hasSetpoint:true };
    }
  }
  function thermoControl(moduleId,id,payload){
    return api('/automation/'+moduleId+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)})
      .catch(function(){ toast('Cannot control '+moduleId); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(id); }, 220); });
  }
  function computeThermoState(st){
    var v=st.values||{}, state=st.state||{}, sp=st.settings||{};
    var lastReason=String(state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action');
    var mode=String(state.mode || sp.mode || 'off').toLowerCase();
    var temp = [v.temp_room, v.zone_1_temp, v.temp, state.temp_room, state.zone_1_temp, state.temp].find(function(x){ return x!==undefined && x!==null && x!==''; });
    temp = temp!=null && Number.isFinite(Number(temp)) ? Number(temp) : null;
    var setpoint = [sp.setpoint, sp.zone_1_setpoint, state.setpoint].find(function(x){ return x!==undefined && x!==null && x!==''; });
    setpoint = setpoint!=null && Number.isFinite(Number(setpoint)) ? Number(setpoint) : null;
    var manualActive = !!state.manual_active || /manual/i.test(lastReason);
    var demand = !!state.heating_on || !!state.cooling_on || !!state.call_active || /calling|heat|cool/i.test(lastReason);
    return { v:v, state:state, sp:sp, lastReason:lastReason, mode:mode, temp:temp, setpoint:setpoint, manualActive:manualActive, demand:demand };
  }
  function zoneCards(x){
    var cards='';
    for (var n=1;n<=6;n++) {
      var name=String(x.sp['zone_'+n+'_name']||'').trim();
      if(!name) continue;
      var zt=[x.v['zone_'+n+'_temp'], x.state['zone_'+n+'_temp']].find(function(v){ return v!==undefined && v!==null && v!==''; });
      zt = zt!=null && Number.isFinite(Number(zt)) ? Number(zt) : null;
      var zsp=x.sp['zone_'+n+'_setpoint'];
      zsp = zsp!=null && zsp!=='' && Number.isFinite(Number(zsp)) ? Number(zsp) : null;
      cards += '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px;min-height:78px">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
        + '<div style="font-size:11px;font-weight:900;color:var(--text)">'+esc(name)+'</div>'
        + '<div style="font-size:10px;color:var(--muted2)">Z'+n+'</div>'
        + '</div>'
        + '<div style="margin-top:8px;display:flex;justify-content:space-between;gap:8px">'
        + '<div><div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Room</div><div style="font-size:14px;font-weight:900;color:var(--text)">'+(zt!=null?esc(zt.toFixed(1)+'°'):'—')+'</div></div>'
        + '<div style="text-align:right"><div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Setpoint</div><div style="font-size:14px;font-weight:900;color:#f5c842">'+(zsp!=null?esc(zsp.toFixed(1)+'°'):'—')+'</div></div>'
        + '</div></div>';
    }
    return cards;
  }
  async function renderThermoFamily(inst){
    var st={};
    try{ st=await api('/automation/status/'+inst.id); }catch(e){}
    var x=computeThermoState(st), meta=thermoMeta(inst.module_id), paused=!!st.paused;
    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(meta.label)+'</div>';
    h+='<div style="margin-top:4px;font-size:24px;font-weight:900;color:var(--text)">'+(x.temp!=null?esc(x.temp.toFixed(1)+'°'):'—')+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(x.lastReason.length>52?(x.lastReason.slice(0,52)+'…'):x.lastReason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    function modeBtn(mode,label,color,bg,border){
      var active=x.mode===mode;
      return '<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{mode:\''+mode+'\'})" style="min-width:52px;padding:8px 10px;border-radius:15px;border:1px solid '+(active?border:'var(--line2)')+';background:'+(active?bg:'rgba(255,255,255,.05)')+';color:'+(active?color:'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+label+'</button>';
    }
    h+=modeBtn('heating','Heat','#f5c842','rgba(245,200,66,.14)','rgba(245,200,66,.45)');
    h+=modeBtn('cooling','Cool','#1d8cff','rgba(29,140,255,.14)','rgba(29,140,255,.45)');
    h+=modeBtn('off','Off','#f59e0b','rgba(245,158,11,.12)','rgba(245,158,11,.4)');
    h+='</div></div>';

    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">';
    h+=badge(x.mode==='heating'?'Heating':x.mode==='cooling'?'Cooling':'Off', x.mode==='heating'?'#f5c842':x.mode==='cooling'?'#1d8cff':'#f59e0b', x.mode==='heating'?'rgba(245,200,66,.35)':x.mode==='cooling'?'rgba(29,140,255,.35)':'rgba(245,158,11,.35)');
    h+=badge(x.demand?'Demand ON':'Idle', x.demand?'#22d97a':'var(--muted2)', x.demand?'rgba(34,217,122,.35)':'var(--line)');
    if(x.manualActive) h+=badge('Manual','#f59e0b','rgba(245,158,11,.35)');
    h+='</div>';

    h+='<div style="display:grid;grid-template-columns:'+(meta.hasSetpoint?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))')+';gap:8px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Mode</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:var(--text)">'+esc(x.mode.charAt(0).toUpperCase()+x.mode.slice(1))+'</div></div>';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Room</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:var(--text)">'+(x.temp!=null?esc(x.temp.toFixed(1)+'°'):'—')+'</div></div>';
    if(meta.hasSetpoint) h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Setpoint</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:#f5c842">'+(x.setpoint!=null?esc(x.setpoint.toFixed(1)+'°'):'—')+'</div></div>';
    h+='</div>';

    if(meta.hasSetpoint && x.setpoint!=null){
      h+='<div style="display:flex;gap:8px;justify-content:flex-end">';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{setpoint:'+(Math.round((x.setpoint-0.5)*10)/10)+'})" style="padding:8px 12px;border-radius:12px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">− 0.5°</button>';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{setpoint:'+(Math.round((x.setpoint+0.5)*10)/10)+'})" style="padding:8px 12px;border-radius:12px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">+ 0.5°</button>';
      h+='</div>';
    }

    if(inst.module_id==='zoned_thermostat'){
      var zones = zoneCards(x);
      if(zones) h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">'+zones+'</div>';
    }

    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+paused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>';
    return h;
  }

  var prevRender = window.renderInstance;
  if (typeof prevRender !== 'function') return;
  window.renderInstance = async function(inst){
    if (!inst || !THERMO_FAMILY_IDS.has(String(inst.module_id||''))) return prevRender(inst);
    var grid=document.getElementById('pageGrid'); if(!grid) return;
    var cardId='inst-card-'+inst.id, card=document.getElementById(cardId), isNew=!card;
    if(isNew){
      card=document.createElement('div');
      card.id=cardId;
      card.className='inst-card';
      card.style.setProperty('--inst-accent','#1d8cff');
      grid.appendChild(card);
    }
    card.classList.remove('wide-card');
    card.classList.remove('thermo-card');
    if(isNew){
      card.innerHTML='<div class="inst-header"><div class="inst-name">🌡️ '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>';
    }
    var body=document.getElementById('inst-body-'+inst.id);
    if(body){
      try{ body.innerHTML = await renderThermoFamily(inst); }
      catch(e){ body.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; }
    }
  };

  window.thermoControl = thermoControl;
})();
