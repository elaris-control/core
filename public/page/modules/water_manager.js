// ── public/page/modules/water_manager.js ──────────────────────────────────
// Water Manager module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'water_manager';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderWaterManager(inst){
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
      var statusColor = state.shutoff ? '#ef4444' : state.leak_detected ? '#ef4444' : state.ghost_flow ? '#f59e0b' : state.pressure_drop ? '#f59e0b' : '#22d97a';
      h += W.cardHeader('Water Manager', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.shutoff) chips.push({ label: 'VALVE CLOSED', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.leak_detected) chips.push({ label: 'LEAK', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.ghost_flow) chips.push({ label: 'GHOST FLOW', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.pressure_drop) chips.push({ label: 'PRESSURE DROP', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.flow_value != null) chips.push({ label: state.flow_value + ' L/min', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.pressure_value != null) chips.push({ label: state.pressure_value + ' bar', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.total_litres != null) stats.push({ label: 'Total', value: state.total_litres + ' L' });
      if (state.daily_litres != null) stats.push({ label: 'Today', value: state.daily_litres + ' L' });
      if (stats.length) h += W.statGrid(stats);

      if (state.leak_location) {
        h += '<div style="color:#ef4444;font-size:11px;text-align:center;padding:8px">Leak detected: '+esc(state.leak_location)+'</div>';
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderWaterManagerModule = renderWaterManager;

})();
