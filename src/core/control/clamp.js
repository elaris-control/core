function clamp(x, lo, hi) {
  if (x === null || x === undefined || Number.isNaN(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
module.exports = { clamp };
