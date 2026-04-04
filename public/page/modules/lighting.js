// ── public/page/modules/lighting.js ───────────────────────────────────
// Lighting module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'lighting';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function setLevel(instId, level){
    return api('/automation/'+MODULE_ID+'/'+instId+'/level',{method:'POST',body:JSON.stringify({level:level})})
      .catch(function(e){ console.error('setLevel:',e); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(instId); }, 300); });
  }

  function renderLighting(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/automation/'+MODULE_ID+'/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};
      var values = lData.values || {};

      var h = '';
      h += W.cardHeader('Lighting', state.status || 'Idle',
        state.status === 'active' || state.output_on ? '#22d97a' : 'var(--muted2)',
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: state.output_on ? '#22d97a' : 'var(--muted2)',
        borderColor: state.output_on ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.output_on != null) chips.push({ label: state.output_on ? 'ON' : 'OFF', color: state.output_on ? '#22d97a' : 'var(--muted)', borderColor: state.output_on ? 'rgba(34,217,122,.25)' : 'var(--line)' });
      if (values.level != null) chips.push({ label: Math.round(Number(values.level)) + '%', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var mappings = inst.mappings || [];
      var mappedCount = mappings.filter(function(m){ return m.io_id; }).length;
      if (mappedCount) {
        h += W.statGrid([
          { label: 'Mappings', value: String(mappedCount) }
        ]);
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window._lightingSetLevel = setLevel;
  window.renderLightingModule = renderLighting;

})();
