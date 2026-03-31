const { MOTION_LIGHT_MODULE, motionLightHandler, setManual, clearManual } = require('../automation/motion_light');

const MODULE  = MOTION_LIGHT_MODULE;
const handler = motionLightHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/motion_light/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'motion_light' && !!ui.user_control);
      if (!access) return;
      const on = req.body.on !== false && req.body.on !== 0;
      setManual(id, !!on);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/motion_light/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'motion_light' && !!ui.user_control);
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
