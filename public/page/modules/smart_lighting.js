// ── public/page/modules/smart_lighting.js ─────────────────────────────
// Smart Lighting v2 — Scenarios + Adaptive Brightness + Follow-Me + Sunrise/Sleep
// ───────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'smart_lighting';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function ioNameForKey(mappings, key){
    var match = (mappings || []).find(function(m){ return String(m.input_key) === String(key); });
    return match ? (match.io_name || match.io_key || key) : key;
  }

  function scenarioTriggerCaption(s, mappings){
    var trigger = String(s && s.trigger || 'manual');
    var labels = { manual:'Manual', time:'Time', sunset:'Sunset', sunrise:'Sunrise', pir:'Motion', switch:'Switch', lux:'Lux' };
    if (trigger === 'time' && s.trigger_time) return labels[trigger] + ' · ' + s.trigger_time;
    if ((trigger === 'sunrise' || trigger === 'sunset') && (s.trigger_sun || s.trigger_offset != null)) {
      var offset = Number(s.trigger_offset || 0);
      return labels[trigger] + (offset ? ' · ' + (offset > 0 ? '+' + offset : offset) + ' min' : '');
    }
    if ((trigger === 'pir' || trigger === 'switch' || trigger === 'lux') && s.trigger_input_key) {
      return labels[trigger] + ' · ' + s.trigger_input_key;
    }
    return labels[trigger] || trigger;
  }

  function refreshSmartLighting(instId){
    if (typeof rerenderInstance === 'function') return Promise.resolve(rerenderInstance(instId));
    return Promise.resolve();
  }

  function slActivate(instId, scenarioId){
    var payload = scenarioId ? {scenario_id: scenarioId} : {scenario_id: null};
    return api('/automation/'+MODULE_ID+'/'+instId+'/activate',{method:'POST',body:JSON.stringify(payload)})
      .then(function(){ return refreshSmartLighting(instId); })
      .catch(function(e){ console.error('slActivate:',e); if (typeof toast === 'function') toast('Error: ' + e.message, 'err'); });
  }

  function slRelease(instId){
    return api('/automation/'+MODULE_ID+'/'+instId+'/activate',{method:'POST',body:JSON.stringify({release:true})})
      .then(function(){ return refreshSmartLighting(instId); })
      .catch(function(e){ console.error('slRelease:',e); if (typeof toast === 'function') toast('Error: ' + e.message, 'err'); });
  }

  function renderSmartLighting(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/automation/'+MODULE_ID+'/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};
      var scenarios = [];
      try { scenarios = JSON.parse(settings.scenarios || '[]'); } catch(e) {}
      if (!Array.isArray(scenarios)) scenarios = [];

      var activeId = state.active_scene || (sData.active_scenario && sData.active_scenario.id) || null;
      var active = scenarios.find(function(s){ return s.id === activeId; }) || null;
      var enabledScenarios = scenarios.filter(function(s){ return s.enabled !== false; });
      var lastReason = state.last_reason || 'No active scenario';

      var inputMappings  = (inst.mappings || []).filter(function(m){ return m.io_id && (m.input_key.startsWith('di_') || m.input_key.startsWith('ai_')); });

      if (!enabledScenarios.length && !settings.adaptive_brightness && !settings.follow_me && !settings.sunrise_enabled && !settings.sleep_enabled) {
        return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px 0">No features configured.<br>'+
          '<a href="/modules.html" style="color:var(--blue);font-size:11px">Edit in Modules \u2192</a></div>';
      }

      var h = '';

      // Header
      var statusColor = state.status === 'panic' ? '#ef4444' : active ? '#f0c040' : 'var(--muted2)';
      var headerBtns = '<button onclick="window._slActivate('+inst.id+',null)" style="padding:9px 12px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">Off</button>';
      if (state.manual_override) {
        headerBtns += ' <button onclick="window._slRelease('+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.3);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Auto</button>';
      }
      h += W.cardHeader('Smart Lighting', active ? active.name : 'Idle', statusColor, lastReason, headerBtns);

      // Chips
      var chips = [];
      var statusText = state.status || (active ? 'active' : 'idle');
      chips.push({ label: String(statusText).toUpperCase(), color: statusColor, borderColor: active ? 'rgba(240,192,64,.28)' : 'var(--line)' });
      if (String(settings.test_mode || '0') === '1')     chips.push({ label: 'TEST MODE',  color: '#ffd978',  borderColor: 'rgba(255,201,71,.35)' });
      if (state.manual_override)                         chips.push({ label: 'MANUAL',     color: '#f59e0b',  borderColor: 'rgba(245,158,11,.35)' });
      if (state.motion_active)                           chips.push({ label: 'MOTION',     color: '#22d97a',  borderColor: 'rgba(34,217,122,.35)' });
      if (state.schedule_active)                         chips.push({ label: 'SCHEDULE',   color: '#a855f7',  borderColor: 'rgba(168,85,247,.35)' });
      if (state.lux_value != null)                       chips.push({ label: Math.round(Number(state.lux_value)) + ' lux', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (active && Number(active.off_after) > 0)        chips.push({ label: active.off_after + ' min',       color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.adaptive_brightness || '0') === '1') chips.push({ label: 'ADAPTIVE',  color: '#06b6d4', borderColor: 'rgba(6,182,212,.3)' });
      if (String(settings.follow_me || '0') === '1')           chips.push({ label: 'FOLLOW-ME', color: '#84cc16', borderColor: 'rgba(132,204,22,.3)' });
      if (String(settings.sunrise_enabled || '0') === '1')     chips.push({ label: 'SUNRISE',   color: '#f97316', borderColor: 'rgba(249,115,22,.3)' });
      if (String(settings.sleep_enabled || '0') === '1')       chips.push({ label: 'SLEEP',     color: '#6366f1', borderColor: 'rgba(99,102,241,.3)' });
      chips.push({ label: enabledScenarios.length + ' scenes', color: 'var(--muted2)', borderColor: 'var(--line)' });
      h += W.chipRow(chips);

      // Active scenario details
      if (active) {
        var outs = active.outputs || [];
        var dimmers = outs.filter(function(o){ return !String(o.io_key||'').startsWith('do_'); }).length;
        var relays  = outs.filter(function(o){ return  String(o.io_key||'').startsWith('do_'); }).length;
        var inputLabel = active.trigger_input_key ? ioNameForKey(inputMappings, active.trigger_input_key) : 'Auto';
        h += W.statGrid([
          { label: 'Trigger', value: scenarioTriggerCaption(active, inputMappings).toUpperCase() },
          { label: 'Outputs', value: String(outs.length) },
          { label: 'Input',   value: String(inputLabel || 'Auto') },
          { label: 'Types',   value: (relays ? relays+' relay ' : '')+(dimmers ? dimmers+' dim' : '') || '\u2014' }
        ]);
      }

      // Compact scenario list
      if (enabledScenarios.length) {
        h += '<div style="font-size:10px;color:var(--muted2);margin:8px 0 4px;letter-spacing:.5px">SCENARIOS</div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px">';
        enabledScenarios.forEach(function(s){
          var isActive = s.id === activeId;
          var cap = scenarioTriggerCaption(s, inputMappings);
          h += '<button onclick="window._slActivate('+inst.id+',\''+String(s.id).replace(/'/g,'&#39;')+'\')" ';
          h += 'style="display:flex;align-items:center;gap:8px;text-align:left;padding:8px 10px;border-radius:10px;';
          h += 'border:1px solid '+(isActive?'rgba(240,192,64,.32)':'var(--line)')+';';
          h += 'background:'+(isActive?'rgba(240,192,64,.08)':'rgba(255,255,255,.03)')+';cursor:pointer">';
          h += '<span style="font-size:15px;flex-shrink:0">'+esc(s.icon||'\ud83d\udca1')+'</span>';
          h += '<div style="flex:1;min-width:0">';
          h += '<div style="font-size:12px;font-weight:800;color:'+(isActive?'#f0c040':'var(--text)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(s.name||'Scenario')+'</div>';
          h += '<div style="font-size:10px;color:var(--muted2);margin-top:1px">'+esc(cap)+'</div>';
          h += '</div>';
          if (isActive) h += '<span style="font-size:10px;color:#f0c040;font-weight:800;flex-shrink:0">\u25cf</span>';
          h += '</button>';
        });
        h += '</div>';
      }

      // Sensor history link
      if (inputMappings.length) {
        var ioParams = inputMappings.map(function(m){ return m.io_id; }).join(',');
        h += '<a href="/history.html?io='+ioParams+'" style="display:block;text-align:center;font-size:11px;color:var(--blue);padding-top:8px">\ud83d\udcc8 View sensor history</a>';
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  // Expose globally
  window._slActivate = slActivate;
  window._slRelease = slRelease;
  window.renderSmartLightingModule = renderSmartLighting;
  window.isSmartLightingModule = function(moduleId){ return moduleId === MODULE_ID; };

})();
