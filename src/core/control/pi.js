const { clamp } = require("./clamp");

/**
 * PI step with basic anti-windup.
 * Returns { out, iTerm }.
 */
function piStep({ err, kp = 1, ki = 0.1, iTerm = 0, dtS = 1, outMin = 0, outMax = 100 }) {
  const e  = Number(err) || 0;
  const dt = Math.max(0.05, Number(dtS) || 1);
  const p  = kp * e;

  let i = Number(iTerm) || 0;
  const iCandidate = i + ki * e * dt;

  const outCandidate = clamp(p + iCandidate, outMin, outMax);

  const saturatedHigh = outCandidate >= outMax - 1e-9;
  const saturatedLow  = outCandidate <= outMin + 1e-9;

  // If saturated and error would drive further into saturation, freeze integrator
  if ((saturatedHigh && e > 0) || (saturatedLow && e < 0)) {
    return { out: clamp(p + i, outMin, outMax), iTerm: i };
  }

  return { out: outCandidate, iTerm: iCandidate };
}

module.exports = { piStep };
