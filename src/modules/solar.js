// src/modules/solar.js
// Solar module — MODULE definition + engine handler + API routes

const { solarEngineHandler } = require('../automation/solar_v2');

const MODULE = {
  id: "solar", name: "Solar System", icon: "☀️",
  description: "Differential thermostat for solar collectors (supports inverter pump + aux heat).",
  color: "#ff9a3a", category: "hydraulic",

  inputs: [
    { key: "temp_solar",   label: "Collector Temperature",             type: "sensor", unit: "°C", required: true,
      description: "Temperature sensor at the outlet of the solar collector panel (the hottest point). This is the main input for the differential thermostat calculation." },
    { key: "temp_boiler",  label: "Boiler Temperature",                type: "sensor", unit: "°C", required: true,
      description: "Temperature sensor in the solar storage tank/boiler. Used to calculate ΔT (collector − boiler) and stop the pump when the tank is hot enough." },
    { key: "pump",         label: "Circulation Pump (RUN)",            type: "relay",              required: true,
      description: "Relay that starts/stops the circulation pump between the collector and the boiler. This is the primary controlled output." },
    { key: "pump_speed",   label: "Pump Speed (0–100%)",               type: "analog", unit: "%",  required: false,
      description: "Analog output (0–100%) connected to an inverter-driven pump. When mapped, enables variable-speed control to maintain the target ΔT." },
    { key: "heater",       label: "Electric Heater (resistance)",      type: "relay",              required: false,
      description: "Electric immersion heater relay. Activates as a backup when solar energy is insufficient and the boiler temperature drops below the configured threshold." },
    { key: "backup",       label: "Backup Heat Source (boiler/H/P)",   type: "relay",              required: false,
      description: "Backup heat source relay (gas boiler, heat pump, or other). Activates when neither solar nor electric heater can maintain the minimum boiler temperature." },
    { key: "temp_return",  label: "Return Temperature",                type: "sensor", unit: "°C", required: false,
      description: "Optional temperature sensor on the return pipe from the boiler back to the collector. Used for advanced efficiency monitoring." },
  ],

  groups: [
    { id: "basic",       label: "⚙️ Basic",                   open: true,  requires: null         },
    { id: "inverter",    label: "⚡ Inverter / Speed",         open: true,  requires: "pump_speed" },
    { id: "pump_timers", label: "⏱️ Pump Timers",             open: false, requires: null, requires_absent: "pump_speed" },
    { id: "heater",      label: "🔥 Electric Heater",         open: false, requires: "heater"     },
    { id: "backup",      label: "🛡️ Backup Heat Source",      open: false, requires: "backup"     },
  ],

  setpoints: [
    // ── Basic ─────────────────────────────────────────────────────────
    { group: "basic", key: "profile",          label: "Pump control profile",  type: "select",  default: "basic",
      options: ["basic","inverter_dt"],
      help: "basic: simple ON/OFF pump control based on ΔT thresholds. inverter_dt: variable-speed control that adjusts pump speed to maintain the target ΔT (requires pump_speed output)." },
    { group: "basic", key: "min_solar_temp",   label: "Min collector temp",    type: "number",  unit: "°C", step: 1,    default: 40,
      help: "The pump will not start unless the collector is above this temperature, even if ΔT is met. Prevents cold water from the collector cooling the boiler on cloudy days." },
    { group: "basic", key: "dt_on",            label: "ΔT ON (pump start)",    type: "number",  unit: "°C", step: 0.5,  default: 8,
      help: "Temperature difference (collector − boiler) required to start the pump. Example: dt_on=8 → pump starts when collector is 8°C hotter than boiler." },
    { group: "basic", key: "dt_off",           label: "ΔT OFF (pump stop)",    type: "number",  unit: "°C", step: 0.5,  default: 3,
      help: "Temperature difference at which the pump stops. Must be lower than dt_on to create a hysteresis band and prevent rapid cycling." },
    { group: "basic", key: "max_boiler_temp",  label: "Max boiler (safety)",   type: "number",  unit: "°C", step: 1,    default: 85,
      help: "Safety maximum temperature for the boiler/tank. The pump stops if the boiler reaches this temperature, preventing overheating." },

    { group: "basic", key: "test_mode",         label: "Test mode (dry run)",   type: "select",  default: "0", options: ["0","1"],
      help: "1 = The module evaluates normally but intercepts outputs instead of sending real commands. Useful for safe commissioning and logic testing." },

    // ── Inverter / Speed ──────────────────────────────────────────────
    { group: "inverter", key: "dt_target",       label: "ΔT target",             type: "number",  unit: "°C", step: 0.5,  default: 10,
      help: "The ideal temperature difference (collector − boiler) to maintain. The speed controller adjusts pump speed up or down to keep ΔT near this value." },
    { group: "inverter", key: "min_speed",        label: "Min pump speed",        type: "number",  unit: "%",  step: 1,    default: 25,
      help: "Minimum pump speed percentage when running. Prevents the pump from running too slow (insufficient flow, air locks). Typical minimum: 20–30%." },
    { group: "inverter", key: "max_speed",        label: "Max pump speed",        type: "number",  unit: "%",  step: 1,    default: 100,
      help: "Maximum pump speed percentage. Set lower to reduce noise or energy use when full flow is not needed." },
    { group: "inverter", key: "start_delay_s",    label: "Start delay",           type: "number",  unit: "s",  step: 1,    default: 3,
      help: "Seconds to wait after the ΔT condition is met before starting the pump. Prevents false starts due to sensor noise." },
    { group: "inverter", key: "stop_delay_s",     label: "Stop delay",            type: "number",  unit: "s",  step: 1,    default: 3,
      help: "Seconds to wait after the ΔT drops below dt_off before stopping the pump. Adds damping to the stop decision." },
    { group: "inverter", key: "ramp_up_pct_s",    label: "Ramp up rate",          type: "number",  unit: "%/s",step: 1,    default: 6,
      help: "Maximum speed increase per second when ramping up. Limits mechanical stress on the pump at start-up." },
    { group: "inverter", key: "ramp_down_pct_s",  label: "Ramp down rate",        type: "number",  unit: "%/s",step: 1,    default: 10,
      help: "Maximum speed decrease per second when ramping down. A faster ramp-down is acceptable for stopping." },
    { group: "inverter", key: "ema_alpha",         label: "ΔT filter (EMA α)",    type: "number",  unit: "",   step: 0.05, default: 0.25,
      help: "Exponential moving average smoothing factor for the ΔT signal (0.0–1.0). Lower = smoother but slower response. Higher = faster but noisier. 0.25 is a good starting point." },
    { group: "inverter", key: "map_gain",          label: "Mapping gain (no-PI)", type: "number",  unit: "",   step: 0.5,  default: 6,
      help: "Proportional gain for simple ΔT-to-speed mapping when PI controller is disabled. Speed = (ΔT / dt_target) × gain × 50%." },
    { group: "inverter", key: "use_pi",            label: "Use PI controller",    type: "select",  default: "0", options: ["0","1"],
      help: "0 = simple proportional mapping (recommended for most systems). 1 = PI controller for tighter ΔT regulation (requires tuning Kp and Ki)." },
    { group: "inverter", key: "kp",                label: "PI Kp",                type: "number",  unit: "",   step: 0.1,  default: 3.0,
      help: "Proportional gain for the PI controller. Higher = faster response but risk of overshoot and oscillation." },
    { group: "inverter", key: "ki",                label: "PI Ki",                type: "number",  unit: "",   step: 0.01, default: 0.15,
      help: "Integral gain for the PI controller. Eliminates steady-state error. Too high = slow oscillation (integral windup)." },
    { group: "inverter", key: "kickstart_s",       label: "Kickstart duration",   type: "number",  unit: "s",  step: 1,    default: 2,
      help: "At start-up, the pump briefly runs at kickstart speed to overcome static friction before settling at its calculated speed." },
    { group: "inverter", key: "kickstart_pct",     label: "Kickstart speed",      type: "number",  unit: "%",  step: 5,    default: 40,
      help: "Speed used during the kickstart burst. Should be high enough to ensure the pump impeller breaks free from rest." },
    { group: "inverter", key: "anti_cycle_s",      label: "Anti-cycle lockout",   type: "number",  unit: "s",  step: 5,    default: 60,
      help: "Minimum time the pump must stay OFF after stopping before it can start again. Prevents rapid on/off cycling when ΔT is near the threshold." },
    { group: "inverter", key: "manual_override",   label: "Manual override",      type: "select",  default: "0", options: ["0","1"],
      help: "1 = Force the pump to run at the manual speed, ignoring all ΔT logic. Useful for priming, testing, or forced circulation." },
    { group: "inverter", key: "manual_speed",      label: "Manual speed",         type: "number",  unit: "%",  step: 1,    default: 50,
      help: "Speed percentage used when manual override is enabled." },

    // ── Pump Timers ───────────────────────────────────────────────────
    { group: "pump_timers", key: "pump_min_on_s",  label: "Pump min ON time",     type: "number",  unit: "s",  step: 10,   default: 0,
      help: "Minimum time the pump stays ON after starting (basic profile only). Set to 0 to disable. Prevents very short run cycles." },
    { group: "pump_timers", key: "pump_min_off_s", label: "Pump min OFF time",    type: "number",  unit: "s",  step: 10,   default: 0,
      help: "Minimum rest time between pump cycles (basic profile only). Protects the pump motor from thermal stress." },

    // ── Electric Heater ───────────────────────────────────────────────
    { group: "heater", key: "heater_enable",               label: "Enable electric heater",  type: "select",  default: "0", options: ["0","1"],
      help: "Activates electric heater backup control. The heater turns ON when the boiler is cold and solar energy is unavailable." },
    { group: "heater", key: "heater_on_below",             label: "Heater ON below",          type: "number",  unit: "°C", step: 1,  default: 40,
      help: "Boiler temperature below which the electric heater activates. Set this to your minimum acceptable hot water temperature." },
    { group: "heater", key: "heater_off_above",            label: "Heater OFF above",         type: "number",  unit: "°C", step: 1,  default: 45,
      help: "Boiler temperature above which the heater stops. The gap between ON and OFF creates a hysteresis band to prevent cycling." },
    { group: "heater", key: "heater_min_on_s",             label: "Heater min ON time",       type: "number",  unit: "s",  step: 10, default: 300,
      help: "Minimum time the heater stays ON once activated. Prevents short cycles that reduce element lifespan." },
    { group: "heater", key: "heater_min_off_s",            label: "Heater min OFF time",      type: "number",  unit: "s",  step: 10, default: 300,
      help: "Minimum rest time after the heater turns OFF before it can turn ON again." },
    { group: "heater", key: "heater_lockout_when_pump_on", label: "Lockout if pump ON",       type: "select",  default: "1", options: ["0","1"],
      help: "1 = Heater cannot run while the solar pump is running. Prevents wasting electricity when solar energy is already being harvested." },
    { group: "heater", key: "heater_lockout_when_backup_on",label:"Lockout if backup ON",     type: "select",  default: "1", options: ["0","1"],
      help: "1 = Electric heater is locked out while the backup heat source (boiler/heat pump) is running. Prevents both from running simultaneously." },

    // ── Backup Heat Source ────────────────────────────────────────────
    { group: "backup", key: "backup_enable",                label: "Enable backup heat source", type: "select",  default: "0", options: ["0","1"],
      help: "Activates backup heat source control (gas boiler, heat pump, etc.)." },
    { group: "backup", key: "backup_on_below",              label: "Backup ON below",            type: "number",  unit: "°C", step: 1,  default: 42,
      help: "Boiler temperature below which the backup source activates." },
    { group: "backup", key: "backup_off_above",             label: "Backup OFF above",           type: "number",  unit: "°C", step: 1,  default: 47,
      help: "Boiler temperature above which the backup source stops." },
    { group: "backup", key: "backup_min_on_s",              label: "Backup min ON time",         type: "number",  unit: "s",  step: 10, default: 300,
      help: "Minimum ON time for the backup source. Gas boilers and heat pumps need time to ramp up and settle." },
    { group: "backup", key: "backup_min_off_s",             label: "Backup min OFF time",        type: "number",  unit: "s",  step: 10, default: 600,
      help: "Minimum rest time between backup cycles. Heat pumps especially need time to recover between starts." },
    { group: "backup", key: "backup_lockout_when_pump_on",  label: "Lockout if pump ON",         type: "select",  default: "1", options: ["0","1"],
      help: "1 = Backup source cannot run while the solar pump is active. Prioritizes free solar energy." },
    { group: "backup", key: "backup_lockout_when_heater_on",label: "Lockout if heater ON",       type: "select",  default: "1", options: ["0","1"],
      help: "1 = Backup source is locked out while the electric heater is running. Prevents dual heating." },

    // ── Anti-Freeze ───────────────────────────────────────────────────
    { group: "basic", key: "anti_freeze_enable", label: "Anti-freeze protection", type: "select",  default: "0", options: ["0","1"],
      help: "Periodically circulates the pump when the collector temperature is near freezing, preventing water from freezing in the solar panel pipes." },
    { group: "basic", key: "anti_freeze_temp",   label: "Anti-freeze below",      type: "number",  unit: "°C", step: 0.5, default: 4,
      help: "Collector temperature below which anti-freeze circulation activates. Should be above 0°C to give time before actual freezing." },
    { group: "basic", key: "anti_freeze_run_s",  label: "Pump run time",          type: "number",  unit: "s",  step: 5,   default: 30,
      help: "Duration of each anti-freeze pump burst. 20–60 seconds is typically sufficient to circulate warm water from the tank through the collectors." },

    // ── Legionella ────────────────────────────────────────────────────
    { group: "heater", key: "legionella_enable",   label: "Legionella cycle",         type: "select", default: "0", options: ["0","1"],
      help: "Periodically forces the boiler to 60°C to kill Legionella bacteria. Required by health regulations in some countries for DHW systems." },
    { group: "heater", key: "legionella_temp",     label: "Target temp",              type: "number", unit: "°C", step: 1,   default: 60,
      help: "Temperature the boiler must reach during the Legionella cycle. 60°C kills Legionella bacteria within minutes. Do not set below 60°C." },
    { group: "heater", key: "legionella_days",     label: "Cycle every N days",       type: "number", unit: "d",  step: 1,   default: 7,
      help: "How often to run the Legionella disinfection cycle (days). Weekly (7 days) is a common recommendation." },
    { group: "heater", key: "legionella_max_days", label: "Force if not hot for",     type: "number", unit: "d",  step: 1,   default: 3,
      help: "If the boiler has not naturally reached 60°C within this many days (e.g. insufficient solar), the electric heater is forced on to complete the Legionella cycle." },
  ],
};

