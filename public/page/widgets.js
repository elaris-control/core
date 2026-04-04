// ── public/page/widgets.js ──────────────────────────────────────────────
// Shared UI components for ALL module instance cards.
// Consistent layout, typography, and interaction patterns.
// Each module renderer only provides DATA — widgets handle the HTML.
// ────────────────────────────────────────────────────────────────────────

(function(){
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function escHtml(s){ return esc(s); }
  function $(id){ return document.getElementById(id); }

  // ── Layout Primitives ────────────────────────────────────────────────

  /**
   * Card header: module label, big value, subtitle, action buttons.
   * This is the TOP section of every module card.
   *
   * @param {object} opts
   *   opts.label       — string, e.g. "Lighting", "Thermostat"
   *   opts.value       — string, e.g. "ON", "23.5°", "42%"
   *   opts.valueColor  — css color for the big value
   *   opts.subtitle    — string, e.g. "Auto • Within hysteresis band"
   *   opts.actions     — array of { label, color, bg, border, onclick }
   */
  function cardHeader(opts){
    var h = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
    h += '<div>';
    h += '<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+escHtml(opts.label)+'</div>';
    h += '<div style="margin-top:3px;font-size:24px;font-weight:900;color:'+(opts.valueColor||'var(--text)')+'">'+escHtml(opts.value)+'</div>';
    if(opts.subtitle) h += '<div style="font-size:11px;color:var(--muted2);margin-top:2px">'+escHtml(opts.subtitle.length>42?(opts.subtitle.slice(0,42)+'…'):opts.subtitle)+'</div>';
    h += '</div>';
    if(opts.actions && opts.actions.length){
      h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
      opts.actions.forEach(function(a){
        h += '<button onclick="'+a.onclick+'" style="padding:9px 14px;border-radius:10px;border:1px solid '+(a.border||'var(--line2)')+';background:'+(a.bg||'rgba(255,255,255,.05)')+';color:'+(a.color||'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+escHtml(a.label)+'</button>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  /**
   * Chip row: small pill badges for state indicators.
   *
   * @param {Array} chips — array of { label, color, borderColor, bgColor }
   */
  function chipRow(chips){
    if(!chips || !chips.length) return '';
    var h = '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    chips.forEach(function(c){
      h += '<span style="background:'+(c.bgColor||'rgba(255,255,255,.04)')+';border:1px solid '+(c.borderColor||'var(--line)')+';border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:'+(c.color||'var(--muted2)')+'">'+escHtml(c.label)+'</span>';
    });
    h += '</div>';
    return h;
  }

  /**
   * Mini stat card: 3-column grid item (label + value).
   *
   * @param {string} label
   * @param {string} value
   * @param {boolean} highlight — green text when true
   */
  function miniStat(label, value, highlight){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+escHtml(label)+'</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:'+(highlight?'#22d97a':'var(--text)')+'">'+escHtml(value)+'</div></div>';
  }

  /**
   * Stat grid: wraps miniStat calls in a responsive grid.
   *
   * @param {Array} items — array of { label, value, highlight }
   * @param {number} cols — default 3
   */
  function statGrid(items, cols){
    if(!items || !items.length) return '';
    var h = '<div style="display:grid;grid-template-columns:repeat('+(cols||3)+',minmax(0,1fr));gap:6px">';
    items.forEach(function(it){ h += miniStat(it.label, it.value, it.highlight); });
    h += '</div>';
    return h;
  }

  /**
   * Mode button row: pill-shaped toggle buttons.
   *
   * @param {string} instId
   * @param {string} currentMode
   * @param {Array} modes — array of { key, label, color }
   * @param {string} setFn — JS function name to call, e.g. "setLightingMode"
   */
  function modeBtnRow(instId, currentMode, modes, setFn){
    var h = '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    modes.forEach(function(m){
      var active = String(currentMode||'').toLowerCase() === String(m.key||'').toLowerCase();
      var bg = active ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)';
      var border = active ? m.color : 'var(--line)';
      var color = active ? m.color : 'var(--muted2)';
      h += '<button onclick="'+setFn+'('+instId+',\''+m.key+'\')" style="padding:7px 10px;border-radius:999px;border:1px solid '+border+';background:'+bg+';color:'+color+';font-size:11px;font-weight:800;cursor:pointer">'+escHtml(m.label)+'</button>';
    });
    h += '</div>';
    return h;
  }

  /**
   * Thermo mode buttons: heating / cooling / off (3-column grid).
   *
   * @param {string} instId
   * @param {string} moduleId
   * @param {string} currentMode
   */
  function thermoModeBtns(instId, moduleId, currentMode){
    var modes = [
      { key:'heating', label:'🔥 Heat', color:'#f5c842', bg:'rgba(245,200,66,.14)', border:'rgba(245,200,66,.45)' },
      { key:'cooling', label:'❄ Cool', color:'#1d8cff', bg:'rgba(29,140,255,.14)', border:'rgba(29,140,255,.45)' },
      { key:'off',     label:'⏻ Off',  color:'#f59e0b', bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.4)' },
    ];
    var h = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">';
    modes.forEach(function(m){
      var active = currentMode === m.key;
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{mode:\''+m.key+'\'})" style="padding:9px 12px;border-radius:16px;border:1px solid '+(active?m.border:'var(--line2)')+';background:'+(active?m.bg:'rgba(255,255,255,.05)')+';color:'+(active?m.color:'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+m.label+'</button>';
    });
    h += '</div>';
    return h;
  }

  /**
   * Manual control row: "Manual ON" + "Clear Manual" buttons.
   *
   * @param {string} instId
   * @param {string} moduleId
   * @param {boolean} manualActive
   */
  function manualControlRow(instId, moduleId, manualActive){
    var h = '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">';
    h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{manual:'+(manualActive?false:true)+'})" style="padding:8px 12px;border-radius:12px;border:1px solid '+(manualActive?'rgba(245,158,11,.5)':'var(--line2)')+';background:'+(manualActive?'rgba(245,158,11,.15)':'rgba(255,255,255,.05)')+';color:'+(manualActive?'#f59e0b':'var(--text)')+';font-size:12px;font-weight:800;cursor:pointer">'+(manualActive?'Manual ON (active)':'Manual ON')+'</button>';
    if(manualActive){
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{clear_manual:true})" style="padding:8px 12px;border-radius:12px;border:1px solid rgba(245,158,11,.28);background:rgba(245,158,11,.08);color:#f59e0b;font-size:12px;font-weight:800;cursor:pointer">Clear Manual</button>';
    }
    h += '</div>';
    return h;
  }

  /**
   * Pause/resume button (engineer only).
   */
  function pauseBtn(instId, paused){
    return '<button onclick="togglePause('+instId+','+paused+')" style="width:100%;margin-top:2px;padding:8px;border-radius:9px;border:1px solid '+(paused?'rgba(245,158,11,.4)':'var(--line2)')+';background:'+(paused?'rgba(245,158,11,.1)':'rgba(255,255,255,.03)')+';color:'+(paused?'#f59e0b':'var(--muted2)')+';font-size:12px;font-weight:800;cursor:pointer">'+(paused?'▶ Resume':'⏸ Pause Automation')+'</button>';
  }

  /**
   * Setpoint control: − / value / + row.
   */
  function setpointControl(instId, moduleId, value, delta, useDelta){
    var h = '<div style="display:flex;align-items:center;gap:6px;margin-top:5px">';
    if(useDelta){
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{setpoint_delta:'+-delta+'})" style="padding:2px 10px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:14px;font-weight:800;cursor:pointer">−</button>';
      h += '<span style="font-size:16px;font-weight:900;color:#f5c842;min-width:38px;text-align:center">'+value.toFixed(1)+'°</span>';
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{setpoint_delta:'+delta+'})" style="padding:2px 10px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:14px;font-weight:800;cursor:pointer">+</button>';
    } else {
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{setpoint:'+(Math.round((value-delta)*10)/10)+'})" style="padding:2px 10px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:14px;font-weight:800;cursor:pointer">−</button>';
      h += '<span style="font-size:16px;font-weight:900;color:#f5c842;min-width:38px;text-align:center">'+value.toFixed(1)+'°</span>';
      h += '<button onclick="thermoControl(\''+moduleId+'\','+instId+',{setpoint:'+(Math.round((value+delta)*10)/10)+'})" style="padding:2px 10px;border-radius:8px;border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--text);font-size:14px;font-weight:800;cursor:pointer">+</button>';
    }
    h += '</div>';
    return h;
  }

  /**
   * Info card: bordered box with label + value (used in thermostat, etc.)
   */
  function infoCard(label, value, color){
    return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:12px;padding:10px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">'+escHtml(label)+'</div><div style="margin-top:5px;font-size:14px;font-weight:900;color:'+(color||'var(--text)')+'">'+escHtml(value)+'</div></div>';
  }

  /**
   * Detail row: label on left, value on right, with top border.
   */
  function detailRow(label, value, valueColor){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)"><span style="font-weight:700">'+escHtml(label)+'</span><span style="font-weight:800;font-size:14px;color:'+(valueColor||'var(--text)')+'">'+escHtml(value)+'</span></div>';
  }

  // ── Thermo control helper (global) ──────────────────────────────────
  window.thermoControl = function(moduleId, id, payload){
    return api('/automation/'+moduleId+'/'+id+'/control',{method:'POST',body:JSON.stringify(payload)})
      .catch(function(e){ toast('Cannot control '+moduleId); })
      .finally(function(){ setTimeout(function(){ rerenderInstance(id); }, 220); });
  };

  // ── Pause toggle (global) ───────────────────────────────────────────
  window.togglePause = function(id, cur){
    api('/automation/override/'+id,{method:'POST',body:JSON.stringify({paused:!cur})})
      .catch(function(e){ toast('Error: '+e.message); })
      .finally(function(){ rerenderInstance(id); });
  };

  // ── Exports ─────────────────────────────────────────────────────────
  window.W = {
    esc: escHtml,
    cardHeader: cardHeader,
    chipRow: chipRow,
    miniStat: miniStat,
    statGrid: statGrid,
    modeBtnRow: modeBtnRow,
    thermoModeBtns: thermoModeBtns,
    manualControlRow: manualControlRow,
    pauseBtn: pauseBtn,
    setpointControl: setpointControl,
    infoCard: infoCard,
    detailRow: detailRow,
  };

})();
