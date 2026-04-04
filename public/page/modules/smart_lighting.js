// ── public/page/modules/smart_lighting.js ─────────────────────────────
// Smart Lighting v2 — Scenarios + Adaptive Brightness + Follow-Me + Sunrise/Sleep
// ───────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'smart_lighting';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function slActivate(instId, scenarioId){
    var payload = scenarioId ? {scenario_id: scenarioId} : {scenario_id: null};
    return api('/automation/'+MODULE_ID+'/'+instId+'/activate',{method:'POST',body:JSON.stringify(payload)})
      .catch(function(e){ console.error('slActivate:',e); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(instId); }, 300); });
  }

  function slRelease(instId){
    return api('/automation/'+MODULE_ID+'/'+instId+'/activate',{method:'POST',body:JSON.stringify({release:true})})
      .catch(function(e){ console.error('slRelease:',e); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(instId); }, 300); });
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
      var activeName = state.active_scene_name || (sData.active_scenario && sData.active_scenario.name) || null;
      var active = scenarios.find(function(s){ return s.id === activeId; }) || null;
      var enabledScenarios = scenarios.filter(function(s){ return s.enabled !== false; });
      var lastReason = state.last_reason || 'No active scenario';

      var outputMappings = (inst.mappings || []).filter(function(m){ return m.io_id && (m.input_key.startsWith('do_') || m.input_key.startsWith('ao_')); });
      var inputMappings = (inst.mappings || []).filter(function(m){ return m.io_id && (m.input_key.startsWith('di_') || m.input_key.startsWith('ai_')); });
      var dimmerMappings = outputMappings.filter(function(m){ return m.input_key.startsWith('ao_'); });
      var relayMappings = outputMappings.filter(function(m){ return m.input_key.startsWith('do_'); });
      var luxMappings = inputMappings.filter(function(m){ return m.input_key.startsWith('ai_'); });
      var diMappings = inputMappings.filter(function(m){ return m.input_key.startsWith('di_'); });

      if (!enabledScenarios.length && !settings.adaptive_brightness && !settings.follow_me && !settings.sunrise_enabled && !settings.sleep_enabled) {
        return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px 0">No features configured.<br>'+
          '<a href="/modules.html" style="color:var(--blue);font-size:11px">Edit in Modules →</a></div>';
      }

      var h = '';

      // Header
      var statusText = state.status || (active ? 'active' : 'idle');
      var statusColor = state.status === 'panic' ? '#ef4444' : active ? '#f0c040' : 'var(--muted2)';
      var headerBtns = '<button onclick="window._slActivate('+inst.id+',null)" style="padding:9px 12px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:12px;font-weight:800;cursor:pointer">Off</button>';
      if (state.manual_override) {
        headerBtns += ' <button onclick="window._slRelease('+inst.id+')" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.3);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Auto</button>';
      }
      h += W.cardHeader('Smart Lighting', active ? active.name : 'Idle',
        statusColor, lastReason, headerBtns);

      // Chips
      var chips = [];
      chips.push({
        label: String(statusText).toUpperCase(),
        color: statusColor,
        borderColor: active ? 'rgba(240,192,64,.28)' : 'var(--line)'
      });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.motion_active) chips.push({ label: 'MOTION', color: '#22d97a', borderColor: 'rgba(34,217,122,.35)' });
      if (state.schedule_active) chips.push({ label: 'SCHEDULE', color: '#a855f7', borderColor: 'rgba(168,85,247,.35)' });
      if (state.lux_value != null) chips.push({ label: Math.round(Number(state.lux_value)) + ' lux', color: 'var(--muted2)', borderColor: 'var(--line)' });

      // Feature chips
      if (String(settings.adaptive_brightness || '0') === '1') chips.push({ label: 'ADAPTIVE', color: '#06b6d4', borderColor: 'rgba(6,182,212,.3)' });
      if (String(settings.follow_me || '0') === '1') chips.push({ label: 'FOLLOW-ME', color: '#84cc16', borderColor: 'rgba(132,204,22,.3)' });
      if (String(settings.sunrise_enabled || '0') === '1') chips.push({ label: 'SUNRISE', color: '#f97316', borderColor: 'rgba(249,115,22,.3)' });
      if (String(settings.sleep_enabled || '0') === '1') chips.push({ label: 'SLEEP', color: '#6366f1', borderColor: 'rgba(99,102,241,.3)' });

      chips.push({ label: enabledScenarios.length + ' scenes', color: 'var(--muted2)', borderColor: 'var(--line)' });
      h += W.chipRow(chips);

      // Active scenario details
      if (active) {
        var outs = active.outputs || [];
        var dimmers = outs.filter(function(o){ return !String(o.io_key||'').startsWith('do_'); }).length;
        var relays = outs.filter(function(o){ return String(o.io_key||'').startsWith('do_'); }).length;
        var triggerLabels = {manual:'Manual',time:'Time',sunset:'Sunset',sunrise:'Sunrise',pir:'Motion',switch:'Switch',lux:'Lux'};
        h += W.statGrid([
          { label: 'Trigger', value: String(triggerLabels[active.trigger || 'manual'] || active.trigger || 'manual').toUpperCase() },
          { label: 'Outputs', value: String(outs.length) },
          { label: 'Types', value: (relays ? relays + ' relay ' : '') + (dimmers ? dimmers + ' dim' : '') || '—' }
        ]);
      }

      // Feature status panels
      if (String(settings.adaptive_brightness || '0') === '1' && luxMappings.length && dimmerMappings.length) {
        var luxVal = state.lux_value != null ? Math.round(Number(state.lux_value)) : '—';
        h += '<div style="margin:8px 0 4px;font-size:10px;color:#06b6d4;font-weight:700;letter-spacing:1px;text-transform:uppercase">Adaptive Brightness</div>';
        h += '<div style="font-size:11px;color:var(--muted);line-height:1.5">';
        h += 'Lux: <strong style="color:var(--text)">'+luxVal+' lux</strong> → ';
        h += 'Dimmers: '+dimmerMappings.map(function(m){ return esc(m.input_key); }).join(', ');
        h += '</div>';
      }

      if (String(settings.follow_me || '0') === '1' && diMappings.length) {
        h += '<div style="margin:8px 0 4px;font-size:10px;color:#84cc16;font-weight:700;letter-spacing:1px;text-transform:uppercase">Follow-Me Lighting</div>';
        h += '<div style="font-size:11px;color:var(--muted);line-height:1.5">';
        h += 'DI inputs: '+diMappings.map(function(m){ return esc(m.input_key); }).join(', ');
        h += ' → Outputs: '+(relayMappings.length ? relayMappings.map(function(m){ return esc(m.input_key); }).join(', ') : 'no DO mapped');
        h += ' (timeout: '+(settings.follow_me_timeout||120)+'s)';
        h += '</div>';
      }

      if (String(settings.sunrise_enabled || '0') === '1') {
        h += '<div style="margin:8px 0 4px;font-size:10px;color:#f97316;font-weight:700;letter-spacing:1px;text-transform:uppercase">Sunrise Routine</div>';
        h += '<div style="font-size:11px;color:var(--muted);line-height:1.5">';
        h += (settings.sunrise_start||'07:00') + ' → ' + (settings.sunrise_end||'07:45');
        if (settings.sunrise_output) h += ' → ' + esc(settings.sunrise_output);
        h += '</div>';
      }

      if (String(settings.sleep_enabled || '0') === '1') {
        h += '<div style="margin:8px 0 4px;font-size:10px;color:#6366f1;font-weight:700;letter-spacing:1px;text-transform:uppercase">Sleep Routine</div>';
        h += '<div style="font-size:11px;color:var(--muted);line-height:1.5">';
        h += (settings.sleep_start||'23:00') + ' → ' + (settings.sleep_end||'23:45');
        if (settings.sleep_output) h += ' → ' + esc(settings.sleep_output);
        h += '</div>';
      }

      // Scenario grid
      if (enabledScenarios.length) {
        h += '<div style="font-size:10px;color:var(--muted2);margin:8px 0 4px">Scenarios</div>';
        h += '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">';
        enabledScenarios.slice(0, 6).forEach(function(s){
          var isActive = s.id === activeId;
          var triggerLabels2 = {manual:'Manual',time:'Time',sunset:'Sunset',sunrise:'Sunrise',pir:'Motion',switch:'Switch',lux:'Lux'};
          h += '<button onclick="window._slActivate('+inst.id+',\''+String(s.id).replace(/'/g,'&#39;')+'\')" style="text-align:left;padding:9px 10px;border-radius:10px;border:1px solid '+(isActive?'rgba(240,192,64,.32)':'var(--line)')+';background:'+(isActive?'rgba(240,192,64,.08)':'rgba(255,255,255,.03)')+';cursor:pointer">';
          h += '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">'+esc(s.icon||'💡')+'</span><div style="min-width:0;flex:1"><div style="font-size:12px;font-weight:800;color:'+(isActive?'#f0c040':'var(--text)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(s.name||'Scenario')+'</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">'+esc(triggerLabels2[s.trigger||'manual']||String(s.trigger||'manual'))+'</div></div>'+(isActive?'<span style="font-size:10px;color:#f0c040;font-weight:800">●</span>':'')+'</div>';
          h += '</button>';
        });
        h += '</div>';
        if (enabledScenarios.length > 6) {
          h += '<div style="font-size:11px;color:var(--muted2);text-align:center;margin-top:6px">+'+(enabledScenarios.length-6)+' more in module settings</div>';
        }
      }

      // Sensor history link
      if (inputMappings.length) {
        var ioParams = inputMappings.map(function(m){ return m.io_id; }).join(',');
        h += '<a href="/history.html?io='+ioParams+'" style="display:block;text-align:center;font-size:11px;color:var(--blue);padding-top:8px">📈 View sensor history</a>';
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
