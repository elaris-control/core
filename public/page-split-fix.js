(function(){
  var LIGHTING_IDS = new Set([
    'basic_light','motion_light','daylight_light','scheduled_light','motion_daylight','scheduled_motion'
  ]);
  var THERMO_IDS = new Set([
    'basic_thermostat','call_thermostat','zoned_thermostat'
  ]);

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function normalizeModuleId(id){
    id = String(id||'');
    if (THERMO_IDS.has(id)) return 'thermostat';
    return id;
  }

  function isOn(v){
    return v==='ON' || v==='1' || v===1 || v===true || v==='true';
  }

  function badge(txt, color, border){
    return '<span class="pill" style="font-size:10px;color:'+(color||'var(--muted2)')+';border-color:'+(border||'var(--line)')+'">'+esc(txt)+'</span>';
  }

  function splitLightingMeta(moduleId){
    switch(String(moduleId||'')){
      case 'basic_light': return { label:'Basic Light', family:'basic', chips:['Auto','Manual'] };
      case 'motion_light': return { label:'Motion Light', family:'motion', chips:['PIR','Manual'] };
      case 'daylight_light': return { label:'Daylight Light', family:'daylight', chips:['Lux','Manual'] };
      case 'scheduled_light': return { label:'Scheduled Light', family:'schedule', chips:['Schedule','Manual'] };
      case 'motion_daylight': return { label:'Motion + Daylight', family:'combined', chips:['PIR','Lux','Combined','Manual'] };
      case 'scheduled_motion': return { label:'Scheduled + Motion', family:'scheduled_motion', chips:['Schedule','PIR','Manual'] };
      default: return { label:'Lighting', family:'basic', chips:['Auto','Manual'] };
    }
  }

  async function renderSplitLighting(inst){
    var st={};
    try{ st=await api('/automation/status/'+inst.id); }catch(e){}
    var v=st.values||{}, state=st.state||{}, sp=st.settings||{}, isPaused=!!st.paused;
    var meta=splitLightingMeta(inst.module_id);
    var lux=v.lux_sensor!=null?Number(v.lux_sensor).toFixed(0):null;
    var pir=v.pir_sensor;
    var motion=pir==='ON'||pir==='1'||pir==='true'||pir===1||pir===true;
    var motionAI=v.motion_ai!=null?Number(v.motion_ai).toFixed(0):null;
    var dimVal=v.dimmer_output!=null?Math.round(Number(v.dimmer_output)):(state.dimmer_level!=null?Math.round(Number(state.dimmer_level)):null);
    var hasDimmer=dimVal!==null || (inst.mappings||[]).some(function(m){ return m.input_key==='dimmer_output'; });
    var relayVal=v.light_relay;
    var relayOn=relayVal==='ON'||relayVal==='1'||relayVal===1||relayVal===true;
    var isLit=hasDimmer ? (Number(dimVal||0)>(Number(sp.dim_off_level||0)+5)) : !!(state.output_on||relayOn);
    var source=String(state.source||'auto').toLowerCase();
    var lastReason=String(state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action');
    var dark=(state.dark===true || (lux!==null && sp.lux_threshold && Number(lux)<Number(sp.lux_threshold)));

    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(meta.label)+'</div>';
    h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(isLit?'#f5c842':'var(--muted2)')+'">'+(hasDimmer?(dimVal!=null?dimVal:0)+'%':(isLit?'ON':'OFF'))+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(lastReason.length>46?(lastReason.slice(0,46)+'…'):lastReason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h+='<button onclick="manualLight('+inst.id+','+isLit+')" style="padding:9px 14px;border-radius:10px;border:1px solid '+(isLit?'rgba(245,200,66,.5)':'var(--line2)')+';background:'+(isLit?'rgba(245,200,66,.15)':'rgba(255,255,255,.05)')+';color:'+(isLit?'#f5c842':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isLit?'Turn OFF':'Turn ON')+'</button>';
    if(state.manual_active || source==='manual') h+='<button onclick="clearLightManual('+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h+='</div></div>';

    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    meta.chips.forEach(function(txt){
      var key=String(txt).toLowerCase();
      var active =
        (key==='auto' && (source==='auto' || source==='manual' || source==='idle')) ||
        (key==='manual' && (state.manual_active || source==='manual')) ||
        (key==='pir' && (motion || source==='motion' || source==='pir')) ||
        (key==='lux' && (source==='lux' || dark)) ||
        (key==='combined' && (source==='combined')) ||
        (key==='schedule' && (source==='schedule' || state.schedule_active));
      h+=badge(txt, active ? (key==='lux'?'#f5c842':key==='schedule'?'#a855f7':'#22d97a') : 'var(--muted2)', active ? (key==='lux'?'rgba(245,200,66,.35)':key==='schedule'?'rgba(168,85,247,.35)':'rgba(34,217,122,.35)') : 'var(--line)');
    });
    if(dark) h+=badge('Dark','#f5c842','rgba(245,200,66,.35)');
    if(isLit) h+=badge('Light ON','#22d97a','rgba(34,217,122,.35)'); else h+=badge('Light OFF','var(--muted2)','var(--line)');
    h+='</div>';

    h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Source</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:var(--text)">'+esc(source.charAt(0).toUpperCase()+source.slice(1))+'</div></div>';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Motion</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(motion?'#22d97a':'var(--text)')+'">'+(motion?'Detected':'Idle')+'</div></div>';
    var luxTxt = lux!==null ? (lux+' lux') : (motionAI!==null ? ('AI '+motionAI) : '—');
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Lux / AI</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(dark?'#f5c842':'var(--text)')+'">'+esc(luxTxt)+'</div></div>';
    h+='</div>';

    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+isPaused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(isPaused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(isPaused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(isPaused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(isPaused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    h+='</div>';
    return h;
  }

  async function interlockedManual(id, on){
    try{ await api('/automation/interlocked_switches/'+id+'/manual',{method:'POST',body:JSON.stringify({on:!!on})}); }
    catch(e){ toast('Cannot control interlocked switches'); }
    setTimeout(function(){ rerenderInstance(id); }, 220);
  }

  async function interlockedClearManual(id){
    try{ await api('/automation/interlocked_switches/'+id+'/clear-manual',{method:'POST'}); }
    catch(e){ toast('Cannot clear manual override'); }
    setTimeout(function(){ rerenderInstance(id); }, 220);
  }

  async function renderInterlockedSwitches(inst){
    var d={};
    try{ d=await api('/automation/status/'+inst.id); }catch(e){}
    var state=d.state||{}, values=d.values||{}, settings=d.settings||{}, paused=!!d.paused;
    var mappings=Array.isArray(inst.mappings)?inst.mappings:[];
    var controlType=String(settings.control_type || 'button');
    var reason=String(state.last_reason || 'Interlocked switch logic active');
    var outputOn=!!state.output_on;
    var manualActive=!!state.manual_active;
    var inputKeys=['switch_di','switch_di_2','switch_di_3','switch_di_4','switch_di_5','switch_di_6'];
    var outputKeys=['light_relay','light_relay_2','light_relay_3','light_relay_4'];
    var inputs=inputKeys.filter(function(k){ return mappings.some(function(m){ return m.input_key===k && m.io_id; }); }).map(function(k){ return { key:k, on:isOn(values[k]) }; });
    var outputs=outputKeys.filter(function(k){ return mappings.some(function(m){ return m.input_key===k && m.io_id; }); }).map(function(k){ return { key:k, on:isOn(values[k]) }; });

    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Interlocked Switches</div>';
    h+='<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(outputOn?'#22d97a':'var(--muted2)')+'">'+(outputOn?'ON':'OFF')+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(reason.length>56?(reason.slice(0,56)+'…'):reason)+'</div></div>';
    h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h+='<button onclick="interlockedManual('+inst.id+','+(!outputOn)+')" style="padding:9px 14px;border-radius:10px;border:1px solid '+(outputOn?'rgba(245,200,66,.5)':'var(--line2)')+';background:'+(outputOn?'rgba(245,200,66,.15)':'rgba(255,255,255,.05)')+';color:'+(outputOn?'#f5c842':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(outputOn?'Turn OFF':'Turn ON')+'</button>';
    if(manualActive) h+='<button onclick="interlockedClearManual('+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h+='</div></div>';

    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h+=badge(controlType==='button'?'Button mode':'Switch mode', '#1d8cff', 'rgba(29,140,255,.28)');
    h+=badge('inputs '+inputs.length, 'var(--muted2)', 'var(--line)');
    h+=badge('outputs '+outputs.length, 'var(--muted2)', 'var(--line)');
    if(manualActive) h+=badge('manual', '#f59e0b', 'rgba(245,158,11,.35)');
    h+=badge(outputOn?'light on':'light off', outputOn?'#22d97a':'var(--muted2)', outputOn?'rgba(34,217,122,.35)':'var(--line)');
    h+='</div>';

    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">';
    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Switch Inputs</div>';
    if(inputs.length){ inputs.forEach(function(x){ h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--line)"><span style="font-size:11px">'+esc(x.key.replace('switch_','SW '))+'</span><span style="font-size:10px;font-weight:800;color:'+(x.on?'#22d97a':'var(--muted2)')+'">'+(x.on?'ON':'OFF')+'</span></div>'; }); }
    else { h+='<div style="font-size:11px;color:var(--muted2)">No switch inputs mapped</div>'; }
    h+='</div>';

    h+='<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Light Outputs</div>';
    if(outputs.length){ outputs.forEach(function(x){ h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--line)"><span style="font-size:11px">'+esc(x.key.replace('light_','').replace(/_/g,' ').toUpperCase())+'</span><span style="font-size:10px;font-weight:800;color:'+(x.on?'#22d97a':'var(--muted2)')+'">'+(x.on?'ON':'OFF')+'</span></div>'; }); }
    else { h+='<div style="font-size:11px;color:var(--muted2)">No light outputs mapped</div>'; }
    h+='</div>';
    h+='</div>';

    if(canEngineerUI()) h+='<button onclick="toggleLightPause('+inst.id+','+paused+')" style="width:100%;margin-top:4px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';

    h+='</div>';
    return h;
  }

  window.MODULE_ACCENT = window.MODULE_ACCENT || {};
  window.MODULE_ICON = window.MODULE_ICON || {};
  ['basic_light','motion_light','daylight_light','scheduled_light','motion_daylight','scheduled_motion'].forEach(function(id){
    window.MODULE_ACCENT[id] = '#f5c842';
    window.MODULE_ICON[id] = '💡';
  });
  ['basic_thermostat','call_thermostat','zoned_thermostat'].forEach(function(id){
    window.MODULE_ACCENT[id] = '#1d8cff';
    window.MODULE_ICON[id] = '🌡️';
  });
  window.MODULE_ACCENT.interlocked_switches = '#22d97a';
  window.MODULE_ICON.interlocked_switches = '🔀';

  var origRenderInstance = window.renderInstance;
  if (typeof origRenderInstance !== 'function') return;

  window.renderInstance = async function(inst){
    if (!inst || !inst.module_id) return origRenderInstance(inst);

    if (inst.module_id === 'interlocked_switches') {
      var grid=document.getElementById('pageGrid');
      if(!grid) return;
      var cardId='inst-card-'+inst.id;
      var card=document.getElementById(cardId);
      var isNew=!card;
      if(isNew){
        card=document.createElement('div');
        card.id=cardId;
        card.className='inst-card';
        card.style.setProperty('--inst-accent','#22d97a');
        grid.appendChild(card);
      }
      card.classList.remove('wide-card');
      card.classList.remove('thermo-card');
      if(isNew){
        card.innerHTML='<div class="inst-header"><div class="inst-name">🔀 '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>';
      }
      var body=document.getElementById('inst-body-'+inst.id);
      if(body){
        try{ body.innerHTML = await renderInterlockedSwitches(inst); }
        catch(e){ body.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; }
      }
      return;
    }

    if (LIGHTING_IDS.has(inst.module_id)) {
      var grid2=document.getElementById('pageGrid');
      if(!grid2) return;
      var cardId2='inst-card-'+inst.id;
      var card2=document.getElementById(cardId2);
      var isNew2=!card2;
      if(isNew2){
        card2=document.createElement('div');
        card2.id=cardId2;
        card2.className='inst-card';
        card2.style.setProperty('--inst-accent','#f5c842');
        grid2.appendChild(card2);
      }
      card2.classList.remove('wide-card');
      card2.classList.remove('thermo-card');
      if(isNew2){
        card2.innerHTML='<div class="inst-header"><div class="inst-name">💡 '+escapeHTML(inst.name||('Instance #'+inst.id))+'</div><div class="inst-id">#'+inst.id+'</div></div><div id="inst-body-'+inst.id+'"><div style="color:var(--muted);font-size:12px">Loading...</div></div>';
      }
      var body2=document.getElementById('inst-body-'+inst.id);
      if(body2){
        try{ body2.innerHTML = await renderSplitLighting(inst); }
        catch(e){ body2.innerHTML = '<div style="color:var(--bad);font-size:12px">Error: '+escapeHTML(e.message)+'</div>'; }
      }
      return;
    }

    var normalized = normalizeModuleId(inst.module_id);
    if (normalized !== inst.module_id) {
      var patched = Object.assign({}, inst, { module_id: normalized, _original_module_id: inst.module_id });
      return origRenderInstance(patched);
    }
    return origRenderInstance(inst);
  };
})();