const handler = solarEngineHandler;

function routes(app, ctx) {
  const { requireLogin, requireEngineerAccess, engine } = ctx;

  function getSolarAuto() {
    if (!engine) throw new Error('engine not in ctx');
    return {
      getSetpointsForInstance: (i)     => engine.getSettings(i),
      setSetpoint:             (i,k,v) => engine.setSetting(i,k,v),
      getLog:                  (i,n)   => engine.getLog(i,n),
      setOverride:             (i,p)   => engine.setOverride(i,p),
      getHistory:              (i,s)   => engine.getHistory(i, ['temp_solar','temp_boiler'], s),
      getLiveStatus:           (i)     => {
        const s  = engine.getLiveStatus(i);
        const sp = engine.getSettings(i);
        const toF = (v) => v !== undefined && v !== null ? parseFloat(v) : null;
        return {
          ...s,
          tempSolar:  toF(s.values?.temp_solar),
          tempBoiler: toF(s.values?.temp_boiler),
          diff: (toF(s.values?.temp_solar) !== null && toF(s.values?.temp_boiler) !== null)
                  ? Math.round((toF(s.values?.temp_solar) - toF(s.values?.temp_boiler)) * 10) / 10
                  : null,
          pumpOn:    s.values?.pump === 'ON',
          pumpSpeed: toF(s.values?.pump_speed),
          heaterOn:  s.values?.heater === 'ON',
          backupOn:  s.values?.backup === 'ON',
          setpoints: {
            profile:         sp.profile         ?? 'basic',
            dt_on:           parseFloat(sp.dt_on           ?? 8),
            dt_off:          parseFloat(sp.dt_off          ?? 3),
            dt_target:       parseFloat(sp.dt_target       ?? 10),
            max_boiler_temp: parseFloat(sp.max_boiler_temp ?? 85),
            min_solar_temp:  parseFloat(sp.min_solar_temp  ?? 40),
            test_mode:       String(sp.test_mode ?? '0'),
            heater_enable:   parseFloat(sp.heater_enable   ?? 0),
            heater_on_below: parseFloat(sp.heater_on_below ?? 40),
            heater_off_above:parseFloat(sp.heater_off_above?? 45),
            backup_enable:   parseFloat(sp.backup_enable   ?? 0),
            backup_on_below: parseFloat(sp.backup_on_below ?? 42),
            backup_off_above:parseFloat(sp.backup_off_above?? 47),
          },
        };
      },
    };
  }

  // GET /api/automation/solar/:id/setpoints
  app.get('/api/automation/solar/:id/setpoints', requireLogin, (req, res) => {
    try {
      const sp = getSolarAuto().getSetpointsForInstance(Number(req.params.id));
      res.json({ ok: true, setpoints: sp });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // PATCH /api/automation/solar/:id/setpoints
  app.patch('/api/automation/solar/:id/setpoints', requireEngineerAccess, (req, res) => {
    try {
      const id  = Number(req.params.id);
      const { key, value } = req.body || {};
      const v = getSolarAuto().setSetpoint(id, key, value);
      res.json({ ok: true, key, value: v });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // GET /api/automation/solar/:id/log
  app.get('/api/automation/solar/:id/log', requireLogin, (req, res) => {
    try {
      const log = getSolarAuto().getLog(Number(req.params.id), 100);
      res.json({ ok: true, log });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/automation/solar/:id/history?hours=4
  app.get('/api/automation/solar/:id/history', requireLogin, (req, res) => {
    try {
      const hours = Math.min(Number(req.query.hours) || 4, 24);
      const since = Date.now() - hours * 3600 * 1000;
      const data  = getSolarAuto().getHistory(Number(req.params.id), since);
      res.json({ ok: true, history: data });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/automation/solar/:id/override  { paused: true/false }
  app.post('/api/automation/solar/:id/override', requireEngineerAccess, (req, res) => {
    try {
      const paused = !!req.body.paused;
      getSolarAuto().setOverride(Number(req.params.id), paused);
      res.json({ ok: true, paused });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/automation/solar/:id/status
  app.get('/api/automation/solar/:id/status', requireLogin, (req, res) => {
    try {
      const status = getSolarAuto().getLiveStatus(Number(req.params.id));
      res.json({ ok: true, ...status });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
