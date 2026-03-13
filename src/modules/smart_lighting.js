// src/modules/smart_lighting.js
// Smart Lighting module — MODULE definition + engine handler + API routes

const { smartLightingHandler, SMART_LIGHTING_MODULE, activeScenario: slActiveScenario } = require('../automation/smart_lighting');

const MODULE = SMART_LIGHTING_MODULE;

const handler = (ctx, send, si) => smartLightingHandler(ctx, send, si);

function routes(app, ctx) {
  const { requireLogin, engine, ensureUserModuleAccess } = ctx;

  // GET /api/automation/smart_lighting/:id/status
  app.get('/api/automation/smart_lighting/:id/status', requireLogin, (req, res) => {
    const instId = Number(req.params.id);
    const access = ensureUserModuleAccess(req, res, instId, ({ def, ui }) => def?.id === 'smart_lighting' && !!ui.user_view);
    if (!access) return;
    const active = slActiveScenario.get(instId) || null;
    const s = engine.getSettings(instId);
    let scenarios = [];
    try { scenarios = JSON.parse(s.scenarios || '[]'); } catch (_) {}
    res.json({ ok: true, active_scenario: active, scenario_count: scenarios.length });
  });

  // POST /api/automation/smart_lighting/:id/activate
  app.post('/api/automation/smart_lighting/:id/activate', requireLogin, (req, res) => {
    try {
      const instId = Number(req.params.id);
      const access = ensureUserModuleAccess(req, res, instId, ({ def, ui }) => def?.id === 'smart_lighting' && !!ui.user_control);
      if (!access) return;
      const scenarioId = req.body.scenario_id;
      const settings   = engine.getSettings(instId);
      const scenarios  = JSON.parse(settings.scenarios || '[]');
      const scenario   = scenarioId ? scenarios.find(s => s.id === scenarioId) : null;
      if (scenarioId && !scenario) return res.status(404).json({ ok: false, error: 'scenario not found' });

      const inst = access.inst;
      const mappings = engine._getMappings.all(instId);
      const send = (inputKey, value, reason) => {
        const m = mappings.find(x => x.input_key === inputKey);
        if (m?.io_id) {
          const io = engine._getIOById.get(m.io_id);
          if (io) {
            const out = engine.sendIOCommand(io, value, { instanceId: instId, moduleId: inst.module_id, inputKey, reason: reason || 'manual smart lighting' });
            if (out?.ok) {
              engine._logAction.run({ instance_id: instId, action: inputKey + '_' + out.value, reason: reason || 'manual', ts: Date.now() });
            }
            return out;
          }
        }
        return { ok: false, error: 'mapping_not_found' };
      };

      if (!scenario) {
        for (const m of mappings) {
          if (!m.input_key || (!m.input_key.startsWith('do_') && !m.input_key.startsWith('ao_'))) continue;
          send(m.input_key, m.input_key.startsWith('do_') ? 'OFF' : 0, 'Manual: scenario off');
        }
        slActiveScenario.delete(instId);
        return res.json({ ok: true, scenario: null, active: false });
      }

      for (const out of (scenario.outputs || [])) {
        if (!out.io_key) continue;
        const isRelay = out.io_key.startsWith('do_');
        send(out.io_key, isRelay ? (out.level >= 50 ? 'ON' : 'OFF') : Math.round(out.level ?? 100), 'Manual: ' + scenario.name);
      }
      slActiveScenario.set(instId, scenario);

      res.json({ ok: true, scenario: scenario.name, active: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
