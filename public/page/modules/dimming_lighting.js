// public/page/modules/dimming_lighting.js
// Dimming Lighting widget — aligned with Lighting module layout.
(function () {
  'use strict';

  var MODULE_ID = 'dimming_lighting';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function refreshDimming(instId) {
    if (typeof rerenderInstance === 'function') return Promise.resolve(rerenderInstance(instId));
    return Promise.resolve();
  }

  function dimmingAdjust(instId, direction) {
    return api('/automation/' + MODULE_ID + '/' + instId + '/adjust', {
      method: 'POST',
      body: JSON.stringify({ direction: direction })
    })
      .then(function () { return refreshDimming(instId); })
      .catch(function (e) {
        if (typeof toast === 'function') toast('Error: ' + e.message, 'err');
      });
  }

  function dimmingSetLevel(instId, level) {
    return api('/automation/' + MODULE_ID + '/' + instId + '/level', {
      method: 'POST',
      body: JSON.stringify({ level: Number(level) })
    })
      .then(function () { return refreshDimming(instId); })
      .catch(function (e) {
        if (typeof toast === 'function') toast('Error: ' + e.message, 'err');
      });
  }

  function renderDimmingLighting(inst) {
    return api('/automation/status/' + inst.id).then(function (liveData) {
      var values = liveData.values || {};
      var settings = liveData.settings || {};
      var state = liveData.state || {};

      var savedLevel = settings._level != null ? Number(settings._level) : null;
      var aoLevel = values.ao != null ? Number(values.ao) : null;
      var stateLevel = state.level != null ? Number(state.level) : null;
      var relayOn = values.do === 'ON' || values.do === '1' || values.do === 1 || values.do === true;
      var level = 0;
      if (Number.isFinite(aoLevel)) level = Math.round(aoLevel);
      else if (Number.isFinite(stateLevel)) level = Math.round(stateLevel);
      else if (Number.isFinite(savedLevel)) level = Math.round(savedLevel);
      level = Math.max(0, Math.min(100, level));

      var isOn = level > 0 || !!state.output_on || relayOn;
      var lastReason = state.last_reason || (liveData.lastLog && liveData.lastLog[0] && liveData.lastLog[0].reason) || 'No recent action';
      var reasonTitle = esc(lastReason);
      var testMode = String(settings.test_mode || '0') === '1';
      var source = /double-tap/i.test(lastReason) ? 'double-tap' : /widget/i.test(lastReason) ? 'widget' : 'buttons';
      var sourceLabelMap = { 'double-tap': 'Double-tap', widget: 'Widget', buttons: 'Buttons' };
      var step = Number(settings.step || 10);
      var upLevel = Number(settings.double_tap_up_level || 100);
      var downLevel = Number(settings.double_tap_down_level || 0);

      var h = '<div style="display:flex;flex-direction:column;gap:10px">';

      h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">';
      h += '<div>';
      h += '<div style="font-size:11px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">Lighting</div>';
      h += '<div title="' + reasonTitle + '" style="margin-top:3px;font-size:24px;font-weight:900;color:' + (isOn ? '#f5c842' : 'var(--muted2)') + '">' + level + '%</div>';
      h += '<div style="font-size:11px;color:var(--muted2);margin-top:2px">' + esc(sourceLabelMap[source] || 'Buttons') + ' • ' + esc(lastReason.length > 42 ? (lastReason.slice(0, 42) + '...') : lastReason) + '</div>';
      h += '</div>';
      h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">';
      h += '<button onclick="window._dimmingToggle(' + inst.id + ',' + (isOn ? 1 : 0) + ')" style="padding:9px 14px;border-radius:10px;border:1px solid ' + (isOn ? 'rgba(245,200,66,.5)' : 'var(--line2)') + ';background:' + (isOn ? 'rgba(245,200,66,.15)' : 'rgba(255,255,255,.05)') + ';color:' + (isOn ? '#f5c842' : 'var(--text)') + ';font-size:12px;font-weight:800;cursor:pointer">' + (isOn ? 'Turn OFF' : 'Turn ON') + '</button>';
      h += '</div>';
      h += '</div>';

      h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
      h += '<span style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:' + (isOn ? '#22d97a' : 'var(--muted2)') + '">' + (isOn ? 'LIGHT ON' : 'LIGHT OFF') + '</span>';
      if (testMode) h += '<span style="background:rgba(255,201,71,.08);border:1px solid rgba(255,201,71,.35);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#ffd978">TEST MODE</span>';
      if (relayOn) h += '<span style="background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.28);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:#22d97a">RELAY ON</span>';
      h += '<span style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:var(--muted2)">STEP ' + esc(step) + '%</span>';
      h += '</div>';

      h += '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center">';
      h += '<span style="font-size:11px;color:var(--muted2);font-weight:700">DIM</span>';
      h += '<input type="range" min="0" max="100" value="' + level + '" style="width:100%" oninput="this.nextElementSibling.textContent=this.value+\'%\'" onchange="window._dimmingSetLevel(' + inst.id + ',this.value)">';
      h += '<span style="font-size:11px;color:var(--muted2);min-width:38px;text-align:right">' + level + '%</span>';
      h += '</div>';

      h += '<div style="display:flex;gap:8px">';
      h += '<button class="btn btn-sm" style="flex:1" onclick="window._dimmingAdjust(' + inst.id + ',\'down\')">▼ Down</button>';
      h += '<button class="btn btn-sm" style="flex:1;background:#f5c842;color:#000;border-color:#f5c842" onclick="window._dimmingAdjust(' + inst.id + ',\'up\')">▲ Up</button>';
      h += '</div>';

      h += '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">';
      function miniStat(label, val, hi) {
        return '<div style="border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:10px;padding:8px 9px"><div style="font-size:10px;color:var(--muted2);font-weight:800;letter-spacing:.04em;text-transform:uppercase">' + label + '</div><div style="margin-top:3px;font-size:12px;font-weight:800;color:' + (hi ? '#22d97a' : 'var(--text)') + '">' + val + '</div></div>';
      }
      h += miniStat('Source', esc(sourceLabelMap[source] || 'Buttons'), false);
      h += miniStat('Double Up', esc(upLevel) + '%', upLevel > 0);
      h += miniStat('Double Down', esc(downLevel) + '%', downLevel > 0);
      h += '</div>';

      h += '</div>';
      return h;
    }).catch(function (e) {
      return '<div style="color:var(--bad);font-size:12px">Could not load dimming status: ' + esc(e.message) + '</div>';
    });
  }

  window.MODULE_ACCENT = window.MODULE_ACCENT || {};
  window.MODULE_ICON = window.MODULE_ICON || {};
  window.MODULE_ACCENT[MODULE_ID] = '#f5c842';
  window.MODULE_ICON[MODULE_ID] = '💡';

  window._dimmingAdjust = dimmingAdjust;
  window._dimmingSetLevel = dimmingSetLevel;
  window._dimmingToggle = function (instId, isOn) {
    return dimmingAdjust(instId, isOn ? 'off' : 'on');
  };
  window.renderDimmingLighting = renderDimmingLighting;
})();
