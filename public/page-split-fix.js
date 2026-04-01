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
    if (LIGHTING_IDS.has(id)) return 'lighting';
    if (THERMO_IDS.has(id)) return 'thermostat';
    return id;
  }

  function isOn(v){
    return v==='ON' || v==='1' || v===1 || v===true || v==='true';
  }

  async function renderInterlockedSwitches(inst){
    var d={};
    try{ d=await api('/automation/status/'+inst.id); }catch(e){}
    var state=d.state||{}, values=d.values||{}, settings=d.settings||{}, paused=!!d.paused;
    var mappings=Array.isArray(inst.mappings)?inst.mappings:[];
    var mode=String(state.mode || settings.mode || 'interlocked').toUpperCase();
    var reason=String(state.last_reason || 'Interlocked switch logic active');
    var mappedCount=mappings.filter(function(m){ return !!m.io_id; }).length;
    var activeKeys=Object.keys(values).filter(function(k){ return isOn(values[k]); });
    var activeCount=activeKeys.length;

    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h+='<div><div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Interlocked Switches</div>';
    h+='<div style="margin-top:3px;font-size:22px;font-weight:900;color:'+(activeCount?'#22d97a':'var(--muted2)')+'">'+(activeCount?activeCount+' active':'Idle')+'</div>';
    h+='<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(reason.length>56?(reason.slice(0,56)+'…'):reason)+'</div></div>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">';
    h+='<span class="pill">'+esc(mode)+'</span>';
    h+='<span class="pill">mapped '+mappedCount+'</span>';
    if(activeCount) h+='<span class="pill" style="border-color:rgba(34,217,122,.35);color:#22d97a">active '+activeCount+'</span>';
    h+='</div></div>';

    h+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">';
    h+='<div class="compact-badge"><span class="k">Mapped</span><span class="v">'+mappedCount+'</span></div>';
    h+='<div class="compact-badge"><span class="k">Active</span><span class="v">'+activeCount+'</span></div>';
    h+='</div>';

    if(activeKeys.length){
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
      activeKeys.slice(0,8).forEach(function(k){ h+='<span class="pill" style="font-size:10px;border-color:rgba(34,217,122,.35);color:#22d97a">'+esc(k)+'</span>'; });
      if(activeKeys.length>8) h+='<span class="pill" style="font-size:10px">+'+(activeKeys.length-8)+' more</span>';
      h+='</div>';
    }

    if(canEngineerUI()){
      h+='<a href="/modules.html" style="display:block;text-align:center;font-size:11px;color:var(--blue);padding-top:4px">Open module settings →</a>';
      h+='<button onclick="toggleThermoPause('+inst.id+','+paused+')" style="width:100%;margin-top:4px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';
    }

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

    var normalized = normalizeModuleId(inst.module_id);
    if (normalized !== inst.module_id) {
      var patched = Object.assign({}, inst, { module_id: normalized, _original_module_id: inst.module_id });
      return origRenderInstance(patched);
    }
    return origRenderInstance(inst);
  };
})();
