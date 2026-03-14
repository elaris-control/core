// src/automation/energy.js
// ⚡ Energy Monitoring Module
//
// Reads real-time Watt reading from MQTT sensor (power_w input).
// Accumulates kWh via trapezoidal integration.
// Tracks daily/monthly totals, peak power, cost, CO₂ footprint.
// Multi-tariff (flat or time-of-use peak/off-peak).
// Export monitoring (solar PV grid injection).
// Phase monitoring (L1/L2/L3 optional sensors).
// Budget alerts (monthly cost threshold).
// Daily history for week-over-week comparison.
//
// State persisted in module_settings:
//   _kwh_today, _kwh_month, _kwh_total
//   _kwh_export_today, _kwh_export_month, _kwh_export_total
//   _day_reset (YYYY-MM-DD of last daily reset)
//   _month_reset (YYYY-MM of last monthly reset)
//   _peak_w_today, _peak_w_month
//   _history_json  ([{date, kwh, cost}] last 7 days)

'use strict';

const ENERGY_MODULE = {
  id:          'energy',
  name:        'Energy Monitor',
  icon:        '⚡',
  description: 'Track real-time power (W), accumulated kWh, cost, CO₂ footprint and peak power. Supports multi-tariff, solar export, 3-phase monitoring, budget alerts and week-over-week comparison.',
  color:       '#f59e0b',
  category:    'hydraulic',

  inputs: [
    { key: 'power_w',   label: 'Power Meter (W)', type: 'sensor', required: true,
      description: 'Real-time power sensor reading in Watts (import). Primary data source for all calculations.' },
    { key: 'export_w',  label: 'Export Power (W) — solar', type: 'sensor', required: false,
      description: 'Grid injection in Watts. Used for solar PV export revenue tracking.' },
    { key: 'power_l1',  label: 'Phase L1 Power (W)', type: 'sensor', required: false,
      description: 'Phase 1 power reading for 3-phase monitoring.' },
    { key: 'power_l2',  label: 'Phase L2 Power (W)', type: 'sensor', required: false,
      description: 'Phase 2 power reading for 3-phase monitoring.' },
    { key: 'power_l3',  label: 'Phase L3 Power (W)', type: 'sensor', required: false,
      description: 'Phase 3 power reading for 3-phase monitoring.' },
    { key: 'relay',     label: 'Controlled Relay (opt)', type: 'relay', required: false,
      description: 'Optional relay output. Can be controlled by external rules or load shifting.' },
  ],

  groups: [
    { id: 'basic',    label: '⚙️ Basic',                open: true,  requires: null },
    { id: 'tariff',   label: '🕐 Time-of-Use Tariff',   open: false, requires: null },
    { id: 'export',   label: '☀️ Export / Solar',        open: false, requires: 'export_w' },
    { id: 'budget',   label: '💰 Budget & CO₂',          open: false, requires: null },
    { id: 'alerts',   label: '🔔 Alerts',                open: false, requires: null },
  ],

  setpoints: [
    { group: 'basic',  key: 'tariff',           label: 'Flat tariff',          type: 'number', unit: '€/kWh', step: 0.01, default: 0.20 },
    { group: 'basic',  key: 'reset_hour',        label: 'Daily reset hour',     type: 'number', unit: 'h',     step: 1,    default: 0 },
    { group: 'tariff', key: 'tariff_mode',       label: 'Tariff mode',          type: 'select', options: ['flat','tou'], default: 'flat' },
    { group: 'tariff', key: 'tariff_peak',       label: 'Peak tariff',          type: 'number', unit: '€/kWh', step: 0.01, default: 0.28 },
    { group: 'tariff', key: 'tariff_offpeak',    label: 'Off-peak tariff',      type: 'number', unit: '€/kWh', step: 0.01, default: 0.12 },
    { group: 'tariff', key: 'peak_start_h',      label: 'Peak period start',    type: 'number', unit: 'h',     step: 1,    default: 7 },
    { group: 'tariff', key: 'peak_end_h',        label: 'Peak period end',      type: 'number', unit: 'h',     step: 1,    default: 22 },
    { group: 'export', key: 'export_tariff',     label: 'Export / feed-in rate',type: 'number', unit: '€/kWh', step: 0.01, default: 0.08 },
    { group: 'budget', key: 'budget_month_eur',  label: 'Monthly budget',       type: 'number', unit: '€',     step: 5,    default: 0,
      description: 'Alert when monthly cost exceeds this value. Set 0 to disable.' },
    { group: 'budget', key: 'co2_factor_g_kwh',  label: 'CO₂ emission factor',  type: 'number', unit: 'g/kWh', step: 10,   default: 300,
      description: 'Grid CO₂ emission factor in grams per kWh. EU average ≈ 300 g/kWh.' },
    { group: 'alerts', key: 'alert_above_w',     label: 'Alert if above',       type: 'number', unit: 'W',     step: 50,   default: 0 },
    { group: 'alerts', key: 'alert_cooldown_s',  label: 'Alert cooldown',       type: 'number', unit: 's',     step: 60,   default: 900 },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0',
      description: 'When ON, no commands are sent to IOs. All actions are logged only.' },
  ],
};

