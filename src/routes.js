// src/routes.js
const express = require("express");
const { buildMePayload } = require("./session_info");

function initRoutes({ dbApi, mqttApi, auth, hasFeature, requireLogin, requireEngineerAccess, requireAdmin, users }) {
  const router = express.Router();

  // Helper: can this request see private sites?
  function canSeePrivate(req) {
    const userRole = req.user?.role || "USER";
    if (userRole === "ADMIN" || userRole === "ENGINEER") return true;
    return auth.getRole(req) === "ENGINEER";
  }

  router.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

  // session info (compat alias for /api/me)
  router.get("/me", (req, res) => {
    res.json(buildMePayload({
      req,
      users,
      auth,
      hasFeature,
    }));
  });

  // engineer unlock/lock
  router.post("/engineer/unlock", requireLogin, auth.unlockEngineer);
  router.post("/engineer/lock", requireLogin, auth.lockEngineer);

  // Everything below requires an authenticated session.
  router.use(requireLogin);

  // devices
  router.get("/devices", (req, res) => {
    const devices = dbApi.listDevicesFromState.all().map((r) => r.device_id);
    res.json({ devices });
  });

  router.get("/devices/:id/state", (req, res) => {
    const rows = dbApi.getDeviceState.all(req.params.id);
    res.json({ deviceId: req.params.id, state: rows });
  });

  router.get("/devices/:id/io", (req, res) => {
    const rows = dbApi.listIOByDevice.all(req.params.id);
    res.json({ deviceId: req.params.id, io: rows });
  });

  router.post("/devices/:id/command", requireEngineerAccess, (req, res) => {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: "Missing key" });
    const result = mqttApi.sendCommand(req.params.id, key, value ?? "TOGGLE");
    res.json({ ok: true, sent: result, ts: Date.now() });
  });

  // pending io (engineer)
  router.get("/pending-io", requireEngineerAccess, (req, res) => {
    const rows = dbApi.listPendingIO.all();
    res.json({ ok: true, pending: rows });
  });

  router.post("/pending-io/:id/approve", requireEngineerAccess, (req, res) => {
    try {
      const pending_id = Number(req.params.id);
      const { name, type, zone_id, site_id } = req.body || {};
      if (!name || !type) return res.status(400).json({ ok: false, error: "missing_fields" });

      // read device_id before approvePending deletes the row
      let device_id = null;
      try{
        const row = dbApi.db.prepare("SELECT device_id FROM pending_io WHERE id=?").get(pending_id);
        device_id = row?.device_id || null;
      }catch(_){}

      const out = dbApi.approvePending({ pending_id, name, type, zone_id });

      const sid = (site_id === undefined || site_id === null || site_id === "") ? null : Number(site_id);
      if (sid && Number.isFinite(sid) && device_id && dbApi.assignDeviceToSite) {
        dbApi.assignDeviceToSite(device_id, sid);
      }

      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/pending-io/:id", requireEngineerAccess, (req, res) => {
    const id = Number(req.params.id);
    dbApi.deletePendingIOAndBlock(id);
    res.json({ ok: true });
  });

  // zones (engineer for create; list is ok for all)
  router.get("/zones", (req, res) => {
    const site_id = req.query.site_id ? Number(req.query.site_id) : null;
    const zones = site_id ? dbApi.listZonesBySite.all(site_id) : dbApi.listZones.all();
    res.json({ ok: true, zones });
  });

  router.post("/zones", requireEngineerAccess, (req, res) => {
    const name    = String(req.body?.name || "").trim();
    const site_id = req.body?.site_id != null ? Number(req.body.site_id) : null;
    if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
    dbApi.createZone.run(name, site_id);
    res.json({ ok: true });
  });

  // rename zone
  router.post("/zones/:id", requireEngineerAccess, (req, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    if (!id || !name) return res.status(400).json({ ok:false, error:"missing_fields" });
    try{
      dbApi.renameZone(id, name);
      res.json({ ok:true });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // delete zone (unassign entities unless reassign_zone_id provided)
  router.delete("/zones/:id", requireEngineerAccess, (req, res) => {
    const id = Number(req.params.id);
    const reassign_zone_id = (req.body && req.body.reassign_zone_id !== undefined && req.body.reassign_zone_id !== null && req.body.reassign_zone_id !== "")
      ? Number(req.body.reassign_zone_id)
      : null;
    if (!id) return res.status(400).json({ ok:false, error:"missing_id" });

    try{
      const c = dbApi.countIOByZone.get(id)?.c || 0;
      dbApi.deleteZone(id, reassign_zone_id);
      res.json({ ok:true, moved: c });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // sites
  router.get("/sites", requireLogin, (req, res) => {
    const all = dbApi.listSites.all();
    const sites = canSeePrivate(req) ? all : all.filter(s => !s.is_private);
    res.json({ ok: true, sites });
  });

  router.post("/sites", requireAdmin, (req, res) => {
    const name       = String(req.body?.name || "").trim();
    const note       = req.body?.note == null ? null : String(req.body.note);
    const is_private = req.body?.is_private ? 1 : 0;
    if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
    try {
      dbApi.createSite.run(name, note, is_private, Date.now());
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/sites/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    try {
      dbApi.deleteSite(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // PATCH /api/sites/:id — admin renames / updates note
  router.patch("/sites/:id", requireAdmin, (req, res) => {
    const id   = Number(req.params.id);
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const note = req.body?.note != null ? String(req.body.note) : null;
    if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
    try {
      dbApi.db.prepare(`UPDATE sites SET name=?, note=? WHERE id=?`).run(name, note, id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // PATCH /api/sites/:id/visibility — admin toggles public/private
  router.patch("/sites/:id/visibility", requireAdmin, (req, res) => {
    const id         = Number(req.params.id);
    const is_private = req.body?.is_private ? 1 : 0;
    dbApi.setSitePrivacy.run(is_private, id);
    res.json({ ok: true });
  });

  // GET /api/sites/:id — full site info (respects privacy)
  router.get("/sites/:id", requireLogin, (req, res) => {
    const site = dbApi.db.prepare("SELECT * FROM sites WHERE id=?").get(Number(req.params.id));
    if (!site) return res.status(404).json({ ok: false, error: "not_found" });
    if (site.is_private && !canSeePrivate(req))
      return res.status(403).json({ ok: false, error: "forbidden" });
    res.json({ ok: true, site });
  });

  // PATCH /api/sites/:id/location  — save lat, lon, timezone, address
  router.patch("/sites/:id/location", requireEngineerAccess, (req, res) => {
    const { lat, lon, timezone, address } = req.body || {};
    dbApi.db.prepare(`
      UPDATE sites SET lat=?, lon=?, timezone=?, address=? WHERE id=?
    `).run(
      lat    != null ? String(lat)    : null,
      lon    != null ? String(lon)    : null,
      timezone || "Europe/Athens",
      address  || null,
      Number(req.params.id)
    );
    res.json({ ok:true });
  });

  router.get("/sites/:id/devices", requireLogin, (req, res) => {
    const siteId = Number(req.params.id);
    const devices = dbApi.listDevicesForSite.all(siteId).map(r => r.device_id);
    res.json({ ok: true, siteId, devices });
  });

  router.post("/sites/:id/assign-device", requireEngineerAccess, (req, res) => {
    const siteId = Number(req.params.id);
    const deviceId = String(req.body?.deviceId || "").trim();
    if (!deviceId) return res.status(400).json({ ok: false, error: "missing_deviceId" });
    dbApi.assignDeviceToSite(deviceId, siteId);
    res.json({ ok: true });
  });


  // ===== Entities Manager APIs =====

  // list approved entities (io) with zone + site info
  router.get("/entities", requireEngineerAccess, (req, res) => {
    try{
      const rows = dbApi.db.prepare(`
        SELECT io.id, io.device_id, io.group_name, io.key, io.type, io.name,
               io.zone_id, z.name AS zone_name,
               COALESCE(io.enabled, 1) AS enabled,
               io.hw_type, io.kind, io.unit, io.device_class,
               ds.site_id AS site_id, s.name AS site_name
        FROM io
        LEFT JOIN zones z ON z.id = io.zone_id
        LEFT JOIN device_site ds ON ds.device_id = io.device_id
        LEFT JOIN sites s ON s.id = ds.site_id
        ORDER BY io.device_id, io.group_name, io.key
      `).all();
      res.json({ ok:true, entities: rows });
    }catch(e){
      res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // update single entity fields (name, zone_id, enabled)
  router.post("/io/update", requireEngineerAccess, (req, res) => {
    try{
      const id = Number(req.body?.id);
      if(!id) return res.status(400).json({ ok:false, error:"missing_id" });

      const name = (req.body?.name !== undefined) ? String(req.body.name).trim() : undefined;
      const zone_id = (req.body?.zone_id === "" || req.body?.zone_id === undefined) ? undefined : (req.body.zone_id === null ? null : Number(req.body.zone_id));
      const enabled = (req.body?.enabled === undefined) ? undefined : Number(req.body.enabled) ? 1 : 0;

      const parts = [];
      const params = [];
      if(name !== undefined && name !== ""){ parts.push("name=?"); params.push(name); }
      if(zone_id !== undefined){ parts.push("zone_id=?"); params.push(zone_id); }
      if(enabled !== undefined){ parts.push("enabled=?"); params.push(enabled); }

      if(!parts.length) return res.json({ ok:true, changed:0 });

      params.push(id);
      const info = dbApi.db.prepare(`UPDATE io SET ${parts.join(", ")} WHERE id=?`).run(...params);
      res.json({ ok:true, changed: info.changes||0 });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // Get pinned entities with latest state value
  router.get("/io/pinned", (req, res) => {
    try {
      const rows = dbApi.listPinnedIOWithState.all();
      res.json({ ok: true, io: rows });
    } catch(e) {
      res.status(500).json({ ok: false, error: String(e?.message||e) });
    }
  });

  // update single entity fields (name, zone_id, enabled, pinned) - PATCH style (used by Settings page)
  router.patch("/io/:id", requireEngineerAccess, (req, res) => {
    try{
      const id = Number(req.params.id);
      if(!id) return res.status(400).json({ ok:false, error:"missing_id" });

      const name = (req.body?.name !== undefined) ? String(req.body.name).trim() : undefined;
      const zone_id = (req.body?.zone_id === undefined) ? undefined : (req.body.zone_id === null ? null : Number(req.body.zone_id));
      const enabled = (req.body?.enabled === undefined) ? undefined : (Number(req.body.enabled) ? 1 : 0);
      const pinned = (req.body?.pinned === undefined) ? undefined : (req.body.pinned ? 1 : 0);

      const parts = [];
      const params = [];

      if(name !== undefined){ parts.push("name=?"); params.push(name); }
      if(zone_id !== undefined){
        if(zone_id === null || Number.isNaN(zone_id)) parts.push("zone_id=NULL");
        else { parts.push("zone_id=?"); params.push(zone_id); }
      }
      if(enabled !== undefined){ parts.push("enabled=?"); params.push(enabled); }
      if(pinned !== undefined){ parts.push("pinned=?"); params.push(pinned); }

      if(!parts.length) return res.json({ ok:true, changes:0 });

      const sql = `UPDATE io SET ${parts.join(", ")} WHERE id=?`;
      params.push(id);
      const info = dbApi.db.prepare(sql).run(...params);
      res.json({ ok:true, changes: info.changes || 0 });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });


  // bulk operations: enable/disable/delete/zone
  router.post("/io/bulk", requireEngineerAccess, (req, res) => {
    try{
      const action = String(req.body?.action || "");
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if(!ids.length) return res.status(400).json({ ok:false, error:"no_ids" });

      const qMarks = ids.map(()=>"?").join(",");
      let info = { changes: 0 };

      if(action === "enable"){
        info = dbApi.db.prepare(`UPDATE io SET enabled=1 WHERE id IN (${qMarks})`).run(...ids);
      }else if(action === "disable"){
        info = dbApi.db.prepare(`UPDATE io SET enabled=0 WHERE id IN (${qMarks})`).run(...ids);
      }else if(action === "zone"){
        const zone_id = (req.body?.zone_id === null || req.body?.zone_id === "" || req.body?.zone_id === undefined) ? null : Number(req.body.zone_id);
        info = dbApi.db.prepare(`UPDATE io SET zone_id=? WHERE id IN (${qMarks})`).run(zone_id, ...ids);
      }else if(action === "delete"){
        dbApi.db.prepare(`DELETE FROM module_mappings WHERE io_id IN (${qMarks})`).run(...ids);
        info = dbApi.db.prepare(`DELETE FROM io WHERE id IN (${qMarks})`).run(...ids);
      }else{
        return res.status(400).json({ ok:false, error:"bad_action" });
      }

      res.json({ ok:true, changes: info.changes||0 });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // blocked list (engineer)
  router.get("/blocked-io", requireEngineerAccess, (req, res) => {
    try{
      const rows = dbApi.db.prepare(`SELECT device_id, group_name, key, created_ts, reason FROM blocked_io ORDER BY created_ts DESC`).all();
      res.json({ ok:true, blocked: rows });
    }catch(e){
      res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  router.delete("/blocked-io", requireEngineerAccess, (req, res) => {
    try{
      const device_id = String(req.body?.device_id || "").trim();
      const group_name = String(req.body?.group_name || "").trim();
      const key = String(req.body?.key || "").trim();
      if(!device_id || !group_name || !key) return res.status(400).json({ ok:false, error:"missing_fields" });
      const info = dbApi.db.prepare(`DELETE FROM blocked_io WHERE device_id=? AND group_name=? AND key=?`).run(device_id, group_name, key);
      res.json({ ok:true, changes: info.changes||0 });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  router.post("/blocked-io", requireEngineerAccess, (req, res) => {
    try{
      const device_id = String(req.body?.device_id || "").trim();
      const group_name = String(req.body?.group_name || "").trim();
      const key = String(req.body?.key || "").trim();
      const reason = req.body?.reason == null ? null : String(req.body.reason);
      if(!device_id || !group_name || !key) return res.status(400).json({ ok:false, error:"missing_fields" });
      dbApi.db.prepare(`INSERT OR REPLACE INTO blocked_io(device_id, group_name, key, created_ts, reason) VALUES(?,?,?,?,?)`)
        .run(device_id, group_name, key, Date.now(), reason);
      res.json({ ok:true });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  // export/import config (engineer)
  router.get("/config/export", requireEngineerAccess, (req, res) => {
    try{
      const sites = dbApi.db.prepare(`SELECT id, name, note, is_private, created_ts FROM sites ORDER BY id`).all();
      const zones = dbApi.db.prepare(`SELECT id, name, site_id FROM zones ORDER BY id`).all();
      const device_sites = dbApi.db.prepare(`SELECT device_id, site_id FROM device_site ORDER BY device_id`).all()
        .map(r => ({ device_id: r.device_id, site_id: r.site_id, site_name: (sites.find(s=>s.id===r.site_id)||{}).name || null }));
      const entities = dbApi.db.prepare(`
        SELECT io.device_id, io.group_name, io.key, io.type, io.name, io.zone_id,
               z.name AS zone_name, COALESCE(io.enabled,1) AS enabled,
               io.hw_type, io.kind, io.unit, io.device_class
        FROM io LEFT JOIN zones z ON z.id=io.zone_id
        ORDER BY io.device_id, io.group_name, io.key
      `).all();
      const blocked = dbApi.db.prepare(`SELECT device_id, group_name, key, created_ts, reason FROM blocked_io ORDER BY created_ts DESC`).all();

      const payload = {
        version: 1,
        exported_ts: Date.now(),
        sites,
        zones,
        device_sites,
        entities,
        blocked,
      };

      const d = new Date();
      const fn = `elaris_config_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.json`;
      res.setHeader("Content-Type","application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
      res.send(JSON.stringify(payload, null, 2));
    }catch(e){
      res.status(500).json({ ok:false, error:String(e?.message||e) });
    }
  });

  router.post("/config/import", requireEngineerAccess, (req, res) => {
    const cfg = req.body;
    try{
      if(!cfg || typeof cfg !== "object") return res.status(400).json({ ok:false, error:"bad_config" });

      const tx = dbApi.db.transaction(() => {
        // sites by name
        const upsertSite = dbApi.db.prepare(`INSERT INTO sites(name, note, is_private, created_ts) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET note=excluded.note, is_private=excluded.is_private`);
        const getSiteByName = dbApi.db.prepare(`SELECT id FROM sites WHERE name=?`);
        (cfg.sites||[]).forEach(s=>{
          const name = String(s?.name||"").trim();
          if(!name) return;
          upsertSite.run(name, s?.note ?? null, s?.is_private ? 1 : 0, s?.created_ts ?? Date.now());
        });

        // zones — preserve site_id via site name→id map
        const createZone       = dbApi.db.prepare(`INSERT OR IGNORE INTO zones(name, site_id) VALUES(?,?)`);
        const getZoneBySiteKey = dbApi.db.prepare(`SELECT id FROM zones WHERE name=? AND COALESCE(site_id,0)=COALESCE(?,0)`);
        (cfg.zones||[]).forEach(z=>{
          const name = String(z?.name||"").trim();
          if(!name) return;
          // resolve exported site_id → local site id via site name
          let sid = null;
          if(z?.site_id != null){
            const exportedSite = (cfg.sites||[]).find(s => s.id === z.site_id);
            if(exportedSite?.name) sid = getSiteByName.get(String(exportedSite.name).trim())?.id ?? null;
          }
          createZone.run(name, sid);
          // zone already existed — update site_id only if currently unset
          if(sid != null){
            const existing = getZoneBySiteKey.get(name, null); // look for same name with no site
            if(existing) dbApi.db.prepare(`UPDATE zones SET site_id=? WHERE id=? AND site_id IS NULL`).run(sid, existing.id);
          }
        });

        // device_site mapping
        const assign = dbApi.db.prepare(`INSERT INTO device_site(device_id, site_id, assigned_ts) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET site_id=excluded.site_id, assigned_ts=excluded.assigned_ts`);
        (cfg.device_sites||[]).forEach(ds=>{
          const device_id = String(ds?.device_id||"").trim();
          const site_name = String(ds?.site_name||"").trim();
          if(!device_id || !site_name) return;
          const sid = getSiteByName.get(site_name)?.id;
          if(sid) assign.run(device_id, sid, Date.now());
        });

        // entities upsert
        const upsertDev = dbApi.db.prepare(`INSERT OR IGNORE INTO devices(id, name, last_seen) VALUES(?,?,?)`);
        const upsertIO = dbApi.db.prepare(`
          INSERT INTO io(device_id, key, group_name, type, name, zone_id, created_ts, enabled, hw_type, kind, unit, device_class)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(device_id, group_name, key) DO UPDATE SET
            type=excluded.type,
            name=excluded.name,
            zone_id=excluded.zone_id,
            enabled=excluded.enabled,
            hw_type=excluded.hw_type,
            kind=excluded.kind,
            unit=excluded.unit,
            device_class=excluded.device_class
        `);

        (cfg.entities||[]).forEach(e=>{
          const device_id = String(e?.device_id||"").trim();
          const group_name = String(e?.group_name||"").trim();
          const key = String(e?.key||"").trim();
          if(!device_id || !group_name || !key) return;

          upsertDev.run(device_id, null, 0);

          let zid = null;
          const zone_name = String(e?.zone_name||"").trim();
          if(zone_name){
            createZone.run(zone_name, null);
            zid = getZoneBySiteKey.get(zone_name, null)?.id ?? null;
          }
          const enabled = (e?.enabled === 0 || e?.enabled === false) ? 0 : 1;
          upsertIO.run(
            device_id,
            key,
            group_name,
            e?.type || "sensor",
            (e?.name || key),
            zid,
            e?.created_ts ?? Date.now(),
            enabled,
            e?.hw_type ?? null,
            e?.kind ?? null,
            e?.unit ?? null,
            e?.device_class ?? null
          );
        });

        // blocked
        const upsertBlocked = dbApi.db.prepare(`INSERT OR REPLACE INTO blocked_io(device_id, group_name, key, created_ts, reason) VALUES(?,?,?,?,?)`);
        (cfg.blocked||[]).forEach(b=>{
          const device_id = String(b?.device_id||"").trim();
          const group_name = String(b?.group_name||"").trim();
          const key = String(b?.key||"").trim();
          if(!device_id || !group_name || !key) return;
          upsertBlocked.run(device_id, group_name, key, b?.created_ts ?? Date.now(), b?.reason ?? null);
        });
      });

      tx();
      res.json({ ok:true });
    }catch(e){
      res.status(400).json({ ok:false, error:String(e?.message||e) });
    }
  });

  return router;
}

module.exports = { initRoutes };
