// src/automation/helpers/thermostat_common.js
// Shared helpers for thermostat family modules.

const MAX_ZONES = 6;

const lastOnTime  = new Map();
const lastOffTime = new Map();

function parseDemandState(raw) {
  if (raw == null) return null;
  const up = String(raw).trim().toUpperCase();
  if (!up) return null;
  if (['ON', '1', 'TRUE', 'OPEN', 'CALL', 'HEAT', 'YES'].includes(up)) return true;
  if (['OFF', '0', 'FALSE', 'CLOSED', 'CLOSE', 'NO'].includes(up)) return false;
  return null;
}

function applyMinRunOff(currentActive, desiredActive, key, minRunMs, minOffMs) {
  const now = Date.now();
  if (currentActive === desiredActive) return desiredActive;
  if (currentActive  && lastOnTime.has(key)  && (now - lastOnTime.get(key)  < minRunMs)) return true;
  if (!currentActive && lastOffTime.has(key) && (now - lastOffTime.get(key) < minOffMs)) return false;
  return desiredActive;
}

function rememberTransition(key, active) {
  const now = Date.now();
  if (active) { lastOnTime.set(key, now);  lastOffTime.delete(key); }
  else        { lastOnTime.delete(key);     lastOffTime.set(key, now); }
}

function applySetpointDelta(engine, instanceId, mappings, delta) {
  if (!Number.isFinite(delta) || Math.abs(delta) > 5) return null;
  const curGlobal = Number(engine.getSetting(instanceId, 'setpoint') ?? 21);
  const newGlobal = Math.max(5, Math.min(45, Math.round((curGlobal + delta) * 10) / 10));
  engine.setSetting(instanceId, 'setpoint', String(newGlobal));
  const out = { setpoint: newGlobal };
  const allMappings = mappings || [];
  for (let z = 1; z <= MAX_ZONES; z++) {
    const hasTempSensor = allMappings.some(m => m.input_key === `zone_${z}_temp` && m.io_id);
    if (!hasTempSensor) continue;
    const cur = engine.getSetting(instanceId, `zone_${z}_setpoint`);
    const curV = (cur !== null && cur !== '' && cur !== undefined && Number.isFinite(Number(cur))) ? Number(cur) : curGlobal;
    const newV = Math.max(5, Math.min(45, Math.round((curV + delta) * 10) / 10));
    engine.setSetting(instanceId, `zone_${z}_setpoint`, String(newV));
    out[`zone_${z}_setpoint`] = newV;
  }
  return out;
}

module.exports = { parseDemandState, applyMinRunOff, rememberTransition, MAX_ZONES, applySetpointDelta };
