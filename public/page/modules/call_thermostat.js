// ── public/page/modules/call_thermostat.js ────────────────────────────
// Call Thermostat module renderer — uses shared W.* widgets.
// ───────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'call_thermostat';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function thermoControl(id, payload){
    return api('/automation/'+MODULE_ID+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)})
      .catch(function(e){ toast('Cannot control '+MODULE_ID); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(id); }, 220); });
  }

  function miniStat(label, val, hi){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(label)+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(hi?'#22d97a':'var(--text)')+'">'+esc(val)+'</div></div>';
  }

  async function renderCallThermostat(inst){
    var st = {};
    try { st = await api('/automation/status/'+inst.id); } catch(e){}

    var vals   = st.values  || {};
    var sp     = st.settings || {};
    var state  = st.state   || {};
    var paused = !!st.paused;

    var mode        = String(state.mode || sp.mode || 'heating').toLowerCase();
    var manualActive= !!state.manual_active || /manual/i.test(String(state.last_reason || ''));
    var lastReason  = state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action';
    var outputOn    = vals.ac_relay==='ON' || state.output_on===true;
    var callRaw = vals.zone_1_call;
    var callDemand = callRaw==='ON'||callRaw==='1'||callRaw==='true';
    var mid = MODULE_ID, iid = inst.id;

    var h = '<div style="display:flex;flex-direction:column;gap:10px">';

    // ═══ 1. HEADER ═══
    h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h += '<div>';
    h += '<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Call Thermostat</div>';
    h += '<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(callDemand?'#f5c842':'var(--muted2)')+'">'+(callDemand?'ON':'OFF')+'</div>';
    h += '<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(mode.charAt(0).toUpperCase()+mode.slice(1))+' &bull; '+esc(lastReason.length>42?(lastReason.slice(0,42)+'…'):lastReason)+'</div>';
    h += '</div>';

    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h += '<button onclick="window._ctControl('+iid+',{manual:'+(manualActive?false:true)+'})" style="padding:9px 14px;border-radius:10px;border:1px solid '+(manualActive?'rgba(245,158,11,.5)':'var(--line2)')+';background:'+(manualActive?'rgba(245,158,11,.15)':'rgba(255,255,255,.05)')+';color:'+(manualActive?'#f59e0b':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(manualActive?'Turn OFF':'Turn ON')+'</button>';
    if(manualActive) h += '<button onclick="window._ctControl('+iid+',{clear_manual:true})" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h += '</div>';
    h += '</div>';

    // ═══ 2. MODE PILLS ROW ═══
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h += '<button onclick="window._ctControl('+iid+',{mode:\'heating\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='heating'?'#f5c842':'var(--line)')+';background:'+(mode==='heating'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='heating'?'#f5c842':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Heating</button>';
    h += '<button onclick="window._ctControl('+iid+',{mode:\'cooling\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='cooling'?'#1d8cff':'var(--line)')+';background:'+(mode==='cooling'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='cooling'?'#1d8cff':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Cooling</button>';
    h += '<button onclick="window._ctControl('+iid+',{mode:\'off\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='off'?'#f59e0b':'var(--line)')+';background:'+(mode==='off'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='off'?'#f59e0b':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Off</button>';
    h += '<span style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:'+(outputOn?'#22d97a':'var(--muted2)')+'">'+(outputOn?'Output on':'Output off')+'</span>';
    if(manualActive) h += '<span style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#f59e0b">Manual</span>';
    h += '</div>';

    // ═══ 3. MINI STAT GRID ═══
    h += '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
    h += miniStat('Mode', mode.charAt(0).toUpperCase()+mode.slice(1), false);
    h += miniStat('Call', callDemand?'Active':'Idle', callDemand);
    h += miniStat('Output', outputOn?'On':'Off', outputOn);
    h += '</div>';

    // ═══ 4. PAUSE ═══
    if(canEngineerUI()) h += '<button onclick="togglePause('+inst.id+','+paused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';

    h += '</div>';
    return h;
  }

  window._ctControl = thermoControl;
  window.renderCallThermostatModule = renderCallThermostat;

})();
