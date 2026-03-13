/**
 * Low-ON / High-OFF hysteresis (heating style):
 * - If currently OFF and value <= onBelow -> turn ON
 * - If currently ON  and value >= offAbove -> turn OFF
 * - Otherwise keep state
 */
function hystLowOn(currentOn, value, onBelow, offAbove) {
  const v = Number(value);
  if (!Number.isFinite(v)) return !!currentOn;
  if (!currentOn && v <= onBelow) return true;
  if ( currentOn && v >= offAbove) return false;
  return !!currentOn;
}

/**
 * High-ON / Low-OFF hysteresis (cooling / delta style):
 * - If currently OFF and value >= onAbove -> ON
 * - If currently ON  and value <= offBelow -> OFF
 */
function hystHighOn(currentOn, value, onAbove, offBelow) {
  const v = Number(value);
  if (!Number.isFinite(v)) return !!currentOn;
  if (!currentOn && v >= onAbove) return true;
  if ( currentOn && v <= offBelow) return false;
  return !!currentOn;
}

module.exports = { hystLowOn, hystHighOn };