// ── Per-instance runtime state ────────────────────────────────────────────────
const instanceState = new Map();
const testModeLog = new Map(); // instId -> [{ts, io, value, reason}]

function getState(instId) {
  if (!instanceState.has(instId)) {
    instanceState.set(instId, { lastTs: null, lastW: null, lastExportW: null });
  }
  return instanceState.get(instId);
}

function fmtDate(ts)  { return new Date(ts).toISOString().slice(0, 10); } // YYYY-MM-DD
function fmtMonth(ts) { return new Date(ts).toISOString().slice(0, 7);  } // YYYY-MM

function loadHistory(ctx) {
  try {
    const raw = ctx.settingStr('_history_json', '');
    if (!raw) return [];
    const h = JSON.parse(raw);
    return Array.isArray(h) ? h : [];
  } catch (_) { return []; }
}

function saveHistory(ctx, history) {
  try { ctx.setSetting('_history_json', JSON.stringify(history)); } catch (_) {}
}

function energyHandler(ctx, send) {
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

  const inst   = getState(instId);

  // ── Read current power ───────────────────────────────────────────────────
  const rawW = ctx.value('power_w');
  if (rawW === null || rawW === undefined) return;
  const watts = Math.max(0, parseFloat(rawW) || 0);

  // Phase monitoring (optional)
  const wL1 = ctx.io('power_l1') ? Math.max(0, parseFloat(ctx.value('power_l1') || 0)) : null;
  const wL2 = ctx.io('power_l2') ? Math.max(0, parseFloat(ctx.value('power_l2') || 0)) : null;
  const wL3 = ctx.io('power_l3') ? Math.max(0, parseFloat(ctx.value('power_l3') || 0)) : null;

  // Export monitoring (optional)
  const exportW = ctx.io('export_w') ? Math.max(0, parseFloat(ctx.value('export_w') || 0)) : 0;

  // ── Settings ─────────────────────────────────────────────────────────────
  const tariffFlat    = parseFloat(ctx.setting('tariff',           0.20));
  const resetHour     = parseInt(ctx.setting('reset_hour',         0));
  const tariffMode    = ctx.settingStr('tariff_mode', 'flat');
  const tariffPeak    = parseFloat(ctx.setting('tariff_peak',      0.28));
  const tariffOffPeak = parseFloat(ctx.setting('tariff_offpeak',   0.12));
  const peakStartH    = parseInt(ctx.setting('peak_start_h',       7));
  const peakEndH      = parseInt(ctx.setting('peak_end_h',         22));
  const exportTariff  = parseFloat(ctx.setting('export_tariff',    0.08));
  const budgetMonth   = parseFloat(ctx.setting('budget_month_eur', 0));
  const co2Factor     = parseFloat(ctx.setting('co2_factor_g_kwh', 300));
  const alertAbove    = parseFloat(ctx.setting('alert_above_w',    0));
  const alertCool     = parseInt(ctx.setting('alert_cooldown_s',   900));

  // Determine active tariff (time-of-use or flat)
  const currentH  = new Date().getHours();
  const isPeak    = tariffMode === 'tou' && currentH >= peakStartH && currentH < peakEndH;
  const activeTariff = tariffMode === 'tou' ? (isPeak ? tariffPeak : tariffOffPeak) : tariffFlat;

  // ── Read persisted accumulators ──────────────────────────────────────────
  const today = fmtDate(now);
  const month = fmtMonth(now);
  const lastDay   = ctx.settingStr('_day_reset',   '') || '';
  const lastMonth = ctx.settingStr('_month_reset', '') || '';

  let kwToday_ = parseFloat(ctx.setting('_kwh_today',  0) || 0);
  let kwMonth_ = parseFloat(ctx.setting('_kwh_month',  0) || 0);
  let kwTotal_ = parseFloat(ctx.setting('_kwh_total',  0) || 0);
  let peakD    = parseFloat(ctx.setting('_peak_w_today', 0) || 0);
  let peakM    = parseFloat(ctx.setting('_peak_w_month', 0) || 0);
  let exToday_ = parseFloat(ctx.setting('_kwh_export_today',  0) || 0);
  let exMonth_ = parseFloat(ctx.setting('_kwh_export_month',  0) || 0);
  let exTotal_ = parseFloat(ctx.setting('_kwh_export_total',  0) || 0);

  // ── Daily reset ──────────────────────────────────────────────────────────
  // Only reset once per day: fire when the calendar day has changed AND we have
  // passed resetHour. The _day_reset key is updated to today so subsequent ticks
  // in the same day skip this block entirely.
  if (lastDay !== today && currentH >= resetHour) {
    // Archive yesterday to history before resetting
    if (kwToday_ > 0) {
      const history = loadHistory(ctx);
      history.push({ date: lastDay || fmtDate(now - 86400000), kwh: Math.round(kwToday_ * 1000) / 1000, cost: Math.round(kwToday_ * activeTariff * 100) / 100 });
      while (history.length > 7) history.shift();
      saveHistory(ctx, history);
    }
    kwToday_ = 0; peakD = 0; exToday_ = 0;
    ctx.setSetting('_kwh_today',        '0');
    ctx.setSetting('_peak_w_today',     '0');
    ctx.setSetting('_kwh_export_today', '0');
    ctx.setSetting('_day_reset',        today);
  }

  // ── Monthly reset ────────────────────────────────────────────────────────
  if (lastMonth !== month) {
    kwMonth_ = 0; peakM = 0; exMonth_ = 0;
    ctx.setSetting('_kwh_month',        '0');
    ctx.setSetting('_peak_w_month',     '0');
    ctx.setSetting('_kwh_export_month', '0');
    ctx.setSetting('_month_reset',      month);
  }

  // ── Integration (trapezoidal) ────────────────────────────────────────────
  let addedKwh = 0;
  let addedExportKwh = 0;
  if (inst.lastTs !== null && inst.lastW !== null) {
    const dtH = (now - inst.lastTs) / 3600000;
    if (dtH > 0 && dtH < 1) {
      addedKwh       = ((watts + inst.lastW) / 2) / 1000 * dtH;
      addedExportKwh = ((exportW + (inst.lastExportW || 0)) / 2) / 1000 * dtH;
    }
  }
  inst.lastTs      = now;
  inst.lastW       = watts;
  inst.lastExportW = exportW;

  const newToday  = kwToday_ + addedKwh;
  const newMonth  = kwMonth_ + addedKwh;
  const newTotal  = kwTotal_ + addedKwh;
  const newPeakD  = Math.max(peakD, watts);
  const newPeakM  = Math.max(peakM, watts);
  const newExToday = exToday_ + addedExportKwh;
  const newExMonth = exMonth_ + addedExportKwh;
  const newExTotal = exTotal_ + addedExportKwh;

  // ── Persist ──────────────────────────────────────────────────────────────
  if (addedKwh > 0.00001) {
    ctx.setSetting('_kwh_today', String(Math.round(newToday * 10000) / 10000));
    ctx.setSetting('_kwh_month', String(Math.round(newMonth * 10000) / 10000));
    ctx.setSetting('_kwh_total', String(Math.round(newTotal * 10000) / 10000));
  }
  if (addedExportKwh > 0.00001) {
    ctx.setSetting('_kwh_export_today', String(Math.round(newExToday * 10000) / 10000));
    ctx.setSetting('_kwh_export_month', String(Math.round(newExMonth * 10000) / 10000));
    ctx.setSetting('_kwh_export_total', String(Math.round(newExTotal * 10000) / 10000));
  }
  if (watts > peakD) ctx.setSetting('_peak_w_today', String(Math.round(watts)));
  if (watts > peakM) ctx.setSetting('_peak_w_month', String(Math.round(watts)));

  // ── Cost & CO₂ ──────────────────────────────────────────────────────────
  const costToday       = Math.round(newToday  * activeTariff * 100) / 100;
  const costMonth       = Math.round(newMonth  * activeTariff * 100) / 100;
  const exportRevToday  = Math.round(newExToday * exportTariff * 100) / 100;
  const exportRevMonth  = Math.round(newExMonth * exportTariff * 100) / 100;
  const co2TodayKg      = Math.round(newToday  * co2Factor) / 1000; // g → kg
  const co2MonthKg      = Math.round(newMonth  * co2Factor) / 1000;

  // ── Budget alert ─────────────────────────────────────────────────────────
  if (budgetMonth > 0 && costMonth >= budgetMonth) {
    ctx.notify({
      title:      '💰 Energy Budget Alert',
      body:       `Monthly cost ${costMonth.toFixed(2)}€ has reached your budget of ${budgetMonth.toFixed(2)}€.`,
      level:      'warning',
      tag:        `energy_budget_${instId}`,
      cooldown_s: 86400,
    });
  }

  // ── Power alert ──────────────────────────────────────────────────────────
  if (alertAbove > 0 && watts > alertAbove) {
    ctx.notify({
      title:      '⚡ High Power Alert',
      body:       `Power is ${Math.round(watts)}W — above threshold of ${Math.round(alertAbove)}W.\nToday: ${Math.round(newToday * 100) / 100} kWh (${costToday}€)`,
      level:      'warning',
      tag:        `energy_alert_${instId}`,
      cooldown_s: alertCool,
    });
  }

  // ── Broadcast ────────────────────────────────────────────────────────────
  const status = alertAbove > 0 && watts > alertAbove ? 'alert' : 'monitoring';
  const reason = status === 'alert'
    ? `Power ${Math.round(watts)}W above threshold ${Math.round(alertAbove)}W`
    : `Monitoring ${Math.round(watts)}W`;

  const history = loadHistory(ctx);

  ctx.broadcastState({
    status,
    last_reason:       reason,
    // Live power
    watts,
    power_l1:          wL1,
    power_l2:          wL2,
    power_l3:          wL3,
    export_w:          exportW > 0 ? exportW : null,
    // Accumulated import
    kwh_today:         Math.round(newToday  * 1000) / 1000,
    kwh_month:         Math.round(newMonth  * 1000) / 1000,
    kwh_total:         Math.round(newTotal  * 1000) / 1000,
    // Accumulated export
    kwh_export_today:  Math.round(newExToday * 1000) / 1000,
    kwh_export_month:  Math.round(newExMonth * 1000) / 1000,
    kwh_export_total:  Math.round(newExTotal * 1000) / 1000,
    // Peaks
    peak_today:        Math.round(newPeakD),
    peak_month:        Math.round(newPeakM),
    // Cost
    active_tariff:     activeTariff,
    tariff_period:     tariffMode === 'tou' ? (isPeak ? 'peak' : 'offpeak') : 'flat',
    cost_today:        costToday,
    cost_month:        costMonth,
    export_rev_today:  exportRevToday,
    export_rev_month:  exportRevMonth,
    budget_month:      budgetMonth > 0 ? budgetMonth : null,
    // CO₂
    co2_today_kg:      co2TodayKg,
    co2_month_kg:      co2MonthKg,
    // History (last 7 days)
    daily_history:     history,
    relay_on:          !!(ctx.io('relay') && ctx.isOn('relay')),
    test_mode: isTestMode,
    test_log_count: isTestMode ? (testModeLog.get(instId) || []).length : 0,
    test_log_recent: isTestMode ? (testModeLog.get(instId) || []).slice(-20) : [],
  });
}

module.exports = { energyHandler, ENERGY_MODULE };
