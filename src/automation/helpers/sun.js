// src/automation/helpers/sun.js
// Sun calculation — shared by smart_lighting, lighting, awning, pool_spa, custom.

const sunCache = new Map();

function getSun(lat, lon) {
  if (!lat || !lon) return null;
  const key = new Date().toISOString().slice(0, 10) + '_' + lat + '_' + lon;
  if (!sunCache.has(key)) {
    sunCache.set(key, calcSun(Number(lat), Number(lon)));
    if (sunCache.size > 10) sunCache.delete(sunCache.keys().next().value);
  }
  return sunCache.get(key);
}

function calcSun(lat, lon) {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const latRad = lat * Math.PI / 180;
  const decRad = declination * Math.PI / 180;
  const cosHA = -Math.tan(latRad) * Math.tan(decRad);
  if (cosHA < -1 || cosHA > 1) return { sunrise: 6 * 60, sunset: 18 * 60 };
  const ha = Math.acos(cosHA) * 180 / Math.PI;
  const eqTime = 9.87 * Math.sin(2 * (2 * Math.PI / 365) * (dayOfYear - 81))
               - 7.53 * Math.cos((2 * Math.PI / 365) * (dayOfYear - 81))
               - 1.5  * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const tzOffset = -now.getTimezoneOffset();
  const solarNoon = 12 * 60 - (lon / 15) * 60 - eqTime + tzOffset;
  return {
    sunrise: Math.round(solarNoon - (ha / 15) * 60),
    sunset:  Math.round(solarNoon + (ha / 15) * 60),
  };
}

function parseSunTime(str, sun) {
  if (!str || !str.trim()) return null;
  str = str.trim();
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  }
  const base = str.startsWith('sunrise') ? sun?.sunrise : str.startsWith('sunset') ? sun?.sunset : null;
  if (base == null) return null;
  const m = str.match(/([+-]\d+)/);
  return base + (m ? parseInt(m[1]) : 0);
}

module.exports = { getSun, calcSun, parseSunTime, sunCache };
