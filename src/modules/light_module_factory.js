// src/modules/light_module_factory.js
// Factory for light module wrappers — eliminates 90% code duplication
// across basic_light, motion_light, staircase, interlocked_switches,
// scheduled_light, scheduled_motion, daylight_light, motion_daylight, lighting.

'use strict';

function createLightModule({ moduleId, handlerName, automationPath, extraRoutes }) {
  const automation = require(`../automation/${automationPath}`);
  const MODULE = automation[moduleId];
  const handler = automation[handlerName];

  function routes(app, ctx) {
    const { requireLogin, engine, ensureUserModuleAccess } = ctx;

    app.post(`/api/automation/${automationPath}/:id/manual`, requireLogin, (req, res) => {
      try {
        const id = Number(req.params.id);
        const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === automationPath && !!ui.user_control);
        if (!access) return;
        if (req.body.on === undefined || req.body.on === null) {
          return res.status(400).json({ ok: false, error: 'missing_on_field' });
        }
        const on = Boolean(req.body.on);
        automation.setManual(id, on);
        engine.evaluate(access.inst);
        res.json({ ok: true, id, on });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    app.post(`/api/automation/${automationPath}/:id/clear-manual`, requireLogin, (req, res) => {
      try {
        const id = Number(req.params.id);
        const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === automationPath && !!ui.user_control);
        if (!access) return;
        automation.clearManual(id);
        engine.evaluate(access.inst);
        res.json({ ok: true, id, cleared: true });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    if (extraRoutes && typeof extraRoutes === 'function') {
      extraRoutes(app, ctx, { requireLogin, engine, ensureUserModuleAccess, automation, automationPath });
    }
  }

  return { MODULE, handler, routes };
}

module.exports = { createLightModule };
