'use strict';
// src/api/middleware.js
// Shared middleware factories used across route files.

const { getModule } = require('../modules/index');

/**
 * Build the isEngineerLike / getInstanceWithDefinition / ensureUserModuleAccess
 * helpers that need runtime references to engine + access + auth.
 */
function makeModuleHelpers({ engine, access, auth }) {
  function isEngineerLike(req) {
    if (!req?.user) return false;
    const unlocked  = auth.getRole(req) === 'ENGINEER';
    const userRole  = String(req.user?.role || 'USER').toUpperCase();
    return userRole === 'ADMIN' || userRole === 'ENGINEER' || unlocked;
  }

  function getInstanceWithDefinition(instanceId) {
    const inst = engine._getInstances.all().find(i => i.id === Number(instanceId));
    if (!inst) return { inst: null, def: null, ui: null };
    const def = getModule(inst.module_id);
    return { inst, def, ui: def?.ui || {} };
  }

  function ensureUserModuleAccess(req, res, instanceId, check) {
    const { inst, def, ui } = getInstanceWithDefinition(instanceId);
    if (!inst || !def) {
      res.status(404).json({ ok: false, error: 'instance_not_found' });
      return null;
    }
    if (!access.canAccessSite(req, inst.site_id)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return null;
    }
    if (isEngineerLike(req)) return { inst, def, ui };
    const allowed = typeof check === 'function' ? !!check({ inst, def, ui }) : false;
    if (!allowed) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return null;
    }
    return { inst, def, ui };
  }

  return { isEngineerLike, getInstanceWithDefinition, ensureUserModuleAccess };
}

module.exports = { makeModuleHelpers };
