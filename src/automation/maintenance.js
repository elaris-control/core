// src/automation/maintenance.js
// 🔧 Maintenance Tracker — Run-hour + start counter + service reminders
//
// Tracks operating hours and start counts for up to 4 equipment items.
// Supports: minor + major service intervals, service log with notes/parts,
//           start counting, predictive next-service-date estimate,
//           "service done" reset from UI.

'use strict';

const TRACKED = [1, 2, 3, 4];

// Per-instance runtime: tracks wasOn (for rising-edge start detection)
const runtimeState = new Map();
const testModeLog = new Map(); // instId -> [{ts, io, value, reason}]

function getRuntime(instId) {
  if (!runtimeState.has(instId)) runtimeState.set(instId, {});
  return runtimeState.get(instId);
}

function fmtDate(ts) { return new Date(ts).toISOString().slice(0, 10); }

function loadServiceLog(ctx, i) {
  try {
    const raw = ctx.settingStr(`_service_log_${i}`, '');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveServiceLog(ctx, i, log) {
  try { ctx.setSetting(`_service_log_${i}`, JSON.stringify(log)); } catch (_) {}
}

// Load last-7-days daily hour history for average computation
function loadDailyHistory(ctx, i) {
  try {
    const raw = ctx.settingStr(`_daily_h_json_${i}`, '');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveDailyHistory(ctx, i, hist) {
  try { ctx.setSetting(`_daily_h_json_${i}`, JSON.stringify(hist)); } catch (_) {}
}

function maintenanceHandler(ctx, send) {
  const instId = ctx.instance.id;
  const now    = Date.now();

  const isTestMode = ctx.settingStr('test_mode', '0') === '1';
  if (isTestMode) {
    const tmLog = testModeLog.get(instId) || [];
    const _realSend = send;
    send = (io, value, reason) => {
      tmLog.push({ ts: now, io, value, reason: reason || '' });
      if (tmLog.length > 200) tmLog.shift();
      console.log(`[TEST MODE] ${io} = ${value}${reason ? ' // ' + reason : ''}`);
    };
    testModeLog.set(instId, tmLog);
  }

  const rt     = getRuntime(instId);
  const today  = fmtDate(now);
  const equipment = [];
  let dueCount = 0;
  let onCount  = 0;

  for (const i of TRACKED) {
    const key = `equipment_${i}`;
    const io  = ctx.io(key);
    if (!io) continue;

    const isOn   = ctx.isOn(key);
    const lastOn = parseFloat(ctx.settingStr(`_last_on_${i}`, '0')) || 0;
    let hours    = parseFloat(ctx.settingStr(`_hours_${i}`,   '0')) || 0;
    let starts   = parseInt(ctx.settingStr(`_starts_${i}`,    '0')) || 0;

    // ── Daily history rollover ────────────────────────────────────────────
    const lastDayKey = ctx.settingStr(`_day_key_${i}`, '') || '';
    const dayStartH  = parseFloat(ctx.settingStr(`_day_start_h_${i}`, '0')) || 0;
    if (lastDayKey && lastDayKey !== today) {
      const dayDelta = Math.max(0, hours - dayStartH);
      if (dayDelta > 0) {
        const hist = loadDailyHistory(ctx, i);
        hist.push({ date: lastDayKey, h: Math.round(dayDelta * 100) / 100 });
        while (hist.length > 7) hist.shift();
        saveDailyHistory(ctx, i, hist);
      }
      ctx.setSetting(`_day_start_h_${i}`, String(Math.round(hours * 10000) / 10000));
      ctx.setSetting(`_day_key_${i}`, today);
    } else if (!lastDayKey) {
      ctx.setSetting(`_day_start_h_${i}`, String(Math.round(hours * 10000) / 10000));
      ctx.setSetting(`_day_key_${i}`, today);
    }

    // ── Start counting (rising edge) ──────────────────────────────────────
    const wasOn = !!rt[`wasOn_${i}`];
    if (isOn && !wasOn) {
      starts++;
      ctx.setSetting(`_starts_${i}`, String(starts));
    }
    rt[`wasOn_${i}`] = isOn;

    // ── Hour accumulation ─────────────────────────────────────────────────
    if (isOn) {
      onCount++;
      if (lastOn > 0) {
        const deltaSec = (now - lastOn) / 1000;
        if (deltaSec > 0 && deltaSec < 3700) {
          hours = Math.round((hours + deltaSec / 3600) * 10000) / 10000;
          ctx.setSetting(`_hours_${i}`, String(hours));
        }
      }
      ctx.setSetting(`_last_on_${i}`, String(now));
    } else {
      if (lastOn > 0) ctx.setSetting(`_last_on_${i}`, '0');
    }

    // ── Service done reset (from UI) ──────────────────────────────────────
    if (ctx.settingStr(`_service_done_${i}`, '0') === '1') {
      const notes = ctx.settingStr(`_service_notes_${i}`, '').trim();
      const parts = ctx.settingStr(`_service_parts_${i}`, '').trim();
      const log   = loadServiceLog(ctx, i);
      log.push({
        date:        today,
        hours:       Math.round(hours * 100) / 100,
        starts,
        notes:       notes || null,
        parts:       parts || null,
      });
      while (log.length > 10) log.shift();
      saveServiceLog(ctx, i, log);
      ctx.setSetting(`_hours_at_service_${i}`,  String(Math.round(hours * 10000) / 10000));
      ctx.setSetting(`_starts_at_service_${i}`, String(starts));
      ctx.setSetting(`_service_done_${i}`,  '0');
      ctx.setSetting(`_service_notes_${i}`, '');
      ctx.setSetting(`_service_parts_${i}`, '');
      console.log(`[MAINTENANCE] Equipment ${i} service logged at ${hours.toFixed(1)}h`);
    }

    const hAtSvc      = parseFloat(ctx.settingStr(`_hours_at_service_${i}`, '0')) || 0;
    const startsAtSvc = parseInt(ctx.settingStr(`_starts_at_service_${i}`, '0')) || 0;
    const hoursSince  = Math.max(0, hours - hAtSvc);
    const startsSince = Math.max(0, starts - startsAtSvc);
    const name        = ctx.settingStr(`equipment_name_${i}`, `Equipment ${i}`);

    // ── Service intervals (minor + major) ─────────────────────────────────
    const minorInterval = Number(ctx.setting(`service_interval_h_${i}`,       500)) || 0;
    const majorInterval = Number(ctx.setting(`service_interval_major_h_${i}`, 0))   || 0;
    const minorDue  = minorInterval > 0 && hoursSince >= minorInterval;
    const majorDue  = majorInterval > 0 && hoursSince >= majorInterval;
    const minorDueIn = minorInterval > 0 ? Math.max(0, minorInterval - hoursSince) : null;
    const majorDueIn = majorInterval > 0 ? Math.max(0, majorInterval - hoursSince) : null;

    if (majorDue) {
      dueCount++;
      ctx.notify({
        title:      `🔧 Major Service Due: ${name}`,
        body:       `${name} reached ${Math.round(hoursSince)}h since last service (major interval: ${majorInterval}h).`,
        level:      'critical',
        tag:        `maintenance_major_${instId}_${i}`,
        cooldown_s: 86400,
      });
    } else if (minorDue) {
      dueCount++;
      ctx.notify({
        title:      `🔧 Service Due: ${name}`,
        body:       `${name} has accumulated ${Math.round(hoursSince)}h since last service (interval: ${minorInterval}h).`,
        level:      'warning',
        tag:        `maintenance_${instId}_${i}`,
        cooldown_s: 86400,
      });
    }

    // ── Predictive next service date ──────────────────────────────────────
    const dailyHist  = loadDailyHistory(ctx, i);
    let avgDailyH    = null;
    let predictedDays = null;
    if (dailyHist.length >= 2) {
      const sum = dailyHist.reduce((a, d) => a + d.h, 0);
      avgDailyH = Math.round((sum / dailyHist.length) * 100) / 100;
      const dueIn = minorDueIn ?? majorDueIn;
      if (dueIn !== null && avgDailyH > 0) {
        predictedDays = Math.ceil(dueIn / avgDailyH);
      }
    }

    equipment.push({
      idx:                   i,
      key,
      name,
      on:                    !!isOn,
      hours:                 Math.round(hours * 100) / 100,
      starts,
      hours_since_service:   Math.round(hoursSince * 100) / 100,
      starts_since_service:  startsSince,
      minor_interval:        minorInterval || null,
      major_interval:        majorInterval || null,
      minor_due:             minorDue,
      major_due:             majorDue,
      minor_due_in_h:        minorDueIn !== null ? Math.round(minorDueIn * 100) / 100 : null,
      major_due_in_h:        majorDueIn !== null ? Math.round(majorDueIn * 100) / 100 : null,
      avg_daily_h:           avgDailyH,
      predicted_service_days: predictedDays,
      service_log:           loadServiceLog(ctx, i),
    });
  }

  ctx.broadcastState({
    status: dueCount > 0 ? 'service_due' : (equipment.length ? 'monitoring' : 'idle'),
    tracked_count:  equipment.length,
    due_count:      dueCount,
    running_count:  onCount,
    equipment,
    last_reason: dueCount > 0
      ? `${dueCount} equipment item(s) due for service`
      : (equipment.length ? `${equipment.length} item(s) tracked` : 'No equipment mapped'),
    test_mode: isTestMode,
    test_log_count: isTestMode ? (testModeLog.get(instId) || []).length : 0,
    test_log_recent: isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
  });
}

const MAINTENANCE_MODULE = {
  id:          'maintenance',
  name:        'Maintenance Tracker',
  icon:        '🔧',
  description: 'Counts operating hours and starts for pumps, boilers, AC units. Minor + major service intervals, service log with notes/parts, start counting, and predictive next-service-date estimate.',
  color:       '#94a3b8',
  category:    'hydraulic',

  inputs: [
    { key: 'equipment_1', label: 'Equipment 1 (relay/DI)', type: 'relay', required: true,
      description: 'Relay or DI that indicates when this equipment is running.' },
    { key: 'equipment_2', label: 'Equipment 2', type: 'relay', required: false },
    { key: 'equipment_3', label: 'Equipment 3', type: 'relay', required: false },
    { key: 'equipment_4', label: 'Equipment 4', type: 'relay', required: false },
  ],

  groups: [
    { id: 'eq1', label: '⚙️ Equipment 1', open: true,  requires: 'equipment_1' },
    { id: 'eq2', label: '⚙️ Equipment 2', open: false, requires: 'equipment_2' },
    { id: 'eq3', label: '⚙️ Equipment 3', open: false, requires: 'equipment_3' },
    { id: 'eq4', label: '⚙️ Equipment 4', open: false, requires: 'equipment_4' },
  ],

  setpoints: [
    // Equipment 1
    { group: 'eq1', key: 'equipment_name_1',           label: 'Name',                 type: 'text',   default: 'Solar Pump' },
    { group: 'eq1', key: 'service_interval_h_1',       label: 'Minor service interval',type: 'number', unit: 'h', step: 50,  default: 500 },
    { group: 'eq1', key: 'service_interval_major_h_1', label: 'Major service interval',type: 'number', unit: 'h', step: 100, default: 0, description: '0 = disabled' },
    { group: 'eq1', key: '_service_done_1',            label: 'Mark service done',    type: 'select', options: ['0','1'], default: '0' },
    { group: 'eq1', key: '_service_notes_1',           label: 'Service notes',        type: 'text',   default: '' },
    { group: 'eq1', key: '_service_parts_1',           label: 'Parts replaced',       type: 'text',   default: '' },
    // Equipment 2
    { group: 'eq2', key: 'equipment_name_2',           label: 'Name',                 type: 'text',   default: 'Boiler' },
    { group: 'eq2', key: 'service_interval_h_2',       label: 'Minor service interval',type: 'number', unit: 'h', step: 50,  default: 1000 },
    { group: 'eq2', key: 'service_interval_major_h_2', label: 'Major service interval',type: 'number', unit: 'h', step: 100, default: 0 },
    { group: 'eq2', key: '_service_done_2',            label: 'Mark service done',    type: 'select', options: ['0','1'], default: '0' },
    { group: 'eq2', key: '_service_notes_2',           label: 'Service notes',        type: 'text',   default: '' },
    { group: 'eq2', key: '_service_parts_2',           label: 'Parts replaced',       type: 'text',   default: '' },
    // Equipment 3
    { group: 'eq3', key: 'equipment_name_3',           label: 'Name',                 type: 'text',   default: 'AC Unit' },
    { group: 'eq3', key: 'service_interval_h_3',       label: 'Minor service interval',type: 'number', unit: 'h', step: 50,  default: 500 },
    { group: 'eq3', key: 'service_interval_major_h_3', label: 'Major service interval',type: 'number', unit: 'h', step: 100, default: 0 },
    { group: 'eq3', key: '_service_done_3',            label: 'Mark service done',    type: 'select', options: ['0','1'], default: '0' },
    { group: 'eq3', key: '_service_notes_3',           label: 'Service notes',        type: 'text',   default: '' },
    { group: 'eq3', key: '_service_parts_3',           label: 'Parts replaced',       type: 'text',   default: '' },
    // Equipment 4
    { group: 'eq4', key: 'equipment_name_4',           label: 'Name',                 type: 'text',   default: 'Generator' },
    { group: 'eq4', key: 'service_interval_h_4',       label: 'Minor service interval',type: 'number', unit: 'h', step: 10,  default: 100 },
    { group: 'eq4', key: 'service_interval_major_h_4', label: 'Major service interval',type: 'number', unit: 'h', step: 50,  default: 0 },
    { group: 'eq4', key: '_service_done_4',            label: 'Mark service done',    type: 'select', options: ['0','1'], default: '0' },
    { group: 'eq4', key: '_service_notes_4',           label: 'Service notes',        type: 'text',   default: '' },
    { group: 'eq4', key: '_service_parts_4',           label: 'Parts replaced',       type: 'text',   default: '' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      description: 'When ON, no commands are sent to IOs. All actions are logged only.' },
  ],
};

module.exports = { maintenanceHandler, MAINTENANCE_MODULE };
