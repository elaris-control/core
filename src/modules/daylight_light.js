const { DAYLIGHT_LIGHT_MODULE, daylightLightHandler, setManual, clearManual } = require('../automation/daylight_light');

const MODULE  = DAYLIGHT_LIGHT_MODULE;
const handler = daylightLightHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/daylight_light/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'daylight_light' && !!ui.user_control);
      if (!access) return;
      setManual(id, req.body.on !== false && req.body.on !== 0);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on: !!req.body.on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/daylight_light/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'daylight_light' && !!ui.user_control);
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
