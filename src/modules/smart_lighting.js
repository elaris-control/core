// src/modules/smart_lighting.js
// Smart Lighting v2 — Scenarios + Adaptive Brightness + Follow-Me + Sunrise/Sleep

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
      const release = !!req.body.release;
      const settings   = engine.getSettings(instId);
      let scenarios = [];
      try { scenarios = JSON.parse(settings.scenarios || '[]'); } catch (_) {
        return res.status(400).json({ ok: false, error: 'invalid_scenarios_data' });
      }
      const scenario   = scenarioId ? scenarios.find(s => s.id === scenarioId) : null;
      if (scenarioId && !scenario) return res.status(404).json({ ok: false, error: 'scenario not found' });

      const inst = access.inst;
      const mappings = engine.getMappings(instId);
      const send = (inputKey, value, reason) => {
        const m = mappings.find(x => x.input_key === inputKey);
        if (m?.io_id) {
          const io = engine.getIO(m.io_id);
          if (io) {
            const out = engine.sendIOCommand(io, value, { instanceId: instId, moduleId: inst.module_id, inputKey, reason: reason || 'manual smart lighting' });
            if (out?.ok) {
              engine.logAction(instId, inputKey + '_' + out.value, reason || 'manual');
            }
            return out;
          }
        }
        return { ok: false, error: 'mapping_not_found' };
      };

      if (release) {
        const current = slActiveScenario.get(instId);
        if (current) {
          const entry = { id: current.id, name: current.name, ts: Date.now(), reason: current.reason, manual: false };
          slActiveScenario.set(instId, entry);
          engine.setSetting(instId, '_active_scenario', JSON.stringify(entry));
          engine.broadcastState?.({
            type: 'module_state',
            instance_id: instId,
            module_id: 'smart_lighting',
            state: {
              status: current.id ? 'active' : 'idle',
              active_scene: current.id || null,
              active_scene_name: current.name || null,
              manual_override: false,
              motion_active: false,
              schedule_active: false,
              last_reason: current.reason || 'Released to auto'
            }
          });
          return res.json({ ok: true, released: true, scenario: current.name, manual: false });
        }
        return res.json({ ok: true, released: false, message: 'No active scenario to release' });
      }

      if (!scenario) {
        for (const m of mappings) {
          if (!m.input_key || (!m.input_key.startsWith('do_') && !m.input_key.startsWith('ao_'))) continue;
          send(m.input_key, m.input_key.startsWith('do_') ? 'OFF' : 0, 'Manual: scenario off');
        }
        const entry = { id: null, name: null, ts: Date.now(), reason: 'Manual: off', manual: true };
        slActiveScenario.set(instId, entry);
        engine.setSetting(instId, '_active_scenario', JSON.stringify(entry));
        engine.broadcastState?.({
          type: 'module_state',
          instance_id: instId,
          module_id: 'smart_lighting',
          state: {
            status: 'idle',
            active_scene: null,
            active_scene_name: null,
            manual_override: true,
            motion_active: false,
            schedule_active: false,
            last_reason: 'Manual: off'
          }
        });
        return res.json({ ok: true, scenario: null, active: false });
      }

      for (const out of (scenario.outputs || [])) {
        if (!out.io_key) continue;
        const isRelay = out.io_key.startsWith('do_');
        send(out.io_key, isRelay ? (out.level >= 50 ? 'ON' : 'OFF') : Math.round(out.level ?? 100), 'Manual: ' + scenario.name);
      }
      const entry = { id: scenario.id, name: scenario.name, ts: Date.now(), reason: 'Manual: ' + scenario.name, manual: true };
      slActiveScenario.set(instId, entry);
      engine.setSetting(instId, '_active_scenario', JSON.stringify(entry));
      engine.broadcastState?.({
        type: 'module_state',
        instance_id: instId,
        module_id: 'smart_lighting',
        state: {
          status: 'active',
          active_scene: scenario.id,
          active_scene_name: scenario.name,
          manual_override: true,
          motion_active: false,
          schedule_active: false,
          last_reason: 'Manual: ' + scenario.name
        }
      });

      res.json({ ok: true, scenario: scenario.name, active: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { MODULE, handler, routes };
