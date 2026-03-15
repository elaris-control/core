function initAccess({ db, auth }) {
  const getSiteStmt = db.prepare(`
    SELECT id AS site_id, name AS site_name, is_private, lat, lon, timezone, address, note
    FROM sites
    WHERE id = ?
    LIMIT 1
  `);

  const getDeviceSiteStmt = db.prepare(`
    SELECT ds.device_id, s.id AS site_id, s.name AS site_name, s.is_private
    FROM device_site ds
    JOIN sites s ON s.id = ds.site_id
    WHERE ds.device_id = ?
    LIMIT 1
  `);

  const getIoSiteStmt = db.prepare(`
    SELECT io.id AS io_id, ds.site_id, s.name AS site_name, s.is_private
    FROM io
    LEFT JOIN device_site ds ON ds.device_id = io.device_id
    LEFT JOIN sites s ON s.id = ds.site_id
    WHERE io.id = ?
    LIMIT 1
  `);

  const getModuleInstanceSiteStmt = db.prepare(`
    SELECT mi.id AS instance_id, mi.site_id, s.name AS site_name, s.is_private
    FROM module_instances mi
    LEFT JOIN sites s ON s.id = mi.site_id
    WHERE mi.id = ? AND mi.active = 1
    LIMIT 1
  `);

  const getSceneSiteStmt = db.prepare(`
    SELECT sc.id AS scene_id, sc.site_id, s.name AS site_name, s.is_private
    FROM scenes sc
    LEFT JOIN sites s ON s.id = sc.site_id
    WHERE sc.id = ?
    LIMIT 1
  `);

  const getSceneScheduleSiteStmt = db.prepare(`
    SELECT ss.id AS schedule_id, sc.site_id, s.name AS site_name, s.is_private
    FROM scene_schedules ss
    JOIN scenes sc ON sc.id = ss.scene_id
    LEFT JOIN sites s ON s.id = sc.site_id
    WHERE ss.id = ?
    LIMIT 1
  `);

  function currentRole(req) {
    const userRole = String(req?.user?.role || "").toUpperCase();
    if (userRole === "ADMIN" || userRole === "ENGINEER") return userRole;
    const unlockRole = typeof auth?.getRole === "function" ? auth.getRole(req) : null;
    if (unlockRole === "ENGINEER") return "ENGINEER";
    return req?.user ? "USER" : null;
  }

  function canSeePrivate(req) {
    const role = currentRole(req);
    return role === "ADMIN" || role === "ENGINEER";
  }

  function getSiteRef(siteId) {
    const n = Number(siteId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return getSiteStmt.get(n) || null;
  }

  function getDeviceSiteRef(deviceId) {
    const id = String(deviceId || "").trim();
    if (!id) return null;
    return getDeviceSiteStmt.get(id) || null;
  }

  function getIoSiteRef(ioId) {
    const n = Number(ioId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return getIoSiteStmt.get(n) || null;
  }

  function getModuleInstanceSiteRef(instanceId) {
    const n = Number(instanceId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return getModuleInstanceSiteStmt.get(n) || null;
  }

  function getSceneSiteRef(sceneId) {
    const n = Number(sceneId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return getSceneSiteStmt.get(n) || null;
  }

  function getSceneScheduleSiteRef(scheduleId) {
    const n = Number(scheduleId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return getSceneScheduleSiteStmt.get(n) || null;
  }

  function canAccessSiteRef(req, ref) {
    if (!ref) return false;
    if (ref.site_id == null) return true;
    return !ref.is_private || canSeePrivate(req);
  }

  function canAccessSite(req, siteId) {
    if (siteId == null) return true; // unassigned → visible to all logged-in users
    return canAccessSiteRef(req, getSiteRef(siteId));
  }

  return {
    currentRole,
    canSeePrivate,
    canAccessSite,
    canAccessSiteRef,
    getSiteRef,
    getDeviceSiteRef,
    getIoSiteRef,
    getModuleInstanceSiteRef,
    getSceneSiteRef,
    getSceneScheduleSiteRef,
  };
}

module.exports = { initAccess };
