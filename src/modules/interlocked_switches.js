const {
  INTERLOCKED_SWITCHES_MODULE,
  interlockedSwitchesHandler,
  setManual,
  clearManual,
} = require('../automation/interlocked_switches');

const MODULE = INTERLOCKED_SWITCHES_MODULE;
const handler = interlockedSwitchesHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/interlocked_switches/:id/manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(
        req,
        res,
        id,
        ({ def, ui }) => def?.id === 'interlocked_switches' && !!ui.user_control
      );
      if (!access) return;
      const on = req.body.on !== false && req.body.on !== 0;
      setManual(id, !!on);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, on });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/automation/interlocked_switches/:id/clear-manual', requireLogin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(
        req,
        res,
        id,
        ({ def, ui }) => def?.id === 'interlocked_switches' && !!ui.user_control
      );
      if (!access) return;
      clearManual(id);
      engine.evaluate(access.inst);
      res.json({ ok: true, id, cleared: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { MODULE, handler, routes };
