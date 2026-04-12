// src/modules/dimming_lighting.js
const {
  dimmingLightingHandler,
  DIMMING_LIGHTING_MODULE,
  dimmingLevel,
  dimmingLastReason,
} = require('../automation/dimming_lighting');

const MODULE  = DIMMING_LIGHTING_MODULE;
const handler = (ctx, send) => dimmingLightingHandler(ctx, send);

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  function applyWidgetLevel(instId, inst, newLevel, reason) {
    const safeLevel = Math.max(0, Math.min(100, Number(newLevel) || 0));
    dimmingLevel.set(instId, safeLevel);
    engine.setSetting(instId, '_level', String(safeLevel));
    dimmingLastReason.set(instId, reason);

    const mappings = engine.getMappings(instId);
    const aoMap = mappings.find(m => m.input_key === 'ao');
    if (aoMap?.io_id) {
      const io = engine.getIO(aoMap.io_id);
      if (io) {
        const out = engine.sendIOCommand(io, safeLevel, { instanceId: instId, moduleId: inst.module_id, inputKey: 'ao', reason });
        if (out?.ok) engine.logAction(instId, 'ao_' + String(out.value), reason);
      }
    }

    const doMap = mappings.find(m => m.input_key === 'do');
    if (doMap?.io_id) {
      const io = engine.getIO(doMap.io_id);
      if (io) {
        const doVal = safeLevel > 0 ? 'ON' : 'OFF';
        const out   = engine.sendIOCommand(io, doVal, { instanceId: instId, moduleId: inst.module_id, inputKey: 'do', reason });
        if (out?.ok) engine.logAction(instId, 'do_' + String(out.value), reason);
      }
    }

    engine.evaluate(inst);
    return safeLevel;
  }

  // POST /api/automation/dimming_lighting/:id/adjust
  // body: { direction: 'up' | 'down' }
  app.post('/api/automation/dimming_lighting/:id/adjust', requireLogin, (req, res) => {
    try {
      const instId = Number(req.params.id);
      if (!Number.isInteger(instId) || instId <= 0) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const access = ensureUserModuleAccess(
        req, res, instId,
        ({ def, ui }) => def?.id === 'dimming_lighting' && !!ui.user_control
      );
      if (!access) return;

      const direction = req.body?.direction;
      if (!['up', 'down', 'on', 'off'].includes(direction)) {
        return res.status(400).json({ ok: false, error: 'direction must be up, down, on, or off' });
      }

      const inst     = access.inst;
      const settings = engine.getSettings(instId);
      const step     = Math.max(1, Math.min(100, Number(settings.step || 10)));
      const current  = dimmingLevel.get(instId) ?? 0;
      let newLevel;
      if (direction === 'on') {
        newLevel = Math.max(0, Math.min(100, Number(settings.double_tap_up_level ?? 100)));
        if (newLevel === 0) newLevel = 100;
      } else if (direction === 'off') {
        newLevel = 0;
      } else {
        newLevel = direction === 'up'
          ? Math.min(100, current + step)
          : Math.max(0, current - step);
      }

      const dirLabel = direction === 'on' ? 'Turn ON' : direction === 'off' ? 'Turn OFF' : direction === 'up' ? 'Up' : 'Down';
      const reason   = `Widget ${dirLabel}: ${newLevel}%`;
      const applied = applyWidgetLevel(instId, access.inst, newLevel, reason);
      res.json({ ok: true, level: applied, direction });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/automation/dimming_lighting/:id/level', requireLogin, (req, res) => {
    try {
      const instId = Number(req.params.id);
      if (!Number.isInteger(instId) || instId <= 0) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const access = ensureUserModuleAccess(
        req, res, instId,
        ({ def, ui }) => def?.id === 'dimming_lighting' && !!ui.user_control
      );
      if (!access) return;

      const requested = Number(req.body?.level);
      if (!Number.isFinite(requested)) return res.status(400).json({ ok: false, error: 'invalid_level' });

      const safeLevel = Math.max(0, Math.min(100, Math.round(requested)));
      const reason = `Widget Set: ${safeLevel}%`;
      const applied = applyWidgetLevel(instId, access.inst, safeLevel, reason);
      res.json({ ok: true, level: applied });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
