// ── public/page/modules/staircase.js ──────────────────────────────────────
// Staircase module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'staircase';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function renderStaircase(inst){
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
      h += W.cardHeader('Staircase', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (state.output_on != null) chips.push({ label: state.output_on ? 'ON' : 'OFF', color: state.output_on ? '#22d97a' : 'var(--muted)', borderColor: state.output_on ? 'rgba(34,217,122,.25)' : 'var(--line)' });
      if (state.motion_top) chips.push({ label: 'MOTION TOP', color: '#a855f7', borderColor: 'rgba(168,85,247,.35)' });
      if (state.motion_bottom) chips.push({ label: 'MOTION BOTTOM', color: '#a855f7', borderColor: 'rgba(168,85,247,.35)' });
      if (state.ramp_active) chips.push({ label: 'RAMPING', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      var mappings = inst.mappings || [];
      var mappedCount = mappings.filter(function(m){ return m.io_id; }).length;
      if (mappedCount) {
        h += W.statGrid([
          { label: 'Mappings', value: String(mappedCount) }
        ]);
      }

      return h;
    }).catch(function(e){
      return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Error loading: '+esc(e.message)+'</div>';
    });
  }

  window.renderStaircaseModule = renderStaircase;

})();
