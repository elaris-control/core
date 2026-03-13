// src/modules/awning.js
// Awning module — MODULE definition + engine handler + API routes

const { awningHandler, AWNING_MODULE } = require('../automation/awning');

const MODULE = AWNING_MODULE;

const handler = awningHandler;

function routes(app, ctx) {
  const { requireLogin, requireEngineerAccess, engine, ensureUserModuleAccess } = ctx;

  // POST /api/automation/awning/:id/control
  app.post('/api/automation/awning/:id/control', requireLogin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === 'awning' && !!ui.user_control);
      if (!access) return;
      const action = String(req.body?.action || '').toLowerCase();
      if (!['open', 'close', 'stop'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_action' });
      const engineCtx = engine.makeCtx(access.inst);
      const sendMapped = (relayKey, value) => {
        const io = engineCtx.io(relayKey);
        if (!io) return { ok: false, error: 'relay_not_mapped' };
        return engine.sendIOCommand(io, value, { instanceId: id, moduleId: access.inst.module_id, inputKey: relayKey, reason: `Awning ${action}` });
      };
      if (action === 'stop') {
        const r1 = sendMapped('relay_open', 'OFF');
        const r2 = sendMapped('relay_close', 'OFF');
        if ((r1 && r1.blocked) || (r2 && r2.blocked)) return res.status(409).json({ ok: false, error: 'io_forced' });
      } else {
        const relay = action === 'open' ? 'relay_open' : 'relay_close';
        const out = sendMapped(relay, 'ON');
        if (!out?.ok && out?.error === 'relay_not_mapped') return res.status(404).json({ ok: false, error: 'relay_not_mapped' });
        if (out?.blocked) return res.status(409).json({ ok: false, error: 'io_forced', forced: out.forced });
        if (!out?.ok) return res.status(500).json({ ok: false, error: out?.error || 'send_failed' });
      }
      res.json({ ok: true, action });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/automation/command/:id  — generic relay command (awning/lighting)
  app.post('/api/automation/command/:id', requireEngineerAccess, async (req, res) => {
    try {
      const instId = Number(req.params.id);
      const { relay, value } = req.body;
      if (!relay || !value) return res.status(400).json({ ok: false, error: 'relay and value required' });
      const inst = engine._getInstances.all().find(i => i.id === instId);
      if (!inst) return res.status(404).json({ ok: false, error: 'instance not found' });
      const engineCtx = engine.makeCtx(inst);
      const io = engineCtx.io(relay);
      if (!io) return res.status(404).json({ ok: false, error: 'relay not mapped: ' + relay });
      const out = engine.sendIOCommand(io, value, { instanceId: instId, moduleId: inst.module_id, inputKey: relay, reason: 'Manual automation command' });
      if (out?.blocked) return res.status(409).json({ ok: false, error: 'io_forced', forced: out.forced });
      if (!out?.ok) return res.status(500).json({ ok: false, error: out?.error || 'send_failed' });
      res.json({ ok: true, relay, value: out.value });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
