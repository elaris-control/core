// ── public/page/modules/lighting.js ───────────────────────────────────
// Lighting module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'lighting';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function setLevel(instId, level){
    return api('/automation/' + MODULE_ID + '/' + instId + '/level', { method:'POST', body:JSON.stringify({ level:level }) })
      .catch(function(e){ console.error('setLevel:', e); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(instId); }, 300); });
  }

  function renderLightingFallback(inst){
    return api('/automation/status/' + inst.id).then(function(data){
      var state = data.state || {};
      var values = data.values || {};
      var level = values.dimmer_output != null ? Math.round(Number(values.dimmer_output)) : null;
      var chips = [
        {
          label: state.output_on ? 'ON' : 'OFF',
          color: state.output_on ? '#22d97a' : 'var(--muted2)',
          borderColor: state.output_on ? 'rgba(34,217,122,.35)' : 'var(--line)'
        }
      ];
      if (level != null) chips.push({ label: level + '%', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.manual_active) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });

      var html = '';
      html += W.cardHeader('Lighting', state.output_on ? 'On' : 'Off', state.output_on ? '#22d97a' : 'var(--muted2)', state.last_reason || 'No activity', '');
      html += W.chipRow(chips);
      return html;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: ' + esc(e.message) + '</div>';
    });
  }

  window._lightingSetLevel = setLevel;
  window.renderLightingModule = function(inst){
    if (typeof window.renderLighting === 'function') return window.renderLighting(inst);
    return renderLightingFallback(inst);
  };

})();
