const { BASIC_LIGHT_MODULE, basicLightHandler, setManual, clearManual } = require('../automation/basic_light');

const MODULE  = BASIC_LIGHT_MODULE;
const handler = basicLightHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/basic_light/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'basic_light' && !!ui.user_control);
      if (!access) return;
      const on = req.body.on !== false && req.body.on !== 0;
      setManual(id, !!on);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/basic_light/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'basic_light' && !!ui.user_control);
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
