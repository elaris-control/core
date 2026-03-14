// src/automation/awning.js
// 🌬️ Awning / Blind protection module
//
// Protects awnings/blinds from wind, rain, and controls sun shading
//
// Inputs:
//   relay_open   — relay to open/extend awning  (required)
//   relay_close  — relay to close/retract awning (required)
//   wind_sensor  — wind speed in km/h            (required)
//   rain_sensor  — rain detected (ON/OFF or mm)  (optional)
//   lux_sensor   — sun intensity in lux          (optional)
//   temp_outdoor — outdoor temp                  (optional)
//
// Setpoints:
//   wind_retract     — retract above this wind speed km/h (default: 40)
//   wind_deploy      — re-deploy below this speed (default: 20)
//   rain_retract     — retract on rain ON (default: true/1)
//   lux_deploy       — deploy (shade) above this lux (default: 50000)
//   lux_retract      — retract below this lux (default: 20000)
//   move_time        — seconds to fully open/close (default: 30)

const awningState  = new Map(); // instance_id → "open"|"closed"|"unknown"
const moveTimeout  = new Map(); // instance_id → timeout handle
const windHistory  = new Map(); // instance_id → [{ wind, ts }] for gust detection
const positionState  = new Map(); // instId → { pos, startTs, startPos, targetPos, direction }
const endstopPrev    = new Map(); // instId → { open: bool, close: bool }
const GUST_WINDOW_MS = 10000;  // 10s window for gust detection

function getCurrentPos(instId, moveTimeMs) {
  const ps = positionState.get(instId);
  if (!ps) return null;
  if (!ps.direction || !ps.startTs) return ps.pos;
  const travelNeeded = Math.abs(ps.targetPos - ps.startPos) / 100 * moveTimeMs;
  if (travelNeeded <= 0) return ps.targetPos;
  const progress = Math.min(1, (Date.now() - ps.startTs) / travelNeeded);
  const pos = ps.startPos + (ps.targetPos - ps.startPos) * progress;
  return Math.round(Math.max(0, Math.min(100, pos)));
}

function doOpen(instId, send, ctx, moveTimeMs, targetPos, reason) {
  const curPos = getCurrentPos(instId, moveTimeMs) ?? 0;
  if (curPos >= targetPos) return;
  positionState.set(instId, { pos: curPos, startTs: Date.now(), startPos: curPos, targetPos, direction: 'opening' });
  awningState.set(instId, 'opening');
  send('relay_close', 'OFF', 'stop close before deploying');
  send('relay_open',  'ON',  reason);
  if (moveTimeout.has(instId)) clearTimeout(moveTimeout.get(instId));
  const travelMs = Math.round((targetPos - curPos) / 100 * moveTimeMs) || moveTimeMs;
  moveTimeout.set(instId, setTimeout(() => {
    send('relay_open', 'OFF', 'deploy complete — stop relay');
    awningState.set(instId, targetPos >= 100 ? 'open' : 'partial');
    positionState.set(instId, { pos: targetPos, startTs: null, startPos: targetPos, targetPos, direction: null });
    try { ctx.setSetting('_position', String(targetPos)); } catch {}
  }, travelMs));
}

// ── Helpers ────────────────────────────────────────────────────────────
function doRetract(instId, send, ctx, moveTimeMs, reason) {
  const curPos = getCurrentPos(instId, moveTimeMs) ?? 100;
  positionState.set(instId, { pos: curPos, startTs: Date.now(), startPos: curPos, targetPos: 0, direction: 'closing' });
  awningState.set(instId, 'closing');
  send('relay_open',  'OFF', 'stop open before retracting');
  send('relay_close', 'ON',  reason);
  if (moveTimeout.has(instId)) clearTimeout(moveTimeout.get(instId));
  const travelMs = Math.round(curPos / 100 * moveTimeMs) || moveTimeMs;
  moveTimeout.set(instId, setTimeout(() => {
    send('relay_close', 'OFF', 'retract complete — stop relay');
    awningState.set(instId, 'closed');
    positionState.set(instId, { pos: 0, startTs: null, startPos: 0, targetPos: 0, direction: null });
    try { ctx.setSetting('_position', '0'); } catch {}
  }, travelMs));
}

