// ── public/page/modules/maintenance.js ────────────────────────────────────
// Maintenance Tracker module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'maintenance';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderMaintenance(inst){
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
      var statusColor = state.overdue ? '#ef4444' : state.due_soon ? '#f59e0b' : '#22d97a';
      h += W.cardHeader('Maintenance Tracker', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.overdue_count > 0) chips.push({ label: state.overdue_count + ' OVERDUE', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' });
      if (state.due_soon_count > 0) chips.push({ label: state.due_soon_count + ' DUE SOON', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.completed_count != null) chips.push({ label: state.completed_count + ' completed', color: '#22d97a', borderColor: 'rgba(34,217,122,.25)' });
      if (state.total_tasks != null) chips.push({ label: state.total_tasks + ' tasks', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var stats = [];
      if (state.next_due != null) stats.push({ label: 'Next Due', value: String(state.next_due) });
      if (state.last_completed != null) stats.push({ label: 'Last Completed', value: String(state.last_completed) });
      if (stats.length) h += W.statGrid(stats);

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderMaintenanceModule = renderMaintenance;

})();
