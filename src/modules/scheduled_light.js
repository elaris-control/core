const { SCHEDULED_LIGHT_MODULE, scheduledLightHandler, setManual, clearManual } = require('../automation/scheduled_light');

const MODULE  = SCHEDULED_LIGHT_MODULE;
const handler = scheduledLightHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/scheduled_light/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'scheduled_light' && !!ui.user_control);
      if (!access) return;
      setManual(id, req.body.on !== false && req.body.on !== 0);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on: !!req.body.on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/scheduled_light/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'scheduled_light' && !!ui.user_control);
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
