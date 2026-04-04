// ── public/page/modules/pool_spa.js ───────────────────────────────────────
// Pool & Spa module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'pool_spa';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderPoolSpa(inst){
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
      var statusColor = state.heating ? '#f59e0b' : state.filtering ? '#1d8cff' : '#22d97a';
      h += W.cardHeader('Pool & Spa', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.heating) chips.push({ label: 'HEATING', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.filtering) chips.push({ label: 'FILTERING', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.temp_pool != null) chips.push({ label: 'Pool ' + state.temp_pool + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.temp_spa != null) chips.push({ label: 'Spa ' + state.temp_spa + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.ph != null) chips.push({ label: 'pH ' + state.ph, color: state.ph >= 7.2 && state.ph <= 7.6 ? '#22d97a' : '#f59e0b', borderColor: state.ph >= 7.2 && state.ph <= 7.6 ? 'rgba(34,217,122,.25)' : 'rgba(245,158,11,.25)' });
      if (state.cl != null) chips.push({ label: 'Cl ' + state.cl + ' ppm', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.setpoint_pool != null) stats.push({ label: 'Pool Setpoint', value: state.setpoint_pool + '°C' });
      if (state.setpoint_spa != null) stats.push({ label: 'Spa Setpoint', value: state.setpoint_spa + '°C' });
      if (state.filter_hours != null) stats.push({ label: 'Filter Hours', value: String(state.filter_hours) + 'h' });
      if (stats.length) h += W.statGrid(stats);

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderPoolSpaModule = renderPoolSpa;

})();
