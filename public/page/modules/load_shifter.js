// ── public/page/modules/load_shifter.js ───────────────────────────────────
// Load Shifter module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'load_shifter';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderLoadShifter(inst){
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
      var statusColor = state.shed_count > 0 ? '#f59e0b' : '#22d97a';
      h += W.cardHeader('Load Shifter', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.power != null) chips.push({ label: Math.round(state.power) + 'W', color: state.power > (state.threshold||8000) ? '#ef4444' : '#22d97a', borderColor: state.power > (state.threshold||8000) ? 'rgba(239,68,68,.25)' : 'rgba(34,217,122,.25)' });
      if (state.threshold != null) chips.push({ label: 'Threshold ' + state.threshold + 'W', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (state.shed_count > 0) chips.push({ label: state.shed_count + ' SHED', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.restore_below != null) chips.push({ label: 'Restore < ' + state.restore_below + 'W', color: 'var(--muted2)', borderColor: 'var(--line)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var loadStates = state.load_states || [];
      if (loadStates.length) {
        h += '<div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:6px 0 4px">Loads</div>';
        loadStates.forEach(function(ls){
          var isShed = ls.shed;
          var isPending = ls.soft_pending;
          var isRestore = ls.restore_pending;
          var label = ls.label || ls.key || 'Load';
          h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:4px;background:rgba(255,255,255,.03)">';
          h += '<span style="font-size:11px;font-weight:700">'+esc(label)+'</span>';
          h += '<span style="font-size:10px;font-weight:800;color:'+(isShed?'#f59e0b':isPending?'#a855f7':isRestore?'#1d8cff':ls.on?'#22d97a':'var(--muted)')+'">'+(isShed?'SHED':isPending?'PENDING':isRestore?'RESTORE':ls.on?'ON':'OFF')+'</span>';
          h += '</div>';
        });
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderLoadShifterModule = renderLoadShifter;

})();
