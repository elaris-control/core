const { ZONED_THERMOSTAT_MODULE, zonedThermostatHandler, setManual, clearManual, setZoneManual, clearZoneManual } = require('../automation/zoned_thermostat');
const { MAX_ZONES, applySetpointDelta } = require('../automation/helpers/thermostat_common');

const MODULE  = ZONED_THERMOSTAT_MODULE;
const handler = zonedThermostatHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/zoned_thermostat/:id/control', requireLogin, (req, res) => {
    try {
      const id     = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'zoned_thermostat' && !!ui.user_control);
      if (!access) return;
      const body = req.body || {};
      const out  = {};

      if (body.mode !== undefined) {
        const mode = String(body.mode || '').toLowerCase();
        if (!['heating','cooling','off'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_mode' });
        engine.setSetting(id, 'mode', mode);
        out.mode = mode;
      }
      if (body.setpoint !== undefined) {
        const v = Math.max(5, Math.min(45, Number(body.setpoint)));
        if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: 'invalid_setpoint' });
        const rounded = String(Math.round(v * 10) / 10);
        engine.setSetting(id, 'setpoint', rounded);
        // Propagate global setpoint to all zones
        for (let n = 1; n <= MAX_ZONES; n++) engine.setSetting(id, `zone_${n}_setpoint`, rounded);
        out.setpoint = v;
      }
      // setpoint_delta: apply to global + all mapped temp-sensor zones
      if (body.setpoint_delta !== undefined) {
        const delta = Number(body.setpoint_delta);
        const deltaOut = applySetpointDelta(engine, id, access.inst.mappings, delta);
        if (!deltaOut) return res.status(400).json({ ok: false, error: 'invalid_delta' });
        Object.assign(out, deltaOut);
      }
      for (let n = 1; n <= MAX_ZONES; n++) {
        const spKey      = `zone_${n}_setpoint`;
        const nameKey    = `zone_${n}_name`;
        const schedKey   = `zone_${n}_schedule`;
        if (body[spKey] !== undefined) {
          const v = Math.max(5, Math.min(45, Number(body[spKey])));
          if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: `invalid_${spKey}` });
          engine.setSetting(id, spKey, String(Math.round(v * 10) / 10));
          out[spKey] = v;
        }
        if (body[nameKey] !== undefined) {
          engine.setSetting(id, nameKey, String(body[nameKey] || '').trim().slice(0, 32));
          out[nameKey] = String(body[nameKey] || '').trim().slice(0, 32);
        }
        if (body[schedKey] !== undefined) {
          engine.setSetting(id, schedKey, String(body[schedKey] || '').trim());
          out[schedKey] = String(body[schedKey] || '').trim();
        }
      }
      // Global override: set all zones at once
      if (body.all_zones_setpoint !== undefined) {
        const v = Math.max(5, Math.min(45, Number(body.all_zones_setpoint)));
        if (Number.isFinite(v)) {
          for (let n = 1; n <= MAX_ZONES; n++) engine.setSetting(id, `zone_${n}_setpoint`, String(Math.round(v * 10) / 10));
          engine.setSetting(id, 'setpoint', String(Math.round(v * 10) / 10));
          out.all_zones_setpoint = v;
        }
      }
      if (body.manual !== undefined) {
        setManual(id, !!body.manual);
        out.manual = !!body.manual;
      }
      if (body.clear_manual) {
        clearManual(id);
        out.cleared_manual = true;
      }
      if (body.zone_manual !== undefined) {
        const zone = Number(body.zone_manual);
        if (zone >= 1 && zone <= MAX_ZONES) {
          setZoneManual(id, zone, !!body.on);
          out.zone_manual = zone;
          out.on = !!body.on;
        }
      }
      if (body.clear_zone_manual !== undefined) {
        const zone = Number(body.clear_zone_manual);
        if (zone >= 1 && zone <= MAX_ZONES) {
          clearZoneManual(id, zone);
          out.cleared_zone_manual = zone;
        }
      }

      if (!Object.keys(out).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      engine.evaluate(access.inst);
      res.json({ ok: true, changed: out });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
