// ── public/page/modules/energy.js ─────────────────────────────────────────
// Energy Monitor module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'energy';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderEnergy(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/energy/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};
      var values = lData.values || {};

      var h = '';
      var statusLabel = state.status || 'Monitoring';
      var statusColor = state.status === 'alert' ? '#ef4444' : '#22d97a';
      h += W.cardHeader('Energy Monitor', statusLabel, statusColor,
        state.last_reason || 'Monitoring', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'monitoring').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.watts != null) chips.push({ label: Math.round(state.watts) + 'W', color: state.watts > 0 ? '#f5c842' : 'var(--muted)', borderColor: state.watts > 0 ? 'rgba(245,200,66,.25)' : 'var(--line)' });
      if (state.export_w != null) chips.push({ label: '↑ ' + Math.round(state.export_w) + 'W', color: '#22d97a', borderColor: 'rgba(34,217,122,.25)' });
      if (state.tariff_period) chips.push({ label: state.tariff_period.toUpperCase() + ' TARIFF', color: state.tariff_period === 'peak' ? '#ef4444' : '#22d97a', borderColor: state.tariff_period === 'peak' ? 'rgba(239,68,68,.25)' : 'rgba(34,217,122,.25)' });
      if (state.peak_today != null) chips.push({ label: 'Peak ' + state.peak_today + 'W', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.kwh_today != null) stats.push({ label: 'Today', value: state.kwh_today + ' kWh' });
      if (state.kwh_month != null) stats.push({ label: 'Month', value: state.kwh_month + ' kWh' });
      if (state.kwh_total != null) stats.push({ label: 'Total', value: state.kwh_total + ' kWh' });
      if (state.cost_today != null) stats.push({ label: 'Cost Today', value: state.cost_today.toFixed(2) + '€' });
      if (state.cost_month != null) stats.push({ label: 'Cost Month', value: state.cost_month.toFixed(2) + '€' });
      if (state.co2_today_kg != null) stats.push({ label: 'CO₂ Today', value: state.co2_today_kg + ' kg' });
      if (state.kwh_export_today != null && state.kwh_export_today > 0) stats.push({ label: 'Export Today', value: state.kwh_export_today + ' kWh' });
      if (state.export_rev_today != null && state.export_rev_today > 0) stats.push({ label: 'Export Revenue', value: state.export_rev_today.toFixed(2) + '€' });
      if (stats.length) h += W.statGrid(stats);

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderEnergyModule = renderEnergy;

})();
