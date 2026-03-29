// src/modules/staircase.js
const { staircaseHandler, STAIRCASE_MODULE, setManual, clearManual } = require('../automation/staircase');

const MODULE = STAIRCASE_MODULE;
const handler = staircaseHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/staircase/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'staircase' && !!ui.user_control);
      if (!access) return;
      const on = req.body.on !== false && req.body.on !== 0;
      setManual(id, !!on);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/staircase/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'staircase' && !!ui.user_control);
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
