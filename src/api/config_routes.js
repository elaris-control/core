'use strict';
// src/api/config_routes.js — /api/config/export & /api/config/import
const express = require('express');

function initConfigRoutes({ dbApi, requireEngineerAccess }) {
  const router = express.Router();
  const db = dbApi.db;

  // ── Export ────────────────────────────────────────────────────────────
  router.get('/export', requireEngineerAccess, (req, res) => {
    try {
      const sites = db.prepare(`SELECT id, name, note, is_private, lat, lon, timezone, address, created_ts FROM sites ORDER BY id`).all();
      const zones = db.prepare(`SELECT id, name, site_id FROM zones ORDER BY id`).all();
      const device_sites = db.prepare(`SELECT device_id, site_id FROM device_site ORDER BY device_id`).all()
        .map(r => ({ device_id: r.device_id, site_id: r.site_id, site_name: (sites.find(s => s.id === r.site_id) || {}).name || null }));
      const entities = db.prepare(`
        SELECT io.device_id, io.group_name, io.key, io.type, io.name, io.zone_id,
               z.name AS zone_name, COALESCE(io.enabled,1) AS enabled,
               io.hw_type, io.kind, io.unit, io.device_class
        FROM io LEFT JOIN zones z ON z.id=io.zone_id
        ORDER BY io.device_id, io.group_name, io.key
      `).all();
      const blocked = db.prepare(`SELECT device_id, group_name, key, created_ts, reason FROM blocked_io ORDER BY created_ts DESC`).all();
      const module_instances = db.prepare(`
        SELECT mi.id, mi.site_id, mi.module_id, mi.name, mi.active, mi.config, mi.created_ts,
               s.name AS _site_name
        FROM module_instances mi LEFT JOIN sites s ON s.id=mi.site_id
        ORDER BY mi.id
      `).all();
      const module_mappings = db.prepare(`
        SELECT mm.id, mm.instance_id, mm.input_key, mm.io_id,
               mi.name AS _instance_name, mi.module_id AS _module_id,
               io.device_id AS _device_id, io.group_name AS _group_name, io.key AS _key
        FROM module_mappings mm
        LEFT JOIN module_instances mi ON mi.id=mm.instance_id
        LEFT JOIN io ON io.id=mm.io_id
        ORDER BY mm.id
      `).all();

      const _instMap = new Map(module_instances.map(i => [i.id, i]));
      const _ioMap   = new Map(db.prepare(`SELECT id, device_id, group_name, key FROM io`).all().map(r => [r.id, r]));
      const scenes = db.prepare(`SELECT * FROM scenes ORDER BY id`).all().map(scene => {
        let actions = []; try { actions = JSON.parse(scene.actions_json || '[]'); } catch {}
        actions = actions.map(a => {
          const ea = { ...a };
          if (a.type === 'set_setpoint' && a.instance_id) { const i = _instMap.get(a.instance_id); if (i) { ea._instance_name = i.name; ea._module_id = i.module_id; } }
          if (a.type === 'send_command' && a.io_id) { const io = _ioMap.get(a.io_id); if (io) { ea._device_id = io.device_id; ea._group_name = io.group_name; ea._key = io.key; } }
          return ea;
        });
        return { ...scene, _site_name: (sites.find(s => s.id === scene.site_id) || {}).name || null, actions_json: JSON.stringify(actions) };
      });
      const scene_schedules = db.prepare(`
        SELECT ss.id, ss.scene_id, ss.time, ss.days, ss.enabled,
               s.name AS _scene_name, s.site_id AS _scene_site_id, si.name AS _scene_site_name
        FROM scene_schedules ss
        JOIN scenes s ON s.id=ss.scene_id
        LEFT JOIN sites si ON si.id=s.site_id
        ORDER BY ss.id
      `).all();

      const d  = new Date();
      const fn = `elaris_config_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
      res.send(JSON.stringify({ version: 2, exported_ts: Date.now(), sites, zones, device_sites, entities, blocked, module_instances, module_mappings, scenes, scene_schedules }, null, 2));
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // ── Import ────────────────────────────────────────────────────────────
  router.post('/import', requireEngineerAccess, (req, res) => {
    const cfg = req.body;
    try {
      if (!cfg || typeof cfg !== 'object') return res.status(400).json({ ok: false, error: 'bad_config' });

      db.transaction(() => {
        const upsertSite    = db.prepare(`INSERT INTO sites(name,note,is_private,lat,lon,timezone,address,created_ts) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET note=excluded.note,is_private=excluded.is_private,lat=excluded.lat,lon=excluded.lon,timezone=excluded.timezone,address=excluded.address`);
        const getSiteByName = db.prepare(`SELECT id FROM sites WHERE name=?`);
        (cfg.sites || []).forEach(s => {
          const name = String(s?.name || '').trim(); if (!name) return;
          upsertSite.run(name, s?.note ?? null, s?.is_private ? 1 : 0, s?.lat ?? null, s?.lon ?? null, s?.timezone ?? null, s?.address ?? null, s?.created_ts ?? Date.now());
        });

        const createZone       = db.prepare(`INSERT OR IGNORE INTO zones(name, site_id) VALUES(?,?)`);
        const getZoneBySiteKey = db.prepare(`SELECT id FROM zones WHERE name=? AND COALESCE(site_id,0)=COALESCE(?,0)`);
        (cfg.zones || []).forEach(z => {
          const name = String(z?.name || '').trim(); if (!name) return;
          let sid = null;
          if (z?.site_id != null) { const es = (cfg.sites || []).find(s => s.id === z.site_id); if (es?.name) sid = getSiteByName.get(String(es.name).trim())?.id ?? null; }
          createZone.run(name, sid);
        });

        const assign = db.prepare(`INSERT INTO device_site(device_id,site_id,assigned_ts) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET site_id=excluded.site_id,assigned_ts=excluded.assigned_ts`);
        (cfg.device_sites || []).forEach(ds => {
          const device_id = String(ds?.device_id || '').trim(); const site_name = String(ds?.site_name || '').trim();
          if (!device_id || !site_name) return;
          const sid = getSiteByName.get(site_name)?.id; if (sid) assign.run(device_id, sid, Date.now());
        });

        const deviceSiteMap = new Map();
        (cfg.device_sites || []).forEach(ds => { const dId = String(ds?.device_id || '').trim(); const sName = String(ds?.site_name || '').trim(); if (!dId || !sName) return; const sid = getSiteByName.get(sName)?.id ?? null; if (sid) deviceSiteMap.set(dId, sid); });

        const upsertDev = db.prepare(`INSERT OR IGNORE INTO devices(id,name,last_seen) VALUES(?,?,?)`);
        const upsertIO  = db.prepare(`INSERT INTO io(device_id,key,group_name,type,name,zone_id,created_ts,enabled,hw_type,kind,unit,device_class) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id,group_name,key) DO UPDATE SET type=excluded.type,name=excluded.name,zone_id=excluded.zone_id,enabled=excluded.enabled,hw_type=excluded.hw_type,kind=excluded.kind,unit=excluded.unit,device_class=excluded.device_class`);
        (cfg.entities || []).forEach(e => {
          const device_id = String(e?.device_id || '').trim(); const group_name = String(e?.group_name || '').trim(); const key = String(e?.key || '').trim();
          if (!device_id || !group_name || !key) return;
          upsertDev.run(device_id, null, 0);
          let zid = null; const zone_name = String(e?.zone_name || '').trim();
          if (zone_name) { const deviceSid = deviceSiteMap.get(device_id) ?? null; createZone.run(zone_name, deviceSid); zid = getZoneBySiteKey.get(zone_name, deviceSid)?.id ?? getZoneBySiteKey.get(zone_name, null)?.id ?? null; }
          upsertIO.run(device_id, key, group_name, e?.type || 'sensor', e?.name || key, zid, e?.created_ts ?? Date.now(), (e?.enabled === 0 || e?.enabled === false) ? 0 : 1, e?.hw_type ?? null, e?.kind ?? null, e?.unit ?? null, e?.device_class ?? null);
        });

        const upsertBlocked = db.prepare(`INSERT OR REPLACE INTO blocked_io(device_id,group_name,key,created_ts,reason) VALUES(?,?,?,?,?)`);
        (cfg.blocked || []).forEach(b => {
          const device_id = String(b?.device_id || '').trim(); const group_name = String(b?.group_name || '').trim(); const key = String(b?.key || '').trim();
          if (!device_id || !group_name || !key) return;
          upsertBlocked.run(device_id, group_name, key, b?.created_ts ?? Date.now(), b?.reason ?? null);
        });

        const getInstanceByKey = db.prepare(`SELECT id FROM module_instances WHERE site_id=? AND module_id=? AND name=?`);
        const insertInstance   = db.prepare(`INSERT INTO module_instances(site_id,module_id,name,active,config,created_ts) VALUES(?,?,?,?,?,?)`);
        const updateInstance   = db.prepare(`UPDATE module_instances SET active=?,config=? WHERE id=?`);
        const instanceIdMap    = new Map();
        (cfg.module_instances || []).forEach(mi => {
          const site_name = String(mi?._site_name || '').trim(); const module_id = String(mi?.module_id || '').trim(); const name = String(mi?.name || '').trim();
          if (!module_id || !name) return;
          const sid = site_name ? getSiteByName.get(site_name)?.id ?? null : null; if (!sid) return;
          let existing = getInstanceByKey.get(sid, module_id, name);
          if (existing) { updateInstance.run(mi?.active ?? 1, mi?.config ?? null, existing.id); }
          else { insertInstance.run(sid, module_id, name, mi?.active ?? 1, mi?.config ?? null, mi?.created_ts ?? Date.now()); existing = getInstanceByKey.get(sid, module_id, name); }
          if (existing?.id && mi?.id) instanceIdMap.set(mi.id, existing.id);
        });

        const getIOByKey    = db.prepare(`SELECT id FROM io WHERE device_id=? AND group_name=? AND key=?`);
        const upsertMapping = db.prepare(`INSERT INTO module_mappings(instance_id,input_key,io_id) VALUES(?,?,?) ON CONFLICT(instance_id,input_key) DO UPDATE SET io_id=excluded.io_id`);
        (cfg.module_mappings || []).forEach(mm => {
          const localInstId = instanceIdMap.get(mm?.instance_id); if (!localInstId) return;
          const input_key = String(mm?.input_key || '').trim(); if (!input_key) return;
          let io_id = null;
          if (mm?._device_id && mm?._group_name && mm?._key) io_id = getIOByKey.get(String(mm._device_id).trim(), String(mm._group_name).trim(), String(mm._key).trim())?.id ?? null;
          upsertMapping.run(localInstId, input_key, io_id);
        });

        const getSceneByKey  = db.prepare(`SELECT id FROM scenes WHERE name=? AND COALESCE(site_id,0)=COALESCE(?,0)`);
        const insertScene    = db.prepare(`INSERT INTO scenes(name,icon,color,actions_json,site_id,created_ts) VALUES(?,?,?,?,?,?)`);
        const updateSceneImp = db.prepare(`UPDATE scenes SET icon=?,color=?,actions_json=? WHERE id=?`);
        const localInstBySiteKey = new Map(db.prepare(`SELECT id,site_id,module_id,name FROM module_instances`).all().map(i => [i.site_id+'|'+i.module_id+'|'+i.name, i.id]));
        const localIOByKey = new Map(db.prepare(`SELECT id,device_id,group_name,key FROM io`).all().map(r => [r.device_id+'|'+r.group_name+'|'+r.key, r.id]));
        const sceneIdMap = new Map();
        (cfg.scenes || []).forEach(sc => {
          const name = String(sc?.name || '').trim(); if (!name) return;
          const site_name = String(sc?._site_name || '').trim(); const sid = site_name ? getSiteByName.get(site_name)?.id ?? null : null;
          let actions = []; try { actions = JSON.parse(sc?.actions_json || '[]'); } catch {}
          actions = actions.map(a => {
            const ra = { ...a };
            if (a.type==='set_setpoint' && a._instance_name && a._module_id) ra.instance_id = instanceIdMap.get(a.instance_id) ?? localInstBySiteKey.get(sid+'|'+a._module_id+'|'+a._instance_name) ?? null;
            if (a.type==='send_command' && a._device_id && a._group_name && a._key) ra.io_id = localIOByKey.get(a._device_id+'|'+a._group_name+'|'+a._key) ?? null;
            delete ra._instance_name; delete ra._module_id; delete ra._device_id; delete ra._group_name; delete ra._key;
            return ra;
          });
          const actions_json = JSON.stringify(actions); const icon = sc?.icon || '🎬'; const color = sc?.color || '#6366f1';
          let existing = getSceneByKey.get(name, sid);
          if (existing) { updateSceneImp.run(icon, color, actions_json, existing.id); }
          else { insertScene.run(name, icon, color, actions_json, sid, sc?.created_ts ?? Date.now()); existing = getSceneByKey.get(name, sid); }
          if (existing?.id && sc?.id) sceneIdMap.set(sc.id, existing.id);
        });

        const getScheduleByKey = db.prepare(`SELECT id FROM scene_schedules WHERE scene_id=? AND time=? AND days=?`);
        const insertSchedule   = db.prepare(`INSERT INTO scene_schedules(scene_id,time,days,enabled) VALUES(?,?,?,?)`);
        const updateSchedule   = db.prepare(`UPDATE scene_schedules SET enabled=? WHERE id=?`);
        (cfg.scene_schedules || []).forEach(ss => {
          const localSceneId = sceneIdMap.get(ss?.scene_id); if (!localSceneId) return;
          const time = String(ss?.time || '').trim(); const days = String(ss?.days || '1,2,3,4,5,6,7').trim();
          if (!time) return;
          const existing = getScheduleByKey.get(localSceneId, time, days);
          if (existing) updateSchedule.run(ss?.enabled ?? 1, existing.id);
          else insertSchedule.run(localSceneId, time, days, ss?.enabled ?? 1);
        });
      })();

      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  return router;
}

module.exports = { initConfigRoutes };
