function ema(prev, x, alpha) {
  const a = Number(alpha);
  const aa = (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0.25);
  return prev + aa * (x - prev);
}
module.exports = { ema };
