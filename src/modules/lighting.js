// src/modules/lighting.js
// Lighting module — MODULE definition + engine handler + API routes

const { lightingHandler, LIGHTING_MODULE, setManual } = require('../automation/lighting');

const MODULE = LIGHTING_MODULE;

const handler = lightingHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  // POST /api/automation/lighting/:id/manual  { on: true|false }
  app.post('/api/automation/lighting/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'lighting' && !!ui.user_control);
      if (!access) return;
      const on = req.body.on !== false && req.body.on !== 0;
      setManual(id, !!on);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/automation/lighting/:id/level
  app.post('/api/automation/lighting/:id/level', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'lighting' && !!ui.user_control);
      if (!access) return;
      const level = Math.max(0, Math.min(100, Number(req.body?.level)));
      if (!Number.isFinite(level)) return res.status(400).json({ ok: false, error: 'invalid_level' });
      const ctx2 = engine.makeCtx(access.inst);
      const io = ctx2.io('dimmer_output') || ctx2.io('light_relay');
      if (!io) return res.status(404).json({ ok: false, error: 'output_not_mapped' });
      const value = String(io.type || '').toUpperCase() === 'DO' || String(io.type || '').toLowerCase() === 'relay'
        ? (level > 0 ? 'ON' : 'OFF')
        : String(Math.round(level));
      const out = engine.sendIOCommand(io, value, { instanceId: id, moduleId: access.inst.module_id, inputKey: 'manual_level', reason: 'Lighting level control' });
      if (out?.blocked) return res.status(409).json({ ok: false, error: 'io_forced', forced: out.forced });
      if (!out?.ok) return res.status(500).json({ ok: false, error: out?.error || 'send_failed' });
      res.json({ ok: true, level: Math.round(level), value: out.value });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
