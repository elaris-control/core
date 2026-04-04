// ── public/page/modules/solar.js ──────────────────────────────────────────
// Solar module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'solar';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderSolar(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/automation/solar/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};
      var values = lData.values || {};

      var h = '';
      var statusLabel = state.status || 'Idle';
      var statusColor = state.pump_run ? '#22d97a' : state.heater_on ? '#f59e0b' : state.backup_on ? '#ef4444' : state.overheat ? '#ef4444' : 'var(--muted2)';
      h += W.cardHeader('Solar System', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? statusColor.replace(')', ',.35)').replace('#', 'rgba(') : 'var(--line)'
      });
      if (state.diff != null) chips.push({ label: 'ΔT ' + state.diff + '°C', color: state.diff > 0 ? '#22d97a' : 'var(--muted)', borderColor: state.diff > 0 ? 'rgba(34,217,122,.25)' : 'var(--line)' });
      if (state.temp_solar != null) chips.push({ label: 'Solar ' + state.temp_solar + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.temp_boiler != null) chips.push({ label: 'Boiler ' + state.temp_boiler + '°C', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.pump_run) chips.push({ label: 'PUMP ON', color: '#22d97a', borderColor: 'rgba(34,217,122,.35)' });
      if (state.pump_speed != null) chips.push({ label: Math.round(state.pump_speed) + '%', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.heater_on) chips.push({ label: 'HEATER', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.backup_on) chips.push({ label: 'BACKUP', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.overheat) chips.push({ label: 'OVERHEAT', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.anti_freeze_active) chips.push({ label: 'ANTI-FREEZE', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.legionella_cycle_active) chips.push({ label: 'LEGIONELLA', color: '#a855f7', borderColor: 'rgba(168,85,247,.35)' });
      if (state.stagnation_alert) chips.push({ label: 'STAGNATION', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.profile) stats.push({ label: 'Profile', value: String(state.profile).toUpperCase() });
      if (state.max_boiler_temp != null) stats.push({ label: 'Max Boiler', value: state.max_boiler_temp + '°C' });
      if (state.min_solar_temp != null) stats.push({ label: 'Min Solar', value: state.min_solar_temp + '°C' });
      if (stats.length) h += W.statGrid(stats);

      if (state.lockout_reason) {
        h += '<div style="color:#ef4444;font-size:11px;text-align:center;padding:8px">'+esc(state.lockout_reason)+'</div>';
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderSolarModule = renderSolar;

})();
