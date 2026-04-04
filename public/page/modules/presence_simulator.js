// ── public/page/modules/presence_simulator.js ─────────────────────────────
// Presence Simulator module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'presence_simulator';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderPresenceSimulator(inst){
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
      var statusColor = state.active ? '#22d97a' : 'var(--muted2)';
      h += W.cardHeader('Presence Simulator', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.active) chips.push({ label: 'ACTIVE', color: '#22d97a', borderColor: 'rgba(34,217,122,.35)' });
      if (state.outputs_active != null) chips.push({ label: state.outputs_active + ' outputs', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.next_event != null) chips.push({ label: 'Next: ' + state.next_event, color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var mappings = inst.mappings || [];
      var mappedCount = mappings.filter(function(m){ return m.io_id; }).length;
      if (mappedCount) {
        h += W.statGrid([
          { label: 'Outputs', value: String(mappedCount) }
        ]);
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderPresenceSimulatorModule = renderPresenceSimulator;

})();
