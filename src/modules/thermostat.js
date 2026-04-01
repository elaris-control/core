// src/modules/thermostat.js
// Thermostat module — MODULE definition + engine handler + API routes

const { thermostatHandler, THERMOSTAT_MODULE } = require('../automation/thermostat');

const MODULE = THERMOSTAT_MODULE;
const handler = thermostatHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/thermostat/:id/control', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'thermostat' && !!ui.user_control);
      if (!access) return;

      const body = req.body || {};
      const out = {};
      const hasTempSensor = (z) => (access.inst.mappings || []).some(m => m.input_key === `zone_${z}_temp` && m.io_id);
      const applyGlobalToSensorZones = (value) => {
        for (let z = 1; z <= 6; z++) {
          if (!hasTempSensor(z)) continue;
          engine.setSetting(id, `zone_${z}_setpoint`, String(value));
          out[`zone_${z}_setpoint`] = value;
        }
      };

      if (body.setpoint !== undefined) {
        const setpoint = Math.max(5, Math.min(45, Number(body.setpoint)));
        if (!Number.isFinite(setpoint)) return res.status(400).json({ ok: false, error: 'invalid_setpoint' });
        const rounded = Math.round(setpoint * 10) / 10;
        engine.setSetting(id, 'setpoint', String(rounded));
        out.setpoint = rounded;
        applyGlobalToSensorZones(rounded);
      }

      if (body.mode !== undefined) {
        const mode = String(body.mode || '').toLowerCase();
        if (!['cooling', 'heating', 'off'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_mode' });
        out.mode = engine.setSetting(id, 'mode', mode);
      }

      for (let z = 1; z <= 6; z++) {
        const zKey = `zone_${z}_setpoint`;
        if (body[zKey] === undefined) continue;
        if (!hasTempSensor(z)) return res.status(400).json({ ok: false, error: `zone_${z}_requires_sensor` });
        const v = body[zKey] === null || body[zKey] === '' ? null : Math.max(5, Math.min(45, Number(body[zKey])));
        if (v !== null && !Number.isFinite(v)) return res.status(400).json({ ok: false, error: `invalid_${zKey}` });
        engine.setSetting(id, zKey, v === null ? '' : String(Math.round(v * 10) / 10));
        out[zKey] = v;
      }

      for (let z = 1; z <= 6; z++) {
        const nKey = `zone_${z}_name`;
        if (body[nKey] === undefined) continue;
        const name = String(body[nKey] || '').trim().slice(0, 32);
        engine.setSetting(id, nKey, name);
        out[nKey] = name;
      }

      if (body.setpoint_delta !== undefined) {
        const delta = Number(body.setpoint_delta);
        if (!Number.isFinite(delta) || Math.abs(delta) > 5) return res.status(400).json({ ok: false, error: 'invalid_delta' });
        const curGlobal = Number(engine.getSetting(id, 'setpoint') ?? 21);
        const newGlobal = Math.max(5, Math.min(45, Math.round((curGlobal + delta) * 10) / 10));
        engine.setSetting(id, 'setpoint', String(newGlobal));
        out.setpoint = newGlobal;
        applyGlobalToSensorZones(newGlobal);
      }

      if (body.all_zones_setpoint !== undefined) {
        const v = Math.max(5, Math.min(45, Number(body.all_zones_setpoint)));
        if (!Number.isFinite(v)) return res.status(400).json({ ok: false, error: 'invalid_all_zones_setpoint' });
        const rounded = Math.round(v * 10) / 10;
        engine.setSetting(id, 'setpoint', String(rounded));
        out.setpoint = rounded;
        out.all_zones_setpoint = rounded;
        applyGlobalToSensorZones(rounded);
      }

      if (!Object.keys(out).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      engine.evaluate(access.inst);
      res.json({ ok: true, changed: out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { MODULE, handler, routes };
