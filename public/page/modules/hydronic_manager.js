// ── public/page/modules/hydronic_manager.js ───────────────────────────────
// Hydronic Manager module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'hydronic_manager';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderHydronicManager(inst){
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
      var statusColor = state.heating ? '#f59e0b' : state.cooling ? '#1d8cff' : '#22d97a';
      h += W.cardHeader('Hydronic Manager', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.heating) chips.push({ label: 'HEATING', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.cooling) chips.push({ label: 'COOLING', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.temp_supply != null) chips.push({ label: 'Supply ' + state.temp_supply + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.temp_return != null) chips.push({ label: 'Return ' + state.temp_return + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.pump_running) chips.push({ label: 'PUMP ON', color: '#22d97a', borderColor: 'rgba(34,217,122,.35)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.active_zones != null) stats.push({ label: 'Active Zones', value: String(state.active_zones) });
      if (state.total_zones != null) stats.push({ label: 'Total Zones', value: String(state.total_zones) });
      if (state.setpoint != null) stats.push({ label: 'Setpoint', value: state.setpoint + '°C' });
      if (stats.length) h += W.statGrid(stats);

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderHydronicManagerModule = renderHydronicManager;

})();
