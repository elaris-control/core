'use strict';

const { initWS } = require('../ws');
const { initMQTT } = require('../mqtt');
const { AutomationEngine } = require('../automation/engine');

function initRealtimeRuntime({ server, db, access, users, auth, scenesApi, notifyApi, mqttUrl }) {
  const wsApi = initWS(server, {
    db,
    access,
    getRole: (req) => {
      const h = req.headers?.cookie || '';
      const m = h.match(/(?:^|;\s*)elaris_session=([^;]+)/);
      const tok = m ? decodeURIComponent(m[1]) : null;
      const sess = tok ? users.verifySession(tok) : null;
      if (sess?.role === 'ADMIN') return 'ADMIN';
      if (sess?.role === 'ENGINEER') return 'ENGINEER';
      if (sess && auth.getRole(req) === 'ENGINEER') return 'ENGINEER';
      return sess ? 'USER' : null;
    }
  });

  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  function emitLog(level, text) {
    try {
      for (const line of text.replace(/\n$/, '').split('\n')) {
        if (line.trim()) wsApi.broadcastLog({ level, text: line, ts: Date.now() });
      }
    } catch (_) {}
  }

  process.stdout.write = (chunk, ...rest) => {
    origOut(chunk, ...rest);
    emitLog('info', typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };

  process.stderr.write = (chunk, ...rest) => {
    origErr(chunk, ...rest);
    emitLog('warn', typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };

  const engine = new AutomationEngine({ db, broadcast: wsApi.broadcast });
  engine.notify = opts => notifyApi.notify(opts).catch(e => console.error('[NOTIFY]', e.message));
  engine.broadcast = wsApi.broadcast;
  engine.scenesApi = scenesApi;
  engine.startTick(30000);

  const mqttApi = initMQTT({ url: mqttUrl, dbApi: { db }, broadcast: wsApi.broadcast, solarAuto: engine });
  engine.setMqttApi(mqttApi);

  setTimeout(() => engine.evaluateAll(), 2000);
  setInterval(() => scenesApi.tickSchedules({ engine, mqttApi, notify: notifyApi.notify }), 30_000);

  return {
    wsApi,
    engine,
    mqttApi,
  };
}

function startMaintenanceJobs({ db, users, historyRollups }) {
  function cleanupEvents() {
    let retentionDays = 30;
    try {
      const raw = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('events_retention_days');
      const n = Number(raw?.value);
      if (Number.isFinite(n) && n >= 1 && n <= 3650) retentionDays = Math.round(n);
    } catch (_) {}

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    try {
      const r = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
      if (r.changes > 0) console.log(`[CLEANUP] Deleted ${r.changes} old events (retention ${retentionDays}d)`);
    } catch (e) {
      console.error('[CLEANUP]', e.message);
    }

    try { users.purgeExpiredSessions(); } catch (_) {}
  }

  cleanupEvents();
  setInterval(cleanupEvents, 24 * 60 * 60 * 1000);

  try {
    const r = historyRollups.backfillInitial?.();
    if (r?.changed) console.log(`[ROLLUPS] Startup backfill: ${r.changed} rows upserted`);
  } catch (e) {
    console.error('[ROLLUPS] startup backfill error:', e.message);
  }

  setInterval(() => {
    try {
      const r = historyRollups.build5mRollups?.({ lookbackMs: 4 * 3600000 });
      if (r?.changed) console.log(`[ROLLUPS] 5m: upserted ${r.changed}`);
    } catch (e) {
      console.error('[ROLLUPS] 5m error:', e.message);
    }
  }, 5 * 60 * 1000);

  setInterval(() => {
    try {
      const r = historyRollups.buildMissingHourlyRollups({ lookbackHours: 48 });
      if (r?.changed) console.log(`[ROLLUPS] 1h: upserted ${r.changed}`);
    } catch (e) {
      console.error('[ROLLUPS]', e.message);
    }
  }, 60 * 60 * 1000);

  setInterval(() => {
    try {
      const r = historyRollups.buildDailyRollups?.({ lookbackDays: 7 });
      if (r?.changed) console.log(`[ROLLUPS] 1d: upserted ${r.changed}`);
    } catch (e) {
      console.error('[ROLLUPS] 1d error:', e.message);
    }
  }, 60 * 60 * 1000);
}

module.exports = {
  initRealtimeRuntime,
  startMaintenanceJobs,
};