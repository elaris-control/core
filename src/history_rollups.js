'use strict';

function createHistoryRollupService(db) {
  const getSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
  const listNumericIo = db.prepare(`SELECT id, device_id, key, type FROM io WHERE enabled = 1 AND type IN ('sensor','analog','ai')`);

  // Use device_id + key_suffix pattern instead of LIKE '%/key' to leverage indexes.
  // The topic column stores full MQTT topics like "elaris/dev1/tele/temp1".
  // We match by device_id (indexed) and then filter in-memory on the key suffix.
  const selectEventsByDevice = db.prepare(`
    SELECT payload AS value, topic, ts
    FROM events
    WHERE device_id = ? AND ts >= ? AND ts < ?
    ORDER BY ts ASC
  `);

  const select1hForDay = db.prepare(`
    SELECT min_value, max_value, avg_value, last_value, sample_count, bucket_start_ts
    FROM io_history_rollups
    WHERE io_id = ? AND bucket_size = '1h' AND bucket_start_ts >= ? AND bucket_start_ts < ?
    ORDER BY bucket_start_ts ASC
  `);

  const upsertRollup = db.prepare(`
    INSERT INTO io_history_rollups (
      io_id, bucket_start_ts, bucket_size,
      min_value, max_value, avg_value, last_value,
      sample_count, created_ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(io_id, bucket_start_ts, bucket_size)
    DO UPDATE SET
      min_value=excluded.min_value,
      max_value=excluded.max_value,
      avg_value=excluded.avg_value,
      last_value=excluded.last_value,
      sample_count=excluded.sample_count,
      created_ts=excluded.created_ts
  `);

  const pruneRollups = db.prepare(`DELETE FROM io_history_rollups WHERE bucket_size = ? AND bucket_start_ts < ?`);
  const rollupStats  = db.prepare(`SELECT COUNT(*) AS count, MIN(bucket_start_ts) AS oldest_ts, MAX(bucket_start_ts) AS newest_ts FROM io_history_rollups WHERE bucket_size = ?`);

  // ── Retention ─────────────────────────────────────────────────────────
  function getRetentionDays() {
    const raw = getSetting.get('rollups_retention_days');
    const n   = Number(raw?.value);
    return Number.isFinite(n) && n >= 30 && n <= 3650 ? Math.round(n) : 1095;
  }

  // ── Floor helpers ─────────────────────────────────────────────────────
  function floor5m(ts)   { return Math.floor(ts / 300000)   * 300000;   }
  function floorHour(ts) { return Math.floor(ts / 3600000)  * 3600000;  }
  function floorDay(ts)  { return Math.floor(ts / 86400000) * 86400000; }

  // ── Aggregation helpers ───────────────────────────────────────────────
  function aggFromValues(values) {
    if (!values.length) return null;
    // Avoid spread operator stack overflow on large arrays (>65K elements)
    let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const avg   = sum / values.length;
    const last  = values[values.length - 1];
    return { min, max, avg, last, count: values.length };
  }

  function aggFromRollupRows(rows) {
    if (!rows.length) return null;
    let min = Infinity, max = -Infinity, totalWeight = 0, weightedSum = 0, last = null, lastTs = -1;
    for (const r of rows) {
      const cnt = Number(r.sample_count) || 0;
      if (cnt === 0) continue;
      const rMin = Number(r.min_value), rMax = Number(r.max_value), rAvg = Number(r.avg_value);
      if (Number.isFinite(rMin) && rMin < min) min = rMin;
      if (Number.isFinite(rMax) && rMax > max) max = rMax;
      if (Number.isFinite(rAvg)) { weightedSum += rAvg * cnt; totalWeight += cnt; }
      if (r.bucket_start_ts > lastTs && Number.isFinite(Number(r.last_value))) {
        lastTs = r.bucket_start_ts;
        last   = Number(r.last_value);
      }
    }
    if (!totalWeight) return null;
    return { min, max, avg: weightedSum / totalWeight, last, count: totalWeight };
  }

  // ── Rollup per IO ─────────────────────────────────────────────────────
  function rollupBucketFromEvents(io, bucketStart, bucketMs) {
    const suffix = `/${io.key}`;
    const rows   = selectEventsByDevice.all(io.device_id, bucketStart, bucketStart + bucketMs);
    const values = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].topic.endsWith(suffix)) {
        const v = parseFloat(rows[i].value);
        if (Number.isFinite(v)) values.push(v);
      }
    }
    return aggFromValues(values);
  }

  function rollupDayFromHourly(io, dayStart) {
    const rows = select1hForDay.all(io.id, dayStart, dayStart + 86400000);
    return aggFromRollupRows(rows);
  }

  // ── 5-minute rollups ──────────────────────────────────────────────────
  function build5mRollups({ lookbackMs = 4 * 3600000 } = {}) {
    const ios   = listNumericIo.all();
    const now   = Date.now();
    const start = floor5m(now - lookbackMs);
    const end   = floor5m(now);
    let changed = 0;
    const tx = db.transaction(() => {
      for (const io of ios) {
        for (let bucket = start; bucket < end; bucket += 300000) {
          const agg = rollupBucketFromEvents(io, bucket, 300000);
          if (!agg) continue;
          upsertRollup.run(io.id, bucket, '5m', agg.min, agg.max, agg.avg, agg.last, agg.count, now);
          changed += 1;
        }
      }
      pruneRollups.run('5m', now - 7 * 86400000);
    });
    tx();
    return { ok: true, changed };
  }

  // ── 1-hour rollups ────────────────────────────────────────────────────
  function buildMissingHourlyRollups({ lookbackHours = 48 } = {}) {
    const ios   = listNumericIo.all();
    const now   = Date.now();
    const start = floorHour(now - lookbackHours * 3600000);
    const end   = floorHour(now);
    let changed = 0;
    const tx = db.transaction(() => {
      for (const io of ios) {
        for (let bucket = start; bucket < end; bucket += 3600000) {
          const agg = rollupBucketFromEvents(io, bucket, 3600000);
          if (!agg) continue;
          upsertRollup.run(io.id, bucket, '1h', agg.min, agg.max, agg.avg, agg.last, agg.count, now);
          changed += 1;
        }
      }
      const retentionDays = getRetentionDays();
      pruneRollups.run('1h', now - retentionDays * 86400000);
    });
    tx();
    return { ok: true, changed };
  }

  // ── 1-day rollups ─────────────────────────────────────────────────────
  function buildDailyRollups({ lookbackDays = 7 } = {}) {
    const ios   = listNumericIo.all();
    const now   = Date.now();
    const start = floorDay(now - lookbackDays * 86400000);
    const end   = floorDay(now);
    let changed = 0;
    const tx = db.transaction(() => {
      for (const io of ios) {
        for (let bucket = start; bucket < end; bucket += 86400000) {
          // Primary: aggregate from 1h rollups (fast)
          let agg = rollupDayFromHourly(io, bucket);
          // Supplement with raw events for recent days if 1h data is thin
          if (!agg || agg.count < 2) {
            const rawAgg = rollupBucketFromEvents(io, bucket, 86400000);
            if (rawAgg && (!agg || rawAgg.count > agg.count)) agg = rawAgg;
          }
          if (!agg) continue;
          upsertRollup.run(io.id, bucket, '1d', agg.min, agg.max, agg.avg, agg.last, agg.count, now);
          changed += 1;
        }
      }
      const retentionDays = getRetentionDays();
      pruneRollups.run('1d', now - retentionDays * 86400000);
    });
    tx();
    return { ok: true, changed };
  }

  // ── First-run backfill ────────────────────────────────────────────────
  // Runs once at startup to populate older data without overwhelming the DB.
  function backfillInitial() {
    let totalChanged = 0;
    try {
      // 1h: 48h of recent hourly data (normal scheduled job handles more)
      const h = buildMissingHourlyRollups({ lookbackHours: 48 });
      totalChanged += h.changed || 0;
    } catch (e) { console.error('[ROLLUPS] 1h backfill error:', e.message); }
    try {
      // 1d: 180 days (safe first-run backfill — avoids long spike)
      const d = buildDailyRollups({ lookbackDays: 180 });
      totalChanged += d.changed || 0;
    } catch (e) { console.error('[ROLLUPS] 1d backfill error:', e.message); }
    try {
      const m = build5mRollups({ lookbackMs: 4 * 3600000 });
      totalChanged += m.changed || 0;
    } catch (e) { console.error('[ROLLUPS] 5m backfill error:', e.message); }
    if (totalChanged) console.log(`[ROLLUPS] Initial backfill: ${totalChanged} rows upserted`);
    return { ok: true, changed: totalChanged };
  }

  function getStats(bucketSize = '1h') {
    return rollupStats.get(bucketSize) || { count: 0, oldest_ts: null, newest_ts: null };
  }

  return {
    buildMissingHourlyRollups,
    build5mRollups,
    buildDailyRollups,
    backfillInitial,
    getRetentionDays,
    getStats,
  };
}

module.exports = { createHistoryRollupService };
