// ── public/page/modules/custom.js ─────────────────────────────────────────
// Custom Logic module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'custom';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderCustom(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/automation/'+MODULE_ID+'/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};

      var h = '';
      var statusLabel = state.status || 'Idle';
      var statusColor = state.output_on ? '#22d97a' : 'var(--muted2)';
      h += W.cardHeader('Custom Logic', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.output_on != null) chips.push({ label: state.output_on ? 'ON' : 'OFF', color: state.output_on ? '#22d97a' : 'var(--muted)', borderColor: state.output_on ? 'rgba(34,217,122,.25)' : 'var(--line)' });
      if (state.rules_triggered != null) chips.push({ label: state.rules_triggered + ' rules', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var rules = settings.rules || [];
      var ruleCount = Array.isArray(rules) ? rules.length : 0;
      var mappings = inst.mappings || [];
      var mappedCount = mappings.filter(function(m){ return m.io_id; }).length;
      if (ruleCount || mappedCount) {
        var stats = [];
        if (ruleCount) stats.push({ label: 'Rules', value: String(ruleCount) });
        if (mappedCount) stats.push({ label: 'Mappings', value: String(mappedCount) });
        h += W.statGrid(stats);
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderCustomModule = renderCustom;

})();
