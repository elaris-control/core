// src/module_routes.js
// REST API for module instances & mappings

const { listModules, getModule, listCategories } = require("./modules/index");

function validateModuleMappings(def, mappings) {
  if (def.id === 'hydronic_manager') {
    const topology = mappings.mixing_valve ? 'mixing' : 'direct';
    const required = topology === 'mixing'
      ? ['heat_source_1', 'mixing_valve', 'temp_supply', 'zone_1_thermostat', 'zone_1_pump']
      : ['heat_source_1', 'zone_1_thermostat', 'zone_1_pump'];
    const missing = required.filter(k => !mappings[k]);
    if (missing.length) return { ok: false, error: "missing_required_inputs", missing };
  } else {
    const missing = (def.inputs || []).filter(i => i.required && !mappings[i.key]).map(i => i.key);
    if (missing.length) return { ok: false, error: "missing_required_inputs", missing };
  }

  if (def.id === 'thermostat') {
    const zoneInputs = ['temp_room'];
    const zoneOutputs = ['ac_relay', 'central_pump'];
    for (let i = 1; i <= 6; i++) {
      zoneInputs.push(`zone_${i}_temp`, `zone_${i}_call`);
      zoneOutputs.push(`zone_${i}_output`, `zone_${i}_pump`);
    }
    const hasInput = zoneInputs.some(k => !!mappings[k]);
    const hasOutput = zoneOutputs.some(k => !!mappings[k]);
    if (!hasInput) return { ok: false, error: 'thermostat_requires_zone_input' };
    if (!hasOutput) return { ok: false, error: 'thermostat_requires_output' };
  }

  return { ok: true };
}

