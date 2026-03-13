const { clamp } = require("./clamp");

// Move current toward target by at most maxDelta (absolute)
function rampTo(current, target, maxDelta) {
  const c = Number(current) || 0;
  const t = Number(target) || 0;
  const d = clamp(t - c, -Math.abs(maxDelta), Math.abs(maxDelta));
  return c + d;
}

module.exports = { rampTo };