function getSunTimes(lat, lon) {
  const D2R = Math.PI/180;
  const n   = Date.now()/86400000 - 10957;
  const L   = (280.460 + 0.9856474*n)%360;
  const g   = (357.528 + 0.9856003*n)%360;
  const lam = L + 1.915*Math.sin(g*D2R) + 0.020*Math.sin(2*g*D2R);
  const eps = 23.439 - 0.0000004*n;
  const sinDec = Math.sin(eps*D2R)*Math.sin(lam*D2R);
  const dec  = Math.asin(sinDec)*(180/Math.PI);
  const cosH = (Math.cos(90.833*D2R)-Math.sin(lat*D2R)*Math.sin(dec*D2R))/(Math.cos(lat*D2R)*Math.cos(dec*D2R));
  if (Math.abs(cosH) > 1) return null;
  const H    = Math.acos(cosH)*(180/Math.PI);
  const RA   = (Math.atan2(Math.cos(eps*D2R)*Math.sin(lam*D2R),Math.cos(lam*D2R))*(180/Math.PI)/15+24)%24;
  const eot  = (L/15-RA+24)%24;
  const noon = 12-eot-lon/15;
  return { sunrise: Math.round((noon-H/15)*60), sunset: Math.round((noon+H/15)*60) };
}

function awningHandler(ctx, send, siteInfo) {
  const isTestMode = ctx.settingStr('test_mode', '0') === '1';
  if (isTestMode) {
    send = (key, value, reason) => {
      console.log(`[AWNING TEST MODE] would send: ${key} = ${value}${reason ? ' // ' + reason : ''}`);
    };
  }

  const windRetract  = ctx.setting("wind_retract",   40);
  const windDeploy   = ctx.setting("wind_deploy",    20);
  const rainRetract  = ctx.setting("rain_retract",    1); // 1 = yes
  const luxDeploy    = ctx.setting("lux_deploy",   50000);
  const luxRetract   = ctx.setting("lux_retract",  20000);
  const moveTime     = ctx.setting("move_time",      30) * 1000;
  const gustEnable   = ctx.setting("gust_enable",     1); // 1 = yes
  const gustThresh   = ctx.setting("gust_threshold",  15); // km/h rise in window
  const nightRetract = ctx.setting("night_retract",   0); // 1 = retract at sunset
  const nightOffset  = ctx.setting("night_offset",    0); // minutes after sunset
  const deployPercent  = ctx.setting('deploy_percent', 100);

  const wind         = ctx.value("wind_sensor");
  const rain         = ctx.state("rain_sensor");
  const lux          = ctx.value("lux_sensor");
  const instId       = ctx.instance.id;
  const now          = Date.now();

  const currentState = awningState.get(instId) || "unknown";

  // Restore position from DB on first run
  if (!positionState.has(instId)) {
    const savedPos = ctx.setting('_position', NaN);
    const p = isNaN(savedPos) ? null : Math.max(0, Math.min(100, savedPos));
    positionState.set(instId, { pos: p, startTs: null, startPos: p ?? 0, targetPos: p ?? 0, direction: null });
    if (p !== null && p > 0 && currentState === 'unknown') awningState.set(instId, p >= 100 ? 'open' : 'partial');
    if (p === 0 && currentState === 'unknown') awningState.set(instId, 'closed');
  }

  // ── End-stop switches (optional DI) ────────────────────────────────
  const hasESOpen  = !!ctx.io('endstop_open');
  const hasESClose = !!ctx.io('endstop_close');
  if (hasESOpen || hasESClose) {
    const prevES = endstopPrev.get(instId) || { open: false, close: false };
    if (hasESOpen) {
      const esOpen = ctx.state('endstop_open') === 'ON' || ctx.state('endstop_open') === '1';
      if (esOpen && !prevES.open) {
        if (moveTimeout.has(instId)) clearTimeout(moveTimeout.get(instId));
        send('relay_open', 'OFF', 'End-stop: open position confirmed');
        awningState.set(instId, 'open');
        positionState.set(instId, { pos: 100, startTs: null, startPos: 100, targetPos: 100, direction: null });
        ctx.setSetting('_position', '100');
      }
      prevES.open = esOpen;
    }
    if (hasESClose) {
      const esClose = ctx.state('endstop_close') === 'ON' || ctx.state('endstop_close') === '1';
      if (esClose && !prevES.close) {
        if (moveTimeout.has(instId)) clearTimeout(moveTimeout.get(instId));
        send('relay_close', 'OFF', 'End-stop: closed position confirmed');
        awningState.set(instId, 'closed');
        positionState.set(instId, { pos: 0, startTs: null, startPos: 0, targetPos: 0, direction: null });
        ctx.setSetting('_position', '0');
      }
      prevES.close = esClose;
    }
    endstopPrev.set(instId, prevES);
  }

  // ── Gust detection ─────────────────────────────────────────────────
  if (wind !== null) {
    if (!windHistory.has(instId)) windHistory.set(instId, []);
    const hist = windHistory.get(instId);
    hist.push({ wind, ts: now });
    // Prune old entries
    const cutoff = now - GUST_WINDOW_MS;
    while (hist.length && hist[0].ts < cutoff) hist.shift();
  }

  // ── Night retract (sunset-based) ───────────────────────────────────
  if (nightRetract && siteInfo?.lat && siteInfo?.lon) {
    const sun = getSunTimes(Number(siteInfo.lat), Number(siteInfo.lon));
    if (sun) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const sunsetMin = sun.sunset + nightOffset;
      if (nowMin === sunsetMin && currentState !== "closed") {
        doRetract(instId, send, ctx, moveTime, "Night retract — sunset");
        return;
      }
    }
  }

  // ── Safety: ALWAYS retract on high wind or rain ────────────────────
  let mustRetract   = false;
  let retractReason = null;

  if (wind !== null && wind >= windRetract) {
    mustRetract   = true;
    retractReason = `Wind ${wind} km/h >= ${windRetract} km/h — safety retract`;
  }

  // Wind gust: if wind rose by gustThresh within GUST_WINDOW_MS
  if (!mustRetract && gustEnable && wind !== null && windHistory.has(instId)) {
    const hist = windHistory.get(instId);
    if (hist.length >= 2) {
      const oldest = hist[0].wind;
      const rise = wind - oldest;
      if (rise >= gustThresh) {
        mustRetract   = true;
        retractReason = `Wind gust detected: +${rise.toFixed(1)} km/h in ${(GUST_WINDOW_MS/1000)}s — emergency retract`;
      }
    }
  }

  if (rainRetract && (rain === "ON" || rain === "1" || rain === "true")) {
    mustRetract   = true;
    retractReason = `Rain detected — safety retract`;
  }

  if (mustRetract) {
    if (currentState !== "closed") doRetract(instId, send, ctx, moveTime, retractReason);
    return;
  }

  // ── Sun shading: deploy when sunny ──────────────────────────────────
  if (lux !== null) {
    if (lux >= luxDeploy && (currentState === 'closed' || currentState === 'unknown')) {
      doOpen(instId, send, ctx, moveTime, deployPercent, `Lux ${lux} >= ${luxDeploy} — deploy for shade`);
      return;
    }
    if (lux < luxRetract && currentState === "open") {
      doRetract(instId, send, ctx, moveTime, `Lux ${lux} < ${luxRetract} — retract (not enough sun)`);
    }
  }

  // ── Wind clear: re-deploy if wind ok and was safety-retracted ────────
  if (wind !== null && wind < windDeploy && (currentState === 'closed' || currentState === 'unknown') && lux !== null && lux >= luxDeploy) {
    doOpen(instId, send, ctx, moveTime, deployPercent, `Wind clear ${wind} km/h < ${windDeploy} km/h — safe to re-deploy`);
  }

  // Broadcast current position
  const curPos = getCurrentPos(instId, moveTime);
  const posStr = curPos !== null ? String(curPos) : (currentState === 'open' ? '100' : (currentState === 'closed' ? '0' : null));
  ctx.broadcastState?.({
    state:     currentState,
    position:  posStr !== null ? Number(posStr) : null,
    wind:      wind,
    lux:       lux,
    rain:      rain === 'ON' || rain === '1',
    last_reason: null
  });
}

