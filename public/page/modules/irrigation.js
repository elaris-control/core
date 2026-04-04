// ── public/page/modules/irrigation.js ─────────────────────────────────────
// Irrigation module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'irrigation';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderIrrigation(inst){
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
      var statusColor = state.watering ? '#1d8cff' : state.rain_delay ? '#a855f7' : '#22d97a';
      h += W.cardHeader('Irrigation', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.watering) chips.push({ label: 'WATERING', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.current_zone != null) chips.push({ label: 'Zone ' + state.current_zone, color: '#1d8cff', borderColor: 'rgba(29,140,255,.25)' });
      if (state.rain_delay) chips.push({ label: 'RAIN DELAY', color: '#a855f7', borderColor: 'rgba(168,85,247,.35)' });
      if (state.soil_moisture != null) chips.push({ label: 'Moisture ' + state.soil_moisture + '%', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.temperature != null) chips.push({ label: state.temperature + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.total_zones != null) stats.push({ label: 'Zones', value: String(state.total_zones) });
      if (state.next_run != null) stats.push({ label: 'Next Run', value: String(state.next_run) });
      if (state.water_used_today != null) stats.push({ label: 'Water Today', value: state.water_used_today + ' L' });
      if (stats.length) h += W.statGrid(stats);

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderIrrigationModule = renderIrrigation;

})();
