// ── public/page/modules/zoned_thermostat.js ───────────────────────────────
// Zoned Thermostat module renderer — uses shared W.* widgets.
// Delegates to the unified thermostat renderer.
// ───────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  var MODULE_ID = 'zoned_thermostat';

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function thermoControl(id, payload){
    return api('/automation/'+MODULE_ID+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)})
      .catch(function(e){ toast('Cannot control '+MODULE_ID); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(id); }, 220); });
  }

  function miniStat(label, val, hi){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+esc(label)+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(hi?'#22d97a':'var(--text)')+'">'+esc(val)+'</div></div>';
  }

  async function renderZonedThermostat(inst){
    var st = {};
    try { st = await api('/automation/status/'+inst.id); } catch(e){}

    var vals   = st.values  || {};
    var sp     = st.settings || {};
    var state  = st.state   || {};
    var paused = !!st.paused;

    var mode        = String(state.mode || sp.mode || 'heating').toLowerCase();
    var setpoint    = sp.setpoint != null ? Number(sp.setpoint) : 21;
    var manualActive= !!state.manual_active || /manual/i.test(String(state.last_reason || ''));
    var lastReason  = state.last_reason || (st.lastLog&&st.lastLog[0]&&st.lastLog[0].reason) || 'No recent action';
    var outputOn    = vals.ac_relay==='ON' || vals.zone_1_output==='ON' || state.output_on===true;
    var tRoom = vals.temp_room != null ? parseFloat(vals.temp_room).toFixed(1) : null;
    var mid = MODULE_ID, iid = inst.id;

    var h = '<div style="display:flex;flex-direction:column;gap:10px">';

    // ═══ 1. HEADER ═══
    h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h += '<div>';
    h += '<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Zoned Thermostat</div>';
    h += '<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(outputOn?'#f5c842':'var(--muted2)')+'">'+(tRoom?tRoom+'°':(outputOn?'ON':'OFF'))+'</div>';
    h += '<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+esc(mode.charAt(0).toUpperCase()+mode.slice(1))+' &bull; '+esc(lastReason.length>42?(lastReason.slice(0,42)+'…'):lastReason)+'</div>';
    h += '</div>';

    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
    h += '<button onclick="window._ztControl('+iid+',{manual:'+(manualActive?false:true)+'})" style="padding:9px 14px;border-radius:10px;border:1px solid '+(manualActive?'rgba(245,158,11,.5)':'var(--line2)')+';background:'+(manualActive?'rgba(245,158,11,.15)':'rgba(255,255,255,.05)')+';color:'+(manualActive?'#f59e0b':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(manualActive?'Turn OFF':'Turn ON')+'</button>';
    if(manualActive) h += '<button onclick="window._ztControl('+iid+',{clear_manual:true})" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    h += '</div>';
    h += '</div>';

    // ═══ 2. MODE PILLS ROW ═══
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h += '<button onclick="window._ztControl('+iid+',{mode:\'heating\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='heating'?'#f5c842':'var(--line)')+';background:'+(mode==='heating'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='heating'?'#f5c842':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Heating</button>';
    h += '<button onclick="window._ztControl('+iid+',{mode:\'cooling\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='cooling'?'#1d8cff':'var(--line)')+';background:'+(mode==='cooling'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='cooling'?'#1d8cff':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Cooling</button>';
    h += '<button onclick="window._ztControl('+iid+',{mode:\'off\'})" style="padding:7px 10px;border-radius:999px;border:1px solid '+(mode==='off'?'#f59e0b':'var(--line)')+';background:'+(mode==='off'?'rgba(255,255,255,.08)':'rgba(255,255,255,.03)')+';color:'+(mode==='off'?'#f59e0b':'var(--muted2)')+';font-size:11px;font-weight:800;cursor:pointer">Off</button>';
    h += '<span style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:'+(outputOn?'#22d97a':'var(--muted2)')+'">'+(outputOn?'Output on':'Output off')+'</span>';
    if(manualActive) h += '<span style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#f59e0b">Manual</span>';
    h += '</div>';

    // ═══ 3. SETPOINT ═══
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)">';
    h += '<span style="font-size:12px;color:var(--muted2)">Setpoint</span>';
    h += '<div style="display:flex;align-items:center;gap:8px">';
    h += '<button onclick="window._ztControl('+iid+',{setpoint:'+(Math.round((setpoint-0.5)*10)/10)+'})" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:18px">-</button>';
    h += '<span style="font-size:22px;font-weight:900;min-width:56px;text-align:center;color:#f5c842">'+setpoint.toFixed(1)+'°</span>';
    h += '<button onclick="window._ztControl('+iid+',{setpoint:'+(Math.round((setpoint+0.5)*10)/10)+'})" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:rgba(255,255,255,.05);cursor:pointer;font-size:18px">+</button>';
    h += '</div></div>';

    // ═══ 4. MINI STAT GRID ═══
    h += '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
    var cz = Number(state.calling_zones||0);
    var tz = Number(state.configured_zones||0);
    var di = Number(state.di_calling||0);
    var tc = Number(state.temp_calling||0);
    h += miniStat('Mode', mode.charAt(0).toUpperCase()+mode.slice(1), false);
    h += miniStat('Zones', cz+' / '+tz, cz>0);
    var srcTxt = di>0&&tc>0 ? di+' DI + '+tc+' Temp' : di>0 ? di+' DI' : tc>0 ? tc+' Temp' : 'Idle';
    h += miniStat('Source', srcTxt, cz>0);
    h += '</div>';

    // ═══ 5. ZONE CARDS ═══
    var zoneH = '';
    for(var n = 1; n <= 6; n++){
      var zName  = String(sp['zone_'+n+'_name'] || sp['_zone_'+n+'_name'] || '').trim() || 'Zone '+n;
      var zStatus= String(sp['_zone_'+n+'_status'] || '').trim();
      var zSource= String(sp['_zone_'+n+'_source'] || '').trim();
      var zReason= String(sp['_zone_'+n+'_reason']  || '').trim();
      var zTemp  = vals['zone_'+n+'_temp'];
      zTemp = zTemp!=null && Number.isFinite(Number(zTemp)) ? Number(zTemp) : null;
      var zSp    = sp['_zone_'+n+'_setpoint'] || sp['zone_'+n+'_setpoint'];
      zSp = (zSp!=null && zSp!=='' && Number.isFinite(Number(zSp))) ? Number(zSp) : null;
      var effSp = zSp != null ? zSp : setpoint;
      var isOnZ = zStatus === 'on';
      if(!zStatus) continue;

      zoneH += '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px">';
      zoneH += '<div style="display:flex;justify-content:space-between;align-items:center">';
      zoneH += '<div style="font-size:11px;font-weight:900;color:var(--text)">'+esc(zName)+'</div>';
      var zManual = sp['_zone_'+n+'_manual'] === '1';
      zoneH += '<div style="display:flex;gap:4px;align-items:center">';
      zoneH += '<div style="font-size:10px;font-weight:800;color:'+(isOnZ?'#22d97a':'var(--muted2)')+'">'+zStatus.toUpperCase()+'</div>';
      zoneH += '<button onclick="window._ztControl('+iid+',{zone_manual:'+n+',on:'+(!zManual)+'})" style="padding:2px 6px;border-radius:999px;border:1px solid '+(zManual?'rgba(245,158,11,.5)':'var(--line2)')+';background:'+(zManual?'rgba(245,158,11,.15)':'rgba(255,255,255,.05)')+';color:'+(zManual?'#f59e0b':'var(--muted2)')+';font-size:9px;font-weight:800;cursor:pointer">'+(zManual?'M':'A')+'</button>';
      zoneH += '</div>';
      zoneH += '</div>';
      zoneH += '<div style="margin-top:6px;display:flex;justify-content:space-between">';
      zoneH += '<div><div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Room</div><div style="font-size:14px;font-weight:900;color:'+(zTemp!=null?'var(--text)':'#ef4444')+'">'+(zTemp!=null?zTemp.toFixed(1)+'°':'ERR')+'</div></div>';
      var sM = Math.round((effSp-0.5)*10)/10, sP = Math.round((effSp+0.5)*10)/10;
      zoneH += '<div style="text-align:right"><div style="font-size:10px;color:var(--muted2);text-transform:uppercase">Setpoint'+(zSp==null?' <span style="font-size:9px;opacity:.6">(global)</span>':'')+'</div>';
      zoneH += '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;margin-top:2px">';
      zoneH += '<button onclick="var p={};p[\'zone_'+n+'_setpoint\']='+sM+';window._ztControl('+iid+',p)" style="padding:2px 7px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">−</button>';
      zoneH += '<span style="font-size:14px;font-weight:900;color:#f5c842;min-width:34px;text-align:center">'+effSp.toFixed(1)+'°</span>';
      zoneH += '<button onclick="var p={};p[\'zone_'+n+'_setpoint\']='+sP+';window._ztControl('+iid+',p)" style="padding:2px 7px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:11px;font-weight:800;cursor:pointer">+</button>';
      zoneH += '</div></div>';
      zoneH += '</div>';
      if(zReason) zoneH += '<div style="margin-top:6px;font-size:10px;color:var(--muted2)">'+esc(zReason.length>32?(zReason.slice(0,32)+'…'):zReason)+'</div>';
      zoneH += '</div>';
    }
    if(zoneH) h += '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">'+zoneH+'</div>';

    // ═══ 6. PAUSE ═══
    if(canEngineerUI()) h += '<button onclick="togglePause('+inst.id+','+paused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';

    h += '</div>';
    return h;
  }

  window._ztControl = thermoControl;
  window.renderZonedThermostatModule = renderZonedThermostat;

})();
