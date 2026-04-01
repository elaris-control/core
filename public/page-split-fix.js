(function(){
  var LIGHTING_IDS = new Set([
    'lighting','basic_light','motion_light','daylight_light','scheduled_light','motion_daylight','scheduled_motion'
  ]);
  var THERMO_FAMILY_IDS = new Set([
    'basic_thermostat','call_thermostat','zoned_thermostat'
  ]);
  var LIGHT_CHIP_ROW = 'display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;padding-bottom:2px';
  var INTERLOCKED_CHIP_ROW = 'display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;padding-bottom:2px;scrollbar-width:none';

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function normalizeModuleId(id){ return String(id||''); }
  function isOn(v){ return v==='ON' || v==='1' || v===1 || v===true || v==='true'; }
  function badge(txt, color, border){ return '<span class="pill" style="display:inline-flex;align-items:center;white-space:nowrap;font-size:10px;padding:4px 10px;color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+esc(txt)+'</span>'; }

  function splitLightingMeta(moduleId){
    switch(String(moduleId||'')){
      case 'lighting': return { label:'Lighting', chips:['Auto','PIR','Lux','Combined','Schedule','Manual'] };
      case 'basic_light': return { label:'Basic Light', chips:['Auto','Manual'] };
      case 'motion_light': return { label:'Motion Light', chips:['PIR','Manual'] };
      case 'daylight_light': return { label:'Daylight Light', chips:['Lux','Manual'] };
      case 'scheduled_light': return { label:'Scheduled Light', chips:['Schedule','Manual'] };
      case 'motion_daylight': return { label:'Motion + Daylight', chips:['PIR','Lux','Combined','Manual'] };
      case 'scheduled_motion': return { label:'Scheduled + Motion', chips:['Schedule','PIR','Manual'] };
      default: return { label:'Lighting', chips:['Auto','Manual'] };
    }
  }
  function thermoMeta(moduleId){
    switch(String(moduleId||'')){
      case 'basic_thermostat': return { label:'Basic Thermostat', hasSetpoint:true };
      case 'call_thermostat': return { label:'Call Thermostat', hasSetpoint:false };
      case 'zoned_thermostat': return { label:'Zoned Thermostat', hasSetpoint:true };
      default: return { label:'Thermostat', hasSetpoint:true };
    }
  }
  function mappedRelayKeys(inst){
    var mappings = Array.isArray(inst && inst.mappings) ? inst.mappings : [];
    return mappings.map(function(m){ return m && m.input_key; }).filter(function(k){ return /^light_relay(_\d+)?$/.test(String(k||'')); });
  }
  function computeSplitLightingState(inst, st){
    var v=st.values||{}, state=st.state||{}, sp=st.settings||{};
    var lux=v.lux_sensor!=null?Number(v.lux_sensor).toFixed(0):null;
    var pir=v.pir_sensor;
    var motion=pir==='ON'||pir==='1'||pir==='true'||pir===1||pir===true || !!state.motion_active;
    var motionAI=v.motion_ai!=null?Number(v.motion_ai).toFixed(0):null;
    var dimVal=v.dimmer_output!=null?Math.round(Number(v.dimmer_output)):(state.dimmer_level!=null?Math.round(Number(state.dimmer_level)):null);
    var hasDimmer=dimVal!==null || (inst.mappings||[]).some(function(m){ return m.input_key==='dimmer_output'; });
    var relayKeys=mappedRelayKeys(inst);
    var relayOn=relayKeys.some(function(k){ return isOn(v[k]); }) || isOn(v.light_relay);
    var outputOn = (typeof state.output_on === 'boolean') ? state.output_on : (hasDimmer ? (Number(dimVal||0)>(Number(sp.dim_off_level||0)+5)) : relayOn);
    var lastReason=String(state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action');
    var manualActive = !!state.manual_active || /manual/i.test(lastReason);
    var scheduleActive = !!state.schedule_active || /schedule/i.test(lastReason);
    var dark=(state.dark===true || (lux!==null && sp.lux_threshold && Number(lux)<Number(sp.lux_threshold)) || /dark/i.test(lastReason));
    var source=String(state.source||'').toLowerCase();
    if(!source || source==='idle'){
      if(manualActive) source='manual';
      else if(scheduleActive) source='schedule';
      else if(motion && dark) source='combined';
      else if(motion) source='pir';
      else if(dark) source='lux';
      else if(String(inst.module_id)==='scheduled_motion') source='schedule';
      else source='idle';
    }
    return { v:v,state:state,sp:sp,lux:lux,motion:motion,motionAI:motionAI,dimVal:dimVal,hasDimmer:hasDimmer,outputOn:!!outputOn,lastReason:lastReason,manualActive:manualActive,scheduleActive:scheduleActive,dark:dark,source:source };
  }
  function computeThermoState(inst, st){
    var v=st.values||{}, state=st.state||{}, sp=st.settings||{};
    var lastReason=String(state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action');
    var mode=String(state.mode || sp.mode || 'off').toLowerCase();
    var temp = [v.temp_room, v.zone_1_temp, v.temp, state.temp_room, state.zone_1_temp, state.temp].find(function(x){ return x!==undefined && x!==null && x!==''; });
    temp = temp!=null && Number.isFinite(Number(temp)) ? Number(temp) : null;
    var setpoint = [sp.setpoint, sp.zone_1_setpoint, state.setpoint].find(function(x){ return x!==undefined && x!==null && x!==''; });
    setpoint = setpoint!=null && Number.isFinite(Number(setpoint)) ? Number(setpoint) : null;
    var manualActive = !!state.manual_active || /manual/i.test(lastReason);
    var demand = !!state.heating_on || !!state.cooling_on || !!state.call_active || /calling|heat|cool/i.test(lastReason);
    var zoneCount = [1,2,3,4,5,6].filter(function(n){ return String(sp['zone_'+n+'_name']||'').trim(); }).length;
    return { v:v,state:state,sp:sp,lastReason:lastReason,mode:mode,temp:temp,setpoint:setpoint,manualActive:manualActive,demand:demand,zoneCount:zoneCount };
  }

  async function splitLightManual(moduleId, id, on){ try{ await api('/automation/'+moduleId+'/'+id+'/manual',{method:'POST',body:JSON.stringify({on:!!on})}); } catch(e){ toast('Cannot control '+moduleId); } setTimeout(function(){ rerenderInstance(id); }, 220); }
  async function splitLightClearManual(moduleId, id){ try{ await api('/automation/'+moduleId+'/'+id+'/clear-manual',{method:'POST'}); } catch(e){ toast('Cannot clear manual override'); } setTimeout(function(){ rerenderInstance(id); }, 220); }
  async function thermoControl(moduleId,id,payload){ try{ await api('/automation/'+moduleId+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)}); } catch(e){ toast('Cannot control '+moduleId); } setTimeout(function(){ rerenderInstance(id); }, 220); }

  async function renderSplitLighting(inst){
    var st={}; try{ st=await api('/automation/status/'+inst.id); }catch(e){}
    var meta=splitLightingMeta(inst.module_id), x=computeSplitLightingState(inst, st), isPaused=!!st.paused;
    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(meta.label)+'</div>';
    h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(x.outputOn?'#f5c842':'var(--muted2)')+'">'+(x.hasDimmer?(x.dimVal!=null?x.dimVal:0)+'%':(x.outputOn?'ON':'OFF'))+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(x.lastReason.length>46?(x.lastReason.slice(0,46)+'…'):x.lastReason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h+='<button onclick="splitLightManual(\''+inst.module_id+'\','+inst.id+','+(!x.outputOn)+')" style="padding:9px 14px;border-radius:10px;border:1px solid '+(x.outputOn?'rgba(245,200,66,.5)':'var(--line2)')+';background:'+(x.outputOn?'rgba(245,200,66,.15)':'rgba(255,255,255,.05)')+';color:'+(x.outputOn?'#f5c842':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(x.outputOn?'Turn OFF':'Turn ON')+'</button>';
    if(x.manualActive) h+='<button onclick="splitLightClearManual(\''+inst.module_id+'\','+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h+='</div></div>';
    h+='<div style="'+LIGHT_CHIP_ROW+'">';
    meta.chips.forEach(function(txt){ var key=String(txt).toLowerCase(); var active=(key==='auto'&&(x.source==='auto'||x.source==='idle'))||(key==='manual'&&x.manualActive)||(key==='pir'&&(x.motion||x.source==='pir'))||(key==='lux'&&(x.source==='lux'||x.dark))||(key==='combined'&&(x.source==='combined'))||(key==='schedule'&&(x.source==='schedule'||x.scheduleActive)); h+=badge(txt, active?(key==='lux'?'#f5c842':key==='schedule'?'#a855f7':'#22d97a'):'var(--muted2)', active?(key==='lux'?'rgba(245,200,66,.35)':key==='schedule'?'rgba(168,85,247,.35)':'rgba(34,217,122,.35)'):'var(--line)'); });
    if(x.dark) h+=badge('Dark','#f5c842','rgba(245,200,66,.35)'); h+=badge(x.outputOn?'Light ON':'Light OFF', x.outputOn?'#22d97a':'var(--muted2)', x.outputOn?'rgba(34,217,122,.35)':'var(--line)');
    h+='</div>';
    h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Source</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:var(--text)">'+esc(x.source.charAt(0).toUpperCase()+x.source.slice(1))+'</div></div>';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Motion</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(x.motion?'#22d97a':'var(--text)')+'">'+(x.motion?'Detected':'Idle')+'</div></div>';
    var luxTxt = x.lux!==null ? (x.lux+' lux') : (x.motionAI!==null ? ('AI '+x.motionAI) : '—');
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Lux / AI</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(x.dark?'#f5c842':'var(--text)')+'">'+esc(luxTxt)+'</div></div>';
    h+='</div>';
    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>'; return h;
  }

  async function renderSplitThermostat(inst){
    var st={}; try{ st=await api('/automation/status/'+inst.id); }catch(e){}
    var meta=thermoMeta(inst.module_id), x=computeThermoState(inst, st), isPaused=!!st.paused;
    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(meta.label)+'</div>';
    h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:var(--text)">'+(x.temp!=null?x.temp.toFixed(1)+'°':'—')+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(x.lastReason.length>50?(x.lastReason.slice(0,50)+'…'):x.lastReason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{mode:\'heating\'})" style="padding:8px 10px;border-radius:10px;border:1px solid '+(x.mode==='heating'?'rgba(245,200,66,.45)':'var(--line2)')+';background:'+(x.mode==='heating'?'rgba(245,200,66,.14)':'rgba(255,255,255,.05)')+';color:'+(x.mode==='heating'?'#f5c842':'var(--text)')+';font-size:11px;font-weight:800;cursor:pointer">Heat</button>';
    h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{mode:\'cooling\'})" style="padding:8px 10px;border-radius:10px;border:1px solid '+(x.mode==='cooling'?'rgba(29,140,255,.45)':'var(--line2)')+';background:'+(x.mode==='cooling'?'rgba(29,140,255,.14)':'rgba(255,255,255,.05)')+';color:'+(x.mode==='cooling'?'#1d8cff':'var(--text)')+';font-size:11px;font-weight:800;cursor:pointer">Cool</button>';
    h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{mode:\'off\'})" style="padding:8px 10px;border-radius:10px;border:1px solid '+(x.mode==='off'?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(x.mode==='off'?'rgba(245,158,11,.12)':'rgba(255,255,255,.05)')+';color:'+(x.mode==='off'?'#f59e0b':'var(--text)')+';font-size:11px;font-weight:800;cursor:pointer">Off</button>';
    if(x.manualActive) h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{clear_manual:true})" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:11px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h+='</div></div>';
    h+='<div style="'+LIGHT_CHIP_ROW+'">';
    h+=badge(x.mode==='heating'?'Heating':x.mode==='cooling'?'Cooling':'Off', x.mode==='heating'?'#f5c842':x.mode==='cooling'?'#1d8cff':'#f59e0b', x.mode==='heating'?'rgba(245,200,66,.35)':x.mode==='cooling'?'rgba(29,140,255,.35)':'rgba(245,158,11,.35)');
    if(x.manualActive) h+=badge('Manual','#f59e0b','rgba(245,158,11,.35)');
    if(x.demand) h+=badge('Demand ON','#22d97a','rgba(34,217,122,.35)'); else h+=badge('Idle','var(--muted2)','var(--line)');
    if(x.zoneCount>1) h+=badge('zones '+x.zoneCount,'var(--muted2)','var(--line)');
    h+='</div>';
    h+='<div style="display:grid;grid-template-columns:'+(meta.hasSetpoint?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))')+';gap:6px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Mode</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:var(--text)">'+esc(x.mode.charAt(0).toUpperCase()+x.mode.slice(1))+'</div></div>';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Room</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:var(--text)">'+(x.temp!=null?esc(x.temp.toFixed(1)+'°'):'—')+'</div></div>';
    if(meta.hasSetpoint) h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Setpoint</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:#f5c842">'+(x.setpoint!=null?esc(x.setpoint.toFixed(1)+'°'):'—')+'</div></div>';
    h+='</div>';
    if(meta.hasSetpoint && x.setpoint!=null){
      h+='<div style="display:flex;gap:8px;justify-content:flex-end">';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{setpoint:'+(Math.round((x.setpoint-0.5)*10)/10)+'})" style="padding:8px 10px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">− 0.5°</button>';
      h+='<button onclick="thermoControl(\''+inst.module_id+'\','+inst.id+',{setpoint:'+(Math.round((x.setpoint+0.5)*10)/10)+'})" style="padding:8px 10px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">+ 0.5°</button>';
      h+='</div>';
    }
    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>'; return h;
  }

  async function interlockedManual(id, on){ try{ await api('/automation/interlocked_switches/'+id+'/manual',{method:'POST',body:JSON.stringify({on:!!on})}); } catch(e){ toast('Cannot control interlocked switches'); } setTimeout(function(){ rerenderInstance(id); }, 220); }
  async function interlockedClearManual(id){ try{ await api('/automation/interlocked_switches/'+id+'/clear-manual',{method:'POST'}); } catch(e){ toast('Cannot clear manual override'); } setTimeout(function(){ rerenderInstance(id); }, 220); }
  async function renderInterlockedSwitches(inst){
    var d={}; try{ d=await api('/automation/status/'+inst.id); }catch(e){}
    var state=d.state||{}, values=d.values||{}, settings=d.settings||{}, paused=!!d.paused, mappings=Array.isArray(inst.mappings)?inst.mappings:[];
    var controlType=String(settings.control_type || 'button'), reason=String(state.last_reason || 'Interlocked switch logic active');
    var outputOn=(typeof state.output_on==='boolean') ? state.output_on : ['light_relay','light_relay_2','light_relay_3','light_relay_4'].some(function(k){ return isOn(values[k]); });
    var manualActive=!!state.manual_active || /manual/i.test(reason);
    var inputKeys=['switch_di','switch_di_2','switch_di_3','switch_di_4','switch_di_5','switch_di_6'], outputKeys=['light_relay','light_relay_2','light_relay_3','light_relay_4'];
    var inputs=inputKeys.filter(function(k){ return mappings.some(function(m){ return m.input_key===k && m.io_id; }); }).map(function(k){ return { key:k, on:isOn(values[k]) }; });
    var outputs=outputKeys.filter(function(k){ return mappings.some(function(m){ return m.input_key===k && m.io_id; }); }).map(function(k){ return { key:k, on:isOn(values[k]) }; });
    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Interlocked Switches</div><div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(outputOn?'#22d97a':'var(--muted2)')+'">'+(outputOn?'ON':'OFF')+'</div><div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(reason.length>56?(reason.slice(0,56)+'…'):reason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><button onclick="interlockedManual('+inst.id+','+(!outputOn)+')" style="padding:9px 14px;border-radius:10px;border:1px solid '+(outputOn?'rgba(245,200,66,.5)':'var(--line2)')+';background:'+(outputOn?'rgba(245,200,66,.15)':'rgba(255,255,255,.05)')+';color:'+(outputOn?'#f5c842':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(outputOn?'Turn OFF':'Turn ON')+'</button>'+(manualActive?'<button onclick="interlockedClearManual('+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>':'')+'</div></div>';
    h+='<div style="'+INTERLOCKED_CHIP_ROW+'">'+badge(controlType==='button'?'Button mode':'Switch mode','#1d8cff','rgba(29,140,255,.28)')+badge('inputs '+inputs.length,'var(--muted2)','var(--line)')+badge('outputs '+outputs.length,'var(--muted2)','var(--line)')+(manualActive?badge('manual','#f59e0b','rgba(245,158,11,.35)'):'')+badge(outputOn?'light on':'light off', outputOn?'#22d97a':'var(--muted2)', outputOn?'rgba(34,217,122,.35)':'var(--line)')+'</div>';
    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Switch Inputs</div>'+(inputs.length?inputs.map(function(x){ return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--line)"><span style="font-size:11px">'+esc(x.key.replace('switch_','SW '))+'</span><span style="font-size:10px;font-weight:800;color:'+(x.on?'#22d97a':'var(--muted2)')+'">'+(x.on?'ON':'OFF')+'</span></div>'; }).join(''):'<div style="font-size:11px;color:var(--muted2)">No switch inputs mapped</div>')+'</div>';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Light Outputs</div>'+(outputs.length?outputs.map(function(x){ return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--line)"><span style="font-size:11px">'+esc(x.key.replace('light_','').replace(/_/g,' ').toUpperCase())+'</span><span style="font-size:10px;font-weight:800;color:'+(x.on?'#22d97a':'var(--muted2)')+'">'+(x.on?'ON':'OFF')+'</span></div>'; }).join(''):'<div style="font-size:11px;color:var(--muted2)">No light outputs mapped</div>')+'</div>';
    h+='</div>';
    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+paused+')" style="width:100%;margin-top:4px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>'; return h;
  }

  window.MODULE_ACCENT = window.MODULE_ACCENT || {}; window.MODULE_ICON = window.MODULE_ICON || {};
  ['lighting','basic_light','motion_light','daylight_light','scheduled_light','motion_daylight','scheduled_motion'].forEach(function(id){ window.MODULE_ACCENT[id]='#f5c842'; window.MODULE_ICON[id]='💡'; });
  ['basic_thermostat','call_thermostat','zoned_thermostat'].forEach(function(id){ window.MODULE_ACCENT[id]='#1d8cff'; window.MODULE_ICON[id]='🌡️'; }); window.MODULE_ACCENT.interlocked_switches='#22d97a'; window.MODULE_ICON.interlocked_switches='🔀';

  var origRenderInstance = window.renderInstance; if (typeof origRenderInstance !== 'function') return;
  window.renderInstance = async function(inst){
    if (!inst || !inst.module_id) return origRenderInstance(inst);
    if (inst.module_id === 'interlocked_switches') { var grid=document.getElementById('pageGrid'); if(!grid) return; var cardId='inst-card-'+inst.id; var card=document.getElementById(cardId); var isNew=!card; if(isNew){ card=document.createElement('div'); card.id=cardId; card.className='inst-card'; card.style.setProperty('--inst-accent','#22d97a'); grid.appendChild(card);} card.classList.remove('wide-card'); card.classList.remove('thermo-card'); if(isNew){ card.innerHTML='<div class="inst-header"><div class="inst-name">🔀 '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>'; } var body=document.getElementById('inst-body-'+inst.id); if(body){ try{ body.innerHTML = await renderInterlockedSwitches(inst); } catch(e){ body.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; } } return; }
    if (LIGHTING_IDS.has(inst.module_id)) { var grid2=document.getElementById('pageGrid'); if(!grid2) return; var cardId2='inst-card-'+inst.id; var card2=document.getElementById(cardId2); var isNew2=!card2; if(isNew2){ card2=document.createElement('div'); card2.id=cardId2; card2.className='inst-card'; card2.style.setProperty('--inst-accent','#f5c842'); grid2.appendChild(card2);} card2.classList.remove('wide-card'); card2.classList.remove('thermo-card'); if(isNew2){ card2.innerHTML='<div class="inst-header"><div class="inst-name">💡 '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>'; } var body2=document.getElementById('inst-body-'+inst.id); if(body2){ try{ body2.innerHTML = await renderSplitLighting(inst); } catch(e){ body2.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; } } return; }
    if (THERMO_FAMILY_IDS.has(inst.module_id)) { var grid3=document.getElementById('pageGrid'); if(!grid3) return; var cardId3='inst-card-'+inst.id; var card3=document.getElementById(cardId3); var isNew3=!card3; if(isNew3){ card3=document.createElement('div'); card3.id=cardId3; card3.className='inst-card thermo-card'; card3.style.setProperty('--inst-accent','#1d8cff'); grid3.appendChild(card3);} card3.classList.remove('wide-card'); card3.classList.add('thermo-card'); if(isNew3){ card3.innerHTML='<div class="inst-header"><div class="inst-name">🌡️ '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>'; } var body3=document.getElementById('inst-body-'+inst.id); if(body3){ try{ body3.innerHTML = await renderSplitThermostat(inst); } catch(e){ body3.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; } } return; }
    return origRenderInstance(inst);
  };

  window.splitLightManual = splitLightManual; window.splitLightClearManual = splitLightClearManual; window.interlockedManual = interlockedManual; window.interlockedClearManual = interlockedClearManual; window.thermoControl = thermoControl;
})();
