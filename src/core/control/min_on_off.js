/**
 * Enforce minimum ON and OFF times to avoid short cycling.
 * Time unit: milliseconds.
 */
class MinOnOff {
  constructor({ minOnMs = 0, minOffMs = 0 } = {}) {
    this.state = false;      // current ON/OFF state
    this.lastChange = 0;     // timestamp in ms
    this.minOnMs = minOnMs;
    this.minOffMs = minOffMs;
  }

  update(nowMs, desiredOn) {
    const now = nowMs || Date.now();
    const desired = !!desiredOn;

    if (desired === this.state) return this.state;

    const elapsed = now - (this.lastChange || 0);

    if (this.state) {
      // currently ON, want OFF
      if (elapsed < this.minOnMs) return true;
    } else {
      // currently OFF, want ON
      if (elapsed < this.minOffMs) return false;
    }

    this.state = desired;
    this.lastChange = now;
    return this.state;
  }
}

module.exports = { MinOnOff };
