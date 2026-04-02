// src/modules/thermostat.js
// Thermostat module — MODULE definition + engine handler + API routes

const { thermostatHandler, THERMOSTAT_MODULE } = require('../automation/thermostat');

const MODULE = THERMOSTAT_MODULE;

const handler = thermostatHandler;

function routes(app, ctx) {
  const { requireLogin, engine, getModule, isEngineerLike, ensureUserModuleAccess } = ctx;

  // POST /api/automation/thermostat/:id/control
  app.post('/api/automation/thermostat/:id/control', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'thermostat' && !!ui.user_control);
      if (!access) return;
      const body = req.body || {};
      const out = {};
      if (body.setpoint !== undefined) {
        const setpoint = Math.max(5, Math.min(45, Number(body.setpoint)));
        if (!Number.isFinite(setpoint)) return res.status(400).json({ ok: false, error: 'invalid_setpoint' });
        out.setpoint = engine.setSetting(id, 'setpoint', String(Math.round(setpoint * 10) / 10));
      }
      if (body.mode !== undefined) {
        const mode = String(body.mode || '').toLowerCase();
        if (!['cooling', 'heating', 'off'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_mode' });
        out.mode = engine.setSetting(id, 'mode', mode);
      }
      // Per-zone setpoints: zone_1_setpoint … zone_6_setpoint
      for (let z = 1; z <= 6; z++) {
        const zKey = `zone_${z}_setpoint`;
        if (body[zKey] !== undefined) {
          const v = body[zKey] === null || body[zKey] === '' ? null : Math.max(5, Math.min(45, Number(body[zKey])));
          if (v !== null && !Number.isFinite(v)) continue;
          engine.setSetting(id, zKey, v === null ? '' : String(Math.round(v * 10) / 10));
          out[zKey] = v;
        }
      }
      // Per-zone names: zone_1_name … zone_6_name
      for (let z = 1; z <= 6; z++) {
        const nKey = `zone_${z}_name`;
        if (body[nKey] !== undefined) {
          const name = String(body[nKey] || '').trim().slice(0, 32);
          engine.setSetting(id, nKey, name);
          out[nKey] = name;
        }
      }
      // Delta setpoint: apply to global + all mapped temp-sensor zones
      if (body.setpoint_delta !== undefined) {
        const delta = Number(body.setpoint_delta);
        if (!Number.isFinite(delta) || Math.abs(delta) > 5) return res.status(400).json({ ok: false, error: 'invalid_delta' });
        const curGlobal = Number(engine.getSetting(id, 'setpoint') ?? 21);
        const newGlobal = Math.max(5, Math.min(45, Math.round((curGlobal + delta) * 10) / 10));
        engine.setSetting(id, 'setpoint', String(newGlobal));
        out.setpoint = newGlobal;
        const allMappings = (access.inst.mappings || []);
        for (let z = 1; z <= 6; z++) {
          const hasTempSensor = allMappings.some(m => m.input_key === `zone_${z}_temp` && m.io_id);
          if (!hasTempSensor) continue;
          const cur = engine.getSetting(id, `zone_${z}_setpoint`);
          const curV = (cur !== null && cur !== '' && cur !== undefined && Number.isFinite(Number(cur))) ? Number(cur) : curGlobal;
          const newV = Math.max(5, Math.min(45, Math.round((curV + delta) * 10) / 10));
          engine.setSetting(id, `zone_${z}_setpoint`, String(newV));
          out[`zone_${z}_setpoint`] = newV;
        }
      }
      // Global override: set all zones at once
      if (body.all_zones_setpoint !== undefined) {
        const v = Math.max(5, Math.min(45, Number(body.all_zones_setpoint)));
        if (Number.isFinite(v)) {
          for (let z = 1; z <= 6; z++) engine.setSetting(id, `zone_${z}_setpoint`, String(Math.round(v * 10) / 10));
          engine.setSetting(id, 'setpoint', String(Math.round(v * 10) / 10));
          out.all_zones_setpoint = v;
        }
      }
      if (!Object.keys(out).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      engine.evaluate(access.inst);
      res.json({ ok: true, changed: out });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