const AWNING_MODULE = {
  id:          "awning",
  name:        "Awning / Blind Control",
  icon:        "🌬️",
  description: "Automatic awning/blind protection: retracts on wind or rain, deploys for sun shading.",
  color:       "#94a3b8",
  category:    "shading",
  inputs: [
    { key: "relay_open",    label: "Open Relay",      type: "relay",               required: true,
      description: "Relay that drives the motor to open (extend/deploy) the awning. Pulsed ON for the duration of travel time." },
    { key: "relay_close",   label: "Close Relay",     type: "relay",               required: true,
      description: "Relay that drives the motor to close (retract) the awning. Activated automatically on wind, rain, or at night." },
    { key: "wind_sensor",   label: "Wind Speed",      type: "sensor", unit: "km/h", required: true,
      description: "Anemometer reading in km/h. This is the primary safety input — the awning retracts immediately when wind exceeds the threshold." },
    { key: "rain_sensor",   label: "Rain Sensor",     type: "sensor",              required: false,
      description: "Rain or moisture detector. When activated (ON/1), the awning retracts to protect the fabric from rain damage." },
    { key: "lux_sensor",    label: "Sun Intensity",   type: "sensor", unit: "lux", required: false,
      description: "Ambient light sensor in lux. Used to automatically deploy the awning for shade when sunlight is intense." },
    { key: "temp_outdoor",  label: "Outdoor Temp",    type: "sensor", unit: "°C",  required: false,
      description: "Outdoor temperature sensor. Currently reserved for future logic (e.g. prevent deployment below freezing)." },
    { key: 'endstop_open',  label: 'End-stop: Open (DI)',  type: 'sensor', required: false,
      description: 'Optional digital input from a limit switch that confirms the awning has reached the fully open position. When triggered, the motor relay stops and position is set to 100%.' },
    { key: 'endstop_close', label: 'End-stop: Closed (DI)', type: 'sensor', required: false,
      description: 'Optional digital input from a limit switch that confirms the awning is fully closed/retracted. When triggered, the motor relay stops and position is set to 0%.' },
  ],
  setpoints: [
    { key: "wind_retract",  label: "Retract above wind",     type: "number", unit: "km/h", step: 5,     default: 40,
      help: "Wind speed threshold for safety retraction. When wind reaches or exceeds this value the awning retracts immediately, regardless of sun conditions." },
    { key: "wind_deploy",   label: "Re-deploy below wind",   type: "number", unit: "km/h", step: 5,    default: 20,
      help: "After a wind retraction, the awning will only redeploy when wind drops below this value. Must be lower than 'Retract above wind' to avoid oscillation." },
    { key: "rain_retract",  label: "Retract on rain",        type: "select", options: ["1","0"],         default: "1",
      help: "Enable automatic retraction when the rain sensor is triggered. Protects fabric from moisture damage." },
    { key: "lux_deploy",    label: "Deploy above lux",       type: "number", unit: "lux",  step: 5000,  default: 50000,
      help: "Sun intensity above which the awning deploys to provide shade. Typical full sun is 70,000–100,000 lux." },
    { key: "lux_retract",   label: "Retract below lux",      type: "number", unit: "lux",  step: 5000,  default: 20000,
      help: "When sunlight drops below this level the awning retracts (sun is no longer strong enough to need shade). Must be lower than 'Deploy above lux' to avoid oscillation." },
    { key: "move_time",     label: "Travel time",            type: "number", unit: "sec",  step: 5,     default: 30,
      help: "Time in seconds for the awning to fully open or close. The relay is held ON for this duration on each movement command. Measure your awning's actual travel time." },
    { key: "gust_enable",    label: "Wind gust protection",  type: "select", options: ["1","0"],         default: "1",
      help: "Detects sudden wind gusts (rapid speed increase) and triggers an emergency retraction, even if average wind is below the main threshold." },
    { key: "gust_threshold", label: "Gust rise to trigger",  type: "number", unit: "km/h", step: 5,     default: 15,
      help: "Wind speed rise within 10 seconds that counts as a gust. Example: if wind goes from 20 to 35 km/h in 10s (+15), the awning retracts." },
    { key: "night_retract",  label: "Night retract",         type: "select", options: ["1","0"],         default: "0",
      help: "Automatically retracts the awning at sunset (requires site GPS coordinates to be set). Useful for overnight protection." },
    { key: "night_offset",   label: "Night retract offset",  type: "number", unit: "min",  step: 5,     default: 0,
      help: "Minutes after sunset to trigger night retraction. Negative values retract before sunset (e.g. -30 = 30 min before sunset)." },
    { key: 'deploy_percent', label: 'Deploy to position', type: 'number', unit: '%', step: 5, default: 100,
      help: 'How far to open the awning when deploying (0=closed, 100=fully open). Set to e.g. 50 for half-open partial shading. Requires accurate travel time (move_time) to be effective.' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      help: 'When ON, automation decisions run normally but no real awning commands are sent to outputs.' },
  ],
};

module.exports = { awningHandler, AWNING_MODULE };
