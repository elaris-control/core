'use strict';

const onceState = new Map(); // scopeKey -> lastFireToken

function getSiteParts(siteInfo) {
  try {
    const forced = siteInfo?.__test_parts;
    if (forced && typeof forced === 'object') {
      const base = (() => {
        try {
          const tz = siteInfo?.timezone || null;
          if (!tz) throw new Error('no-timezone');
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
          }).formatToParts(new Date());
          const obj = {};
          for (const p of parts) if (p.type !== 'literal') obj[p.type] = p.value;
          return {
            year: Number(obj.year),
            month: Number(obj.month),
            day: Number(obj.day),
            hour: Number(obj.hour),
            minute: Number(obj.minute),
            weekday: String(obj.weekday || '').slice(0, 3).toLowerCase(),
          };
        } catch {
          const d = new Date();
          const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          return {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hour: d.getHours(),
            minute: d.getMinutes(),
            weekday: days[d.getDay()],
          };
        }
      })();
      return {
        year: Number.isFinite(Number(forced.year)) ? Number(forced.year) : base.year,
        month: Number.isFinite(Number(forced.month)) ? Number(forced.month) : base.month,
        day: Number.isFinite(Number(forced.day)) ? Number(forced.day) : base.day,
        hour: Number.isFinite(Number(forced.hour)) ? Number(forced.hour) : base.hour,
        minute: Number.isFinite(Number(forced.minute)) ? Number(forced.minute) : base.minute,
        weekday: forced.weekday ? String(forced.weekday).slice(0, 3).toLowerCase() : base.weekday,
      };
    }

    const tz = siteInfo?.timezone || null;
    if (!tz) throw new Error('no-timezone');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(new Date());
    const obj = {};
    for (const p of parts) if (p.type !== 'literal') obj[p.type] = p.value;
    return {
      year: Number(obj.year),
      month: Number(obj.month),
      day: Number(obj.day),
      hour: Number(obj.hour),
      minute: Number(obj.minute),
      weekday: String(obj.weekday || '').slice(0, 3).toLowerCase(),
    };
  } catch {
    const d = new Date();
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      weekday: days[d.getDay()],
    };
  }
}

function localMinutes(siteInfo) {
  const p = getSiteParts(siteInfo);
  return p.hour * 60 + p.minute;
}

function dayKey(siteInfo) {
  const p = getSiteParts(siteInfo);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function weekdayKey(siteInfo) {
  return getSiteParts(siteInfo).weekday;
}

function minuteDistance(a, b) {
  const aa = ((Number(a) % 1440) + 1440) % 1440;
  const bb = ((Number(b) % 1440) + 1440) % 1440;
  const diff = Math.abs(aa - bb);
  return Math.min(diff, 1440 - diff);
}

function oncePerMinute(scopeA, scopeB, targetMinute, siteInfo = null, toleranceMin = 0) {
  if (!Number.isFinite(Number(targetMinute))) return false;
  const nowMin = localMinutes(siteInfo);
  if (minuteDistance(nowMin, Number(targetMinute)) > Math.max(0, Number(toleranceMin) || 0)) return false;

  const token = `${dayKey(siteInfo)}_${Math.round(Number(targetMinute))}`;
  const key = `${scopeA}__${scopeB}`;
  if (onceState.get(key) === token) return false;
  onceState.set(key, token);
  return true;
}

module.exports = { getSiteParts, localMinutes, dayKey, weekdayKey, oncePerMinute };
