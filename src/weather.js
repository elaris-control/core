// src/weather.js
// Server-side weather fetch from Open-Meteo (free, no API key)
// Caches result for 15 minutes to avoid hammering the API

const https = require("https");

let cache = {}; // key: "lat_lon" → { data, ts }
const CACHE_TTL = 15 * 60 * 1000; // 15 min

function fetchWeather(lat, lon) {
  return new Promise((resolve, reject) => {
    const url = `https://api.open-meteo.com/v1/forecast?` +
      `latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,` +
      `precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
      `&wind_speed_unit=kmh&timezone=auto&forecast_days=5`;

    https.get(url, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    }).on("error", reject);
  });
}

// WMO weather code → description + emoji
function interpretCode(code, isDay = true) {
  const map = {
    0:  { desc: "Clear sky",          emoji: isDay ? "☀️" : "🌙" },
    1:  { desc: "Mainly clear",       emoji: isDay ? "🌤️" : "🌙" },
    2:  { desc: "Partly cloudy",      emoji: "⛅" },
    3:  { desc: "Overcast",           emoji: "☁️" },
    45: { desc: "Foggy",              emoji: "🌫️" },
    48: { desc: "Icy fog",            emoji: "🌫️" },
    51: { desc: "Light drizzle",      emoji: "🌦️" },
    53: { desc: "Moderate drizzle",   emoji: "🌦️" },
    55: { desc: "Dense drizzle",      emoji: "🌧️" },
    61: { desc: "Slight rain",        emoji: "🌧️" },
    63: { desc: "Moderate rain",      emoji: "🌧️" },
    65: { desc: "Heavy rain",         emoji: "🌧️" },
    71: { desc: "Slight snow",        emoji: "🌨️" },
    73: { desc: "Moderate snow",      emoji: "❄️" },
    75: { desc: "Heavy snow",         emoji: "❄️" },
    80: { desc: "Slight showers",     emoji: "🌦️" },
    81: { desc: "Moderate showers",   emoji: "🌧️" },
    82: { desc: "Violent showers",    emoji: "⛈️" },
    95: { desc: "Thunderstorm",       emoji: "⛈️" },
    96: { desc: "Thunderstorm + hail",emoji: "⛈️" },
    99: { desc: "Thunderstorm + hail",emoji: "⛈️" },
  };
  return map[code] || { desc: "Unknown", emoji: "🌡️" };
}

function windDir(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

async function getWeather(lat, lon) {
  const key = `${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}`;
  const now  = Date.now();

  if (cache[key] && now - cache[key].ts < CACHE_TTL) {
    return { ...cache[key].data, cached: true };
  }

  const raw     = await fetchWeather(lat, lon);
  const cur     = raw.current;
  const daily   = raw.daily;
  const isDay   = cur.is_day === 1;
  const weather = interpretCode(cur.weather_code, isDay);

  const result = {
    current: {
      temp:        Math.round(cur.temperature_2m * 10) / 10,
      feels_like:  Math.round(cur.apparent_temperature * 10) / 10,
      humidity:    cur.relative_humidity_2m,
      precip:      cur.precipitation,
      cloud:       cur.cloud_cover,
      wind_speed:  Math.round(cur.wind_speed_10m),
      wind_dir:    windDir(cur.wind_direction_10m),
      wind_deg:    cur.wind_direction_10m,
      code:        cur.weather_code,
      desc:        weather.desc,
      emoji:       weather.emoji,
      is_day:      isDay,
    },
    forecast: (daily.time || []).slice(0, 5).map((date, i) => ({
      date,
      max:         Math.round(daily.temperature_2m_max[i]),
      min:         Math.round(daily.temperature_2m_min[i]),
      precip:      Math.round(daily.precipitation_sum[i] * 10) / 10,
      wind_max:    Math.round(daily.wind_speed_10m_max[i]),
      code:        daily.weather_code[i],
      emoji:       interpretCode(daily.weather_code[i], true).emoji,
      desc:        interpretCode(daily.weather_code[i], true).desc,
    })),
    timezone: raw.timezone,
    ts:       now,
    cached:   false,
  };

  cache[key] = { data: result, ts: now };
  return result;
}

module.exports = { getWeather };
