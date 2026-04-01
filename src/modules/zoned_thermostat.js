const { ZONED_THERMOSTAT_MODULE, zonedThermostatHandler, setManual, clearManual } = require('../automation/zoned_thermostat');

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
        engine.setSetting(id, 'setpoint', String(Math.round(v * 10) / 10));
        out.setpoint = v;
      }
      // all_zones_setpoint: apply same setpoint to global + all zones
      if (body.all_zones_setpoint !== undefined) {
        const v = Math.max(5, Math.min(45, Number(body.all_zones_setpoint)));
        if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: 'invalid_all_zones_setpoint' });
        const rounded = Math.round(v * 10) / 10;
        engine.setSetting(id, 'setpoint', String(rounded));
        out.setpoint = rounded;
        out.all_zones_setpoint = rounded;
        for (let n = 1; n <= 6; n++) {
          engine.setSetting(id, `zone_${n}_setpoint`, String(rounded));
          out[`zone_${n}_setpoint`] = rounded;
        }
      }
      // setpoint_delta: apply to global + all temp-sensor zones that have an override
      if (body.setpoint_delta !== undefined) {
        const delta = Number(body.setpoint_delta);
        if (!Number.isFinite(delta) || Math.abs(delta) > 5) return res.status(400).json({ ok: false, error: 'invalid_delta' });
        const curGlobal = Number(engine.getSetting(id, 'setpoint') ?? 21);
        const newGlobal = Math.max(5, Math.min(45, Math.round((curGlobal + delta) * 10) / 10));
        engine.setSetting(id, 'setpoint', String(newGlobal));
        out.setpoint = newGlobal;
        // Apply delta to per-zone overrides for temp-sensor zones only
        for (let n = 1; n <= 6; n++) {
          const hasTempSensor = (access.inst.mappings || []).some(m => m.input_key === `zone_${n}_temp` && m.io_id);
          if (!hasTempSensor) continue;
          const cur = engine.getSetting(id, `zone_${n}_setpoint`);
          if (cur === null || cur === '' || cur === undefined) continue;
          const curV = Number(cur);
          if (!Number.isFinite(curV)) continue;
          const newV = Math.max(5, Math.min(45, Math.round((curV + delta) * 10) / 10));
          engine.setSetting(id, `zone_${n}_setpoint`, String(newV));
          out[`zone_${n}_setpoint`] = newV;
        }
      }
      for (let n = 1; n <= 6; n++) {
        const spKey      = `zone_${n}_setpoint`;
        const nameKey    = `zone_${n}_name`;
        const schedKey   = `zone_${n}_schedule`;
        if (body[spKey] !== undefined) {
          const raw = body[spKey];
          if (raw === null || raw === '') {
            engine.setSetting(id, spKey, '');
            out[spKey] = null;
          } else {
            const v = Math.max(5, Math.min(45, Number(raw)));
            if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: `invalid_${spKey}` });
            engine.setSetting(id, spKey, String(Math.round(v * 10) / 10));
            out[spKey] = v;
          }
        }
        if (body[nameKey] !== undefined) {
          engine.setSetting(id, nameKey, String(body[nameKey] || '').trim());
          out[nameKey] = String(body[nameKey] || '').trim();
        }
        if (body[schedKey] !== undefined) {
          engine.setSetting(id, schedKey, String(body[schedKey] || '').trim());
          out[schedKey] = String(body[schedKey] || '').trim();
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

      if (!Object.keys(out).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      engine.evaluate(access.inst);
      res.json({ ok: true, changed: out });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
