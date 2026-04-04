// ── public/page/modules/awning.js ─────────────────────────────────────────
// Awning module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'awning';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function awningControl(instId, action){
    return api('/automation/'+MODULE_ID+'/'+instId+'/control',{method:'POST',body:JSON.stringify({action:action})})
      .catch(function(e){ console.error('awningControl:',e); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(instId); }, 300); });
  }

  function renderAwning(inst){
    var statusData = {}, liveData = {};
    try { statusData = api('/automation/'+MODULE_ID+'/'+inst.id+'/status'); } catch(e) {}
    try { liveData = api('/automation/status/'+inst.id); } catch(e) {}

    return Promise.all([statusData, liveData]).then(function(results){
      var sData = results[0] || {};
      var lData = results[1] || {};
      var settings = lData.settings || {};
      var state = lData.state || {};
      var values = lData.values || {};

      var h = '';
      var isOn = values.relay_open === 'ON' || values.relay_close === 'ON' || state.output_on;
      var statusLabel = state.status || 'Idle';
      var statusColor = isOn ? '#22d97a' : 'var(--muted2)';
      h += W.cardHeader('Awning', statusLabel, statusColor,
        state.last_reason || 'No activity', '');

      var chips = [];
      chips.push({
        label: String(state.status || 'idle').toUpperCase(),
        color: statusColor,
        borderColor: statusColor !== 'var(--muted2)' ? 'rgba(34,217,122,.35)' : 'var(--line)'
      });
      if (values.relay_open === 'ON') chips.push({ label: 'OPENING', color: '#22d97a', borderColor: 'rgba(34,217,122,.35)' });
      if (values.relay_close === 'ON') chips.push({ label: 'CLOSING', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (state.wind_speed != null) chips.push({ label: 'Wind ' + state.wind_speed + ' km/h', color: state.wind_speed > (settings.wind_threshold || 30) ? '#ef4444' : '#22d97a', borderColor: state.wind_speed > (settings.wind_threshold || 30) ? 'rgba(239,68,68,.25)' : 'rgba(34,217,122,.25)' });
      if (state.rain_detected) chips.push({ label: 'RAIN', color: '#1d8cff', borderColor: 'rgba(29,140,255,.35)' });
      if (state.sun_detected) chips.push({ label: 'SUN', color: '#f5c842', borderColor: 'rgba(245,200,66,.25)' });
      if (state.manual_override) chips.push({ label: 'MANUAL', color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' });
      if (String(settings.test_mode || '0') === '1') chips.push({ label: 'TEST MODE', color: '#ffd978', borderColor: 'rgba(255,201,71,.35)' });
      h += W.chipRow(chips);

      // Control buttons
      h += '<div style="display:flex;gap:8px;justify-content:center;padding:8px 0">';
      h += '<button onclick="window._awningControl('+inst.id+',\'open\')" style="padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:rgba(34,217,122,.08);color:#22d97a;font-size:12px;font-weight:800;cursor:pointer">Open</button>';
      h += '<button onclick="window._awningControl('+inst.id+',\'stop\')" style="padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Stop</button>';
      h += '<button onclick="window._awningControl('+inst.id+',\'close\')" style="padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:rgba(239,68,68,.08);color:#ef4444;font-size:12px;font-weight:800;cursor:pointer">Close</button>';
      h += '</div>';

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

  window._awningControl = awningControl;
  window.renderAwningModule = renderAwning;

})();
