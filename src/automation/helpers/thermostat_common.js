// src/automation/helpers/thermostat_common.js
// Shared helpers for thermostat family modules.

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

module.exports = { parseDemandState, applyMinRunOff, rememberTransition };
