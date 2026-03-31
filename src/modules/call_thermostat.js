const { CALL_THERMOSTAT_MODULE, callThermostatHandler, setManual, clearManual } = require('../automation/call_thermostat');

const MODULE  = CALL_THERMOSTAT_MODULE;
const handler = callThermostatHandler;

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  app.post('/api/automation/call_thermostat/:id/control', requireLogin, (req, res) => {
    try {
      const id     = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'call_thermostat' && !!ui.user_control);
      if (!access) return;
      const body = req.body || {};
      const out  = {};

      if (body.mode !== undefined) {
        const mode = String(body.mode || '').toLowerCase();
        if (!['heating','cooling','off'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_mode' });
        engine.setSetting(id, 'mode', mode);
        out.mode = mode;
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