function initModuleRoutes({ db, requireLogin, requireEngineer, access }) {
  const express = require("express");
  const router  = express.Router();

  function isEngineerLike(req) {
    return access.canSeePrivate(req);
  }

  function canUserViewDefinition(req, def) {
    if (isEngineerLike(req)) return true;
    return !!def?.ui?.user_view;
  }

  function shapeInstanceForRole(req, inst) {
    const def      = getModule(inst.module_id);
    const mappings = isEngineerLike(req) ? getMappings.all(inst.id) : [];
    return { ...inst, definition: def, mappings };
  }

  function requireSiteRefAccess(req, res, ref, notFound = "not_found") {
    if (!ref) {
      res.status(404).json({ ok: false, error: notFound });
      return false;
    }
    if (!access.canAccessSiteRef(req, ref)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return false;
    }
    return true;
  }


  // All module routes require login
  router.use(requireLogin);

  // ── Prepared statements ───────────────────────────────────────────────
  const listInstances = db.prepare(`
    SELECT mi.*, s.name as site_name
    FROM module_instances mi
    LEFT JOIN sites s ON s.id = mi.site_id
    WHERE mi.active = 1
    ORDER BY mi.created_ts ASC
  `);

  const getInstance = db.prepare(`
    SELECT mi.*, s.name as site_name
    FROM module_instances mi
    LEFT JOIN sites s ON s.id = mi.site_id
    WHERE mi.id = ? AND mi.active = 1
  `);

  const getMappings = db.prepare(`
    SELECT mm.*, io.key as io_key, io.name as io_name, io.type as io_type,
           io.group_name, io.device_id, io.unit
    FROM module_mappings mm
    LEFT JOIN io ON io.id = mm.io_id
    WHERE mm.instance_id = ?
  `);

  const createInstance = db.prepare(`
    INSERT INTO module_instances(site_id, module_id, name, active, created_ts)
    VALUES(@site_id, @module_id, @name, 1, @ts)
  `);

  const upsertMapping = db.prepare(`
    INSERT INTO module_mappings(instance_id, input_key, io_id)
    VALUES(@instance_id, @input_key, @io_id)
    ON CONFLICT(instance_id, input_key) DO UPDATE SET io_id = excluded.io_id
  `);

  const deleteInstance = db.prepare(`UPDATE module_instances SET active = 0 WHERE id = ?`);

  const listIOForSite = db.prepare(`
        SELECT io.id, io.device_id, io.key, io.name, io.type, io.group_name, io.unit,
           io.zone_id, z.name AS zone_name
    FROM io
    LEFT JOIN zones z ON z.id = io.zone_id
    JOIN device_site ds ON ds.device_id = io.device_id
    WHERE ds.site_id = ?
    ORDER BY io.device_id, io.type, io.key
  `);

  // ── GET /api/modules/definitions ─────────────────────────────────────
  router.get("/definitions", (req, res) => {
    const modules = listModules().filter(def => canUserViewDefinition(req, def));
    res.json({ ok: true, modules, categories: listCategories() });
  });

  // ── GET /api/modules/instances ────────────────────────────────────────
  router.get("/instances", (req, res) => {
    const siteId = Number(req.query.site_id || 0);
    if (siteId) {
      const ref = access.getSiteRef(siteId);
      if (!requireSiteRefAccess(req, res, ref, "site_not_found")) return;
    }
    const instances = listInstances.all();
    const filtered = (siteId ? instances.filter(inst => Number(inst.site_id) === siteId) : instances)
      .filter(inst => access.canAccessSite(req, inst.site_id));
    const result = filtered
      .filter(inst => canUserViewDefinition(req, getModule(inst.module_id)))
      .map(inst => shapeInstanceForRole(req, inst));
    res.json({ ok: true, instances: result });
  });

  // ── GET /api/modules/instances/:id ───────────────────────────────────
  router.get("/instances/:id", (req, res) => {
    const inst = getInstance.get(Number(req.params.id));
    if (!inst) return res.status(404).json({ ok: false, error: "not_found" });
    if (!requireSiteRefAccess(req, res, access.getModuleInstanceSiteRef(inst.id), "not_found")) return;
    const def = getModule(inst.module_id);
    if (!canUserViewDefinition(req, def)) return res.status(403).json({ ok: false, error: 'forbidden' });
    res.json({ ok: true, instance: shapeInstanceForRole(req, inst) });
  });

  // ── POST /api/modules/instances ──────────────────────────────────────
  // Create a new module instance + save mappings
  // Body: { site_id, module_id, name, mappings: { input_key: io_id } }
  router.post("/instances", requireEngineer, (req, res) => {
    try {
      const { site_id, module_id, name, mappings = {} } = req.body || {};
      if (!site_id || !module_id) return res.status(400).json({ ok: false, error: "missing_fields" });
      if (!requireSiteRefAccess(req, res, access.getSiteRef(site_id), "site_not_found")) return;

      const def = getModule(module_id);
      if (!def) return res.status(400).json({ ok: false, error: "unknown_module" });

      const validation = validateModuleMappings(def, mappings);
      if (!validation.ok) return res.status(400).json({ ok: false, ...validation });

      const tx = db.transaction(() => {
        const info = createInstance.run({
          site_id: Number(site_id),
          module_id,
          name: name || def.name,
          ts: Date.now(),
        });
        const instance_id = info.lastInsertRowid;

        for (const [input_key, io_id] of Object.entries(mappings)) {
          if (io_id) {
            upsertMapping.run({ instance_id, input_key, io_id: Number(io_id) });
          }
        }
        return instance_id;
      });

      const instance_id = tx();
      const inst     = getInstance.get(instance_id);
      const maprows  = getMappings.all(instance_id);
      res.json({ ok: true, instance: { ...inst, definition: def, mappings: maprows } });
    } catch (e) {
      const isUnique = e.code === 'SQLITE_CONSTRAINT_UNIQUE' || (e.message||'').includes('UNIQUE');
      res.status(isUnique ? 409 : 500).json({ ok: false, error: isUnique ? 'instance_already_exists' : e.message });
    }
  });

  // ── PATCH /api/modules/instances/:id/config ─────────────────────────
  router.patch("/instances/:id/config", requireEngineer, (req, res) => {
    const id = parseInt(req.params.id);
    if (!requireSiteRefAccess(req, res, access.getModuleInstanceSiteRef(id), "not_found")) return;
    const { config } = req.body;
    if (!config) return res.status(400).json({ ok:false, error:"config required" });
    try {
      db.prepare("UPDATE module_instances SET config=? WHERE id=?")
        .run(JSON.stringify(config), id);
      res.json({ ok:true });
    } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
  });

  // ── PATCH /api/modules/instances/:id/mappings ────────────────────────
  // Update mappings for existing instance
  router.patch("/instances/:id/mappings", requireEngineer, (req, res) => {
    try {
      const inst = getInstance.get(Number(req.params.id));
      if (!inst) return res.status(404).json({ ok: false, error: "not_found" });
      if (!requireSiteRefAccess(req, res, access.getModuleInstanceSiteRef(inst.id), "not_found")) return;

      const { mappings = {} } = req.body || {};
      const currentMapRows = getMappings.all(inst.id);
      const mergedMappings = currentMapRows.reduce((acc, row) => {
        if (row.input_key && row.io_id) acc[row.input_key] = row.io_id;
        return acc;
      }, {});
      for (const [input_key, io_id] of Object.entries(mappings)) {
        if (io_id) mergedMappings[input_key] = Number(io_id);
        else delete mergedMappings[input_key];
      }
      const def = getModule(inst.module_id);
      const validation = validateModuleMappings(def, mergedMappings);
      if (!validation.ok) return res.status(400).json({ ok: false, ...validation });

      for (const [input_key, io_id] of Object.entries(mappings)) {
        upsertMapping.run({
          instance_id: inst.id,
          input_key,
          io_id: io_id ? Number(io_id) : null,
        });
      }
      const maprows = getMappings.all(inst.id);
      res.json({ ok: true, mappings: maprows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── DELETE /api/modules/instances/:id ────────────────────────────────
  router.delete("/instances/:id", requireEngineer, (req, res) => {
    const id = Number(req.params.id);
    if (!requireSiteRefAccess(req, res, access.getModuleInstanceSiteRef(id), "not_found")) return;
    deleteInstance.run(id);
    res.json({ ok: true });
  });

  // ── GET /api/modules/io/:site_id ─────────────────────────────────────
  // List approved IO entities for a site (used for mapping dropdowns)
  router.get("/io/:site_id", (req, res) => {
    if (!requireSiteRefAccess(req, res, access.getSiteRef(req.params.site_id), "site_not_found")) return;
    const io = listIOForSite.all(Number(req.params.site_id));
    res.json({ ok: true, io });
  });

  // ── GET /api/modules/suggest/:site_id/:module_id ─────────────────────
  // Auto-suggest mappings by matching entity keys to module input keys
  router.get("/suggest/:site_id/:module_id", (req, res) => {
    if (!requireSiteRefAccess(req, res, access.getSiteRef(req.params.site_id), "site_not_found")) return;
    const def = getModule(req.params.module_id);
    if (!def) return res.status(404).json({ ok: false, error: "unknown_module" });

    const io       = listIOForSite.all(Number(req.params.site_id));
    const suggestions = {};

const typeMatches = (ioType, inputType) => {
      if (inputType === "analog") return ["dimmer","ao","analog","pwm"].includes(ioType);
      return ioType === inputType;
    };

    for (const input of def.inputs) {
      // Try exact key match first
      let match = io.find(e => e.key === input.key && typeMatches(e.type, input.type));
      // Then partial match (e.g. "pump" matches "state.pump")
      if (!match) match = io.find(e =>
        (e.key.includes(input.key) || input.key.includes(e.key)) && typeMatches(e.type, input.type)
      );
      // Then just type match
      if (!match) match = io.find(e => typeMatches(e.type, input.type));

      suggestions[input.key] = match ? match.id : null;
    }

    res.json({ ok: true, suggestions });
  });

  return router;
}

module.exports = { initModuleRoutes };
