const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'LIGHTING_MODULE',
  handlerName: 'lightingHandler',
  automationPath: 'lighting',
  extraRoutes: (app, ctx, { requireLogin, engine, ensureUserModuleAccess, automation, automationPath }) => {
    app.post(`/api/automation/${automationPath}/:id/level`, requireLogin, (req, res) => {
      try {
        const id = Number(req.params.id);
        const access = ensureUserModuleAccess(req, res, id, ({ def, ui }) => def?.id === automationPath && !!ui.user_control);
        if (!access) return;
        const level = Math.max(0, Math.min(100, Number(req.body?.level)));
        if (!Number.isFinite(level)) return res.status(400).json({ ok: false, error: 'invalid_level' });
        // Set manual override (on if level > 0) and store level as setting
        automation.setManual(id, level > 0);
        engine.setSetting(id, 'manual_level', String(Math.round(level)));
        engine.evaluate(access.inst);
        res.json({ ok: true, id, level: Math.round(level) });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });
  },
});
