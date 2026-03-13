// src/modules/energy.js
// Energy Monitor module — MODULE definition + engine handler + API routes

const { energyHandler, ENERGY_MODULE } = require('../automation/energy');

const MODULE = ENERGY_MODULE;

const handler = energyHandler;

function routes(app, ctx) {
  const { requireLogin, engine } = ctx;

  // GET /api/energy/:instance_id/status
  app.get('/api/energy/:instance_id/status', requireLogin, (req, res) => {
    try {
      const s = engine.getLiveStatus(Number(req.params.instance_id));
      res.json({ ok: true, ...s });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
