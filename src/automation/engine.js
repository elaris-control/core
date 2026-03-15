// src/automation/engine.js
// Generic automation engine — runs all module types
// Each module registers a handler; engine calls it on every sensor update

class AutomationEngine {
  constructor({ db, broadcast }) {
    this.db        = db;
    this.broadcast = broadcast;
    this.mqttApi   = null;
    this.handlers  = new Map(); // module_id → handler function
    this.overrides = new Map(); // instance_id → { paused, ts }
    this.ioOverrides = new Map(); // io_id → { value, active, ts }
    this.runtimeState = new Map(); // instance_id → latest module broadcast state

    // Ensure automation_log table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL,
        action      TEXT NOT NULL,
        reason      TEXT,
        ts          INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS module_settings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
        key         TEXT NOT NULL,
        value       TEXT,
        updated_ts  INTEGER NOT NULL,
        UNIQUE(instance_id, key)
      );
      CREATE TABLE IF NOT EXISTS module_runtime_overrides (
        instance_id INTEGER PRIMARY KEY,
        paused      INTEGER NOT NULL DEFAULT 0,
        ts          INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS io_runtime_overrides (
        io_id       INTEGER PRIMARY KEY,
        value       TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        ts          INTEGER NOT NULL,
        expires_at  INTEGER,
        permanent   INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_automation_log_instance_ts ON automation_log(instance_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_module_instances_site_active ON module_instances(site_id, active);
      CREATE INDEX IF NOT EXISTS idx_module_mappings_instance ON module_mappings(instance_id);
    `);

    // Prepared statements
    this._getInstances = db.prepare(`
      SELECT mi.*, s.name as site_name
      FROM module_instances mi
      LEFT JOIN sites s ON s.id = mi.site_id
      WHERE mi.active = 1
    `);
    this._getMappings = db.prepare(`
      SELECT mm.*, io.key as io_key, io.name as io_name,
             io.type as io_type, io.group_name, io.device_id, io.unit
      FROM module_mappings mm
      LEFT JOIN io ON io.id = mm.io_id
      WHERE mm.instance_id = ?
    `);
    this._getIOById = db.prepare(`SELECT * FROM io WHERE id = ?`);
    this._getLatestState = db.prepare(`
      SELECT value FROM device_state
      WHERE device_id = ? AND key = ?
      ORDER BY ts DESC LIMIT 1
    `);
    this._getSetting = db.prepare(`
      SELECT value FROM module_settings WHERE instance_id = ? AND key = ?
    `);
    this._upsertSetting = db.prepare(`
      INSERT INTO module_settings(instance_id, key, value, updated_ts)
      VALUES(@instance_id, @key, @value, @ts)
      ON CONFLICT(instance_id, key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts
    `);
    this._logAction = db.prepare(`
      INSERT INTO automation_log(instance_id, action, reason, ts)
      VALUES(@instance_id, @action, @reason, @ts)
    `);
    this._setRuntimeOverride = db.prepare(`
      INSERT INTO module_runtime_overrides(instance_id, paused, ts)
      VALUES(@instance_id, @paused, @ts)
      ON CONFLICT(instance_id) DO UPDATE SET paused=excluded.paused, ts=excluded.ts
    `);
    this._deleteRuntimeOverride = db.prepare(`DELETE FROM module_runtime_overrides WHERE instance_id = ?`);
    this._loadRuntimeOverrides = db.prepare(`SELECT * FROM module_runtime_overrides`);
    this._setIORuntimeOverride = db.prepare(`
      INSERT INTO io_runtime_overrides(io_id, value, active, ts, expires_at, permanent)
      VALUES(@io_id, @value, @active, @ts, @expires_at, @permanent)
      ON CONFLICT(io_id) DO UPDATE SET value=excluded.value, active=excluded.active, ts=excluded.ts, expires_at=excluded.expires_at, permanent=excluded.permanent
    `);
    this._deleteIORuntimeOverride = db.prepare(`DELETE FROM io_runtime_overrides WHERE io_id = ?`);
    this._loadIORuntimeOverrides = db.prepare(`SELECT * FROM io_runtime_overrides`);

    this._restorePersistedOverrides();
  }

  _restorePersistedOverrides() {
    try {
      for (const row of this._loadRuntimeOverrides.all()) {
        if (Number(row.paused) === 1) {
          this.overrides.set(Number(row.instance_id), { paused: true, ts: Number(row.ts) || Date.now() });
        }
      }
      const now = Date.now();
      for (const row of this._loadIORuntimeOverrides.all()) {
        const ioId = Number(row.io_id);
        const entry = this._normalizeIOOverrideEntry(ioId, {
          value: row.value,
          active: Number(row.active) === 1,
          ts: Number(row.ts) || now,
          expires_at: row.expires_at,
          permanent: Number(row.permanent) === 1,
        });
        if (!entry) {
          this._deleteIORuntimeOverride.run(ioId);
          continue;
        }
        if (!entry.permanent && Number.isFinite(entry.expires_at) && entry.expires_at <= now) {
          this._deleteIORuntimeOverride.run(ioId);
          continue;
        }
        this.ioOverrides.set(ioId, entry);
    try { this._setIORuntimeOverride.run({ io_id: ioId, value: entry.value, active: 1, ts: entry.ts, expires_at: entry.permanent ? null : entry.expires_at, permanent: entry.permanent ? 1 : 0 }); } catch (_) {}
      }
    } catch (e) {
      console.error("[ENGINE] restore overrides failed:", e.message);
    }
  }

  // ── Registration ───────────────────────────────────────────────────────
  register(moduleId, handler) {
    // handler(ctx) → { action, command } | null
    this.handlers.set(moduleId, handler);
    console.log(`[ENGINE] Registered handler for module: ${moduleId}`);
  }

  setMqttApi(api) { this.mqttApi = api; }

  // ── Context helpers (passed to each handler) ──────────────────────────
  makeCtx(instance) {
    const engine = this;
    const mappings = this._getMappings.all(instance.id);

    return {
      instance,
      mappings,
      _engine: engine, // allow modules to access engine internals

      // Get IO for a specific input key
      io(inputKey) {
        const m = mappings.find(x => x.input_key === inputKey);
        return m?.io_id ? engine._getIOById.get(m.io_id) : null;
      },

      // Get latest sensor value (returns float or null)
      value(inputKey) {
        const io = this.io(inputKey);
        if (!io) return null;
        const ov = engine.getActiveIOOverride(io.id);
        if (ov && ov.active) { const v = parseFloat(ov.value); return isNaN(v) ? null : v; }
        const row = engine._getLatestState.get(io.device_id, io.key);
        if (!row) return null;
        const v = parseFloat(row.value);
        return isNaN(v) ? null : v;
      },

      // Get raw string state (e.g. "ON"/"OFF")
      state(inputKey) {
        const io = this.io(inputKey);
        if (!io) return null;
        const ov = engine.getActiveIOOverride(io.id);
        if (ov && ov.active) return String(ov.value);
        const row = engine._getLatestState.get(io.device_id, io.key);
        return row?.value ?? null;
      },

      // Get setting with default
      setting(key, defaultVal) {
        try {
          const row = engine._getSetting.get(instance.id, key);
          const v   = row ? parseFloat(row.value) : NaN;
          return isNaN(v) ? defaultVal : v;
        } catch { return defaultVal; }
      },

      settingStr(key, defaultVal = "") {
        try {
          const row = engine._getSetting.get(instance.id, key);
          return row?.value ?? defaultVal;
        } catch { return defaultVal; }
      },

      // Check if a relay is currently ON
      isOn(inputKey) { return this.state(inputKey) === "ON"; },

      // Persist a setting (for energy kWh, maintenance hours, etc.)
      setSetting(key, value) {
        engine._upsertSetting.run({ instance_id: instance.id, key, value: String(value), ts: Date.now() });
      },

      // Send a notification (if notifications module available)
      notify(opts) {
        try { engine.notify && engine.notify(opts); } catch {}
      },

      // Broadcast to dashboard
      broadcastState(payload) {
        try {
          const merged = Object.assign({}, engine.runtimeState.get(instance.id) || {}, payload || {}, { ts: Date.now() });
          engine.runtimeState.set(instance.id, merged);
          engine.broadcast && engine.broadcast({ type: "automation", instance: instance.id, module: instance.module_id, site_id: instance.site_id ?? null, siteId: instance.site_id ?? null, ...merged });
        } catch {}
      },

      testMode() {
        return engine.isInstanceDryRun(instance.id);
      },
    };
  }


  _typeName(io) {
    return String(io?.type || "").trim().toUpperCase();
  }

  isOutputIO(io) {
    const type = this._typeName(io);
    return new Set(["DO", "AO", "RELAY", "DIMMER", "OUTPUT", "DIGITAL_OUTPUT", "ANALOG_OUTPUT"]).has(type);
  }

  _normalizeOverrideValue(io, value) {
    const raw = value == null ? "" : String(value).trim();
    const type = this._typeName(io);
    if (new Set(["DI", "DO", "RELAY", "SWITCH", "BOOL", "BOOLEAN", "DIGITAL_INPUT", "DIGITAL_OUTPUT"]).has(type)) {
      const up = raw.toUpperCase();
      if (["1", "ON", "TRUE", "OPEN"].includes(up)) return "ON";
      if (["0", "OFF", "FALSE", "CLOSE", "CLOSED"].includes(up)) return "OFF";
      return up || "OFF";
    }
    if (new Set(["AI", "AO", "DIMMER", "ANALOG", "ANALOGOUT", "ANALOGIN", "ANALOG_INPUT", "ANALOG_OUTPUT"]).has(type)) {
      const n = Number(raw);
      if (Number.isFinite(n)) return String(n);
    }
    return raw;
  }

  _normalizeIOOverrideEntry(io_id, entry) {
    if (!entry || entry.active !== true) return null;
    const ts = Number(entry.ts) || Date.now();
    let expiresAt = null;
    let permanent = entry.permanent === true || entry.expires_at == null;

    if (entry.expires_at !== undefined && entry.expires_at !== null && entry.expires_at !== "") {
      const n = Number(entry.expires_at);
      if (Number.isFinite(n) && n > 0) {
        expiresAt = n;
        permanent = false;
      }
    }

    return {
      value: String(entry.value ?? ""),
      active: true,
      ts,
      expires_at: permanent ? null : expiresAt,
      permanent: !!permanent,
    };
  }

  getActiveIOOverride(io_id, { prune = true } = {}) {
    const id = Number(io_id);
    if (!Number.isFinite(id)) return null;
    const raw = this.ioOverrides.get(id);
    const ov = this._normalizeIOOverrideEntry(id, raw);
    if (!ov) {
      if (raw) this.ioOverrides.delete(id);
      return null;
    }
    if (!ov.permanent && Number.isFinite(ov.expires_at) && ov.expires_at <= Date.now()) {
      if (prune) { this.ioOverrides.delete(id); try { this._deleteIORuntimeOverride.run(id); } catch (_) {} }
      return null;
    }
    if (prune && raw !== ov) this.ioOverrides.set(id, ov);
    return ov;
  }

  pruneExpiredIOOverrides() {
    let changed = false;
    const now = Date.now();
    for (const [id, raw] of Array.from(this.ioOverrides.entries())) {
      const ov = this._normalizeIOOverrideEntry(id, raw);
      if (!ov || (!ov.permanent && Number.isFinite(ov.expires_at) && ov.expires_at <= now)) {
        this.ioOverrides.delete(id);
        try { this._deleteIORuntimeOverride.run(id); } catch (_) {}
        changed = true;
        continue;
      }
      if (raw !== ov) this.ioOverrides.set(id, ov);
    }
    if (changed) {
      this._getInstances.all().forEach(inst => {
        if (!this.isPaused(inst.id)) this.evaluate(inst);
      });
    }
    return changed;
  }

  isInstanceDryRun(instance_id) {
    try {
      const row = this._getSetting.get(Number(instance_id), 'test_mode');
      return String(row?.value ?? '0') === '1';
    } catch (_) {
      return false;
    }
  }

  sendIOCommand(io, value, meta = {}) {
    if (!io) return { ok: false, error: "io_not_found" };

    const normalized = this._normalizeOverrideValue(io, value);
    const dryRun = meta.dryRun === true || (!!meta.instanceId && this.isInstanceDryRun(meta.instanceId));
    if (dryRun) {
      if (meta.instanceId && !meta.fromSendCommand) {
        const actionKey = meta.inputKey || io.key || 'io';
        const actionName = `${actionKey}_DRYRUN_${normalized}`;
        const reason = `[TEST MODE] ${meta.reason || 'Dry-run command intercepted'}`;
        try {
          this._logAction.run({ instance_id: meta.instanceId, action: actionName, reason, ts: Date.now() });
        } catch (_) {}
        try {
          this.broadcast && this.broadcast({
            type: 'automation',
            module: meta.moduleId || null,
            instance: meta.instanceId || null,
            action: actionName,
            reason,
            dry_run: true,
            io_key: io.key,
            requested_value: normalized,
            site_id: meta.siteId ?? null,
            siteId: meta.siteId ?? null,
            ts: Date.now(),
          });
        } catch {}
      }
      return { ok: true, value: normalized, dryRun: true, sent: null };
    }

    const forced = this.getActiveIOOverride(io.id);
    if (forced && this.isOutputIO(io) && !meta.allowWhenForced) {
      const reason = meta.reason || "Blocked by active IO override";
      try {
        this.broadcast && this.broadcast({
          type: "automation",
          module: meta.moduleId || null,
          instance: meta.instanceId || null,
          action: `blocked_${io.key}`,
          reason,
          io_id: io.id,
          forced_value: forced.value,
          requested_value: normalized,
          site_id: meta.siteId ?? null,
          siteId: meta.siteId ?? null,
          ts: Date.now(),
        });
      } catch {}
      console.log(`[ENGINE] Blocked command to forced IO ${io.device_id}/${io.key}: requested=${normalized} forced=${forced.value}`);
      return { ok: false, blocked: true, error: "io_forced", forced };
    }

    if (!this.mqttApi) return { ok: false, error: "mqtt_not_ready" };
    let sent = null;
    if (this.mqttApi.sendCommand) {
      sent = this.mqttApi.sendCommand(io.device_id, io.key, normalized);
    } else if (this.mqttApi.publish) {
      this.mqttApi.publish(io.device_id, io.key, normalized);
      sent = { topic: `${io.device_id}/${io.key}`, payload: normalized };
    }
    return { ok: true, value: normalized, sent };
  }

  // ── Command execution ─────────────────────────────────────────────────
  sendCommand(instance, inputKey, value, reason) {
    const mappings = this._getMappings.all(instance.id);
    const m        = mappings.find(x => x.input_key === inputKey);
    if (!m?.io_id) return { ok: false, error: "mapping_not_found" };
    const io = this._getIOById.get(m.io_id);
    if (!io) return { ok: false, error: "io_not_found" };

    const result = this.sendIOCommand(io, value, {
      moduleId: instance.module_id,
      instanceId: instance.id,
      inputKey,
      reason,
      siteId: instance.site_id,
      fromSendCommand: true,
    });

    if (!result.ok) {
      if (result.blocked) {
        this._logAction.run({
          instance_id: instance.id,
          action:      `${inputKey}_BLOCKED_${value}`,
          reason:      `${reason} (forced ${io.key}=${result.forced?.value})`,
          ts:          Date.now(),
        });
      }
      return result;
    }

    const isDryRun = result.dryRun === true;
    const actionName = isDryRun ? `${inputKey}_DRYRUN_${result.value}` : `${inputKey}_${result.value}`;
    const actionReason = isDryRun ? `[TEST MODE] ${reason}` : reason;

    this._logAction.run({
      instance_id: instance.id,
      action:      actionName,
      reason:      actionReason,
      ts:          Date.now(),
    });

    console.log(`[ENGINE] ${instance.name} (${instance.module_id})${isDryRun ? ' [TEST MODE]' : ''}: ${reason} → ${inputKey}=${result.value}`);

    this.broadcast({
      type:       "automation",
      module:     instance.module_id,
      instance:   instance.id,
      action:     actionName,
      reason:     actionReason,
      dry_run:    isDryRun,
      io_key:     io.key,
      requested_value: result.value,
      site_id:    instance.site_id ?? null,
      siteId:     instance.site_id ?? null,
      ts:         Date.now(),
    });
    return result;
  }

  // ── Evaluate one instance ─────────────────────────────────────────────
  evaluate(instance) {
    if (this.overrides.get(instance.id)?.paused) return;
    const handler = this.handlers.get(instance.module_id);
    if (!handler) return;

    try {
      const ctx = this.makeCtx(instance);
      // Fetch site info for modules that need lat/lon (lighting sunrise/sunset)
      let siteInfo = null;
      try {
        const siteRow = this.db.prepare(`SELECT lat, lon, timezone FROM sites WHERE id = (SELECT site_id FROM module_instances WHERE id = ?)`).get(instance.id);
        if (siteRow?.lat) siteInfo = siteRow;
      } catch {}
      handler(ctx, (inputKey, value, reason) => {
        this.sendCommand(instance, inputKey, value, reason);
      }, siteInfo);
    } catch (e) {
      console.error(`[ENGINE] Error in ${instance.module_id}/${instance.id}:`, e.message);
    }
  }

  // ── Called on every MQTT update ───────────────────────────────────────
  onSensorUpdate(deviceId, key) {
    const instances = this._getInstances.all();
    for (const inst of instances) {
      const mappings = this._getMappings.all(inst.id);
      const relevant = mappings.some(m => {
        const io = m.io_id ? this._getIOById.get(m.io_id) : null;
        return io?.device_id === deviceId && io?.key === key;
      });
      if (relevant) this.evaluate(inst);
    }
  }

  evaluateAll() {
    this.pruneExpiredIOOverrides();
    const instances = this._getInstances.all();
    instances.forEach(i => this.evaluate(i));
  }

  // ── Settings API ──────────────────────────────────────────────────────
  setSetting(instance_id, key, value) {
    this._upsertSetting.run({ instance_id, key, value: String(value), ts: Date.now() });
    // Re-evaluate
    const instances = this._getInstances.all().filter(i => i.id === instance_id);
    instances.forEach(i => this.evaluate(i));
  }

  getSettings(instance_id) {
    return this.db.prepare(`
      SELECT key, value FROM module_settings WHERE instance_id = ?
    `).all(instance_id).reduce((acc, r) => ({ ...acc, [r.key]: r.value }), {});
  }

  getLog(instance_id, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM automation_log WHERE instance_id = ?
      ORDER BY ts DESC LIMIT ?
    `).all(instance_id, limit);
  }

  // ── Override ──────────────────────────────────────────────────────────
  setOverride(instance_id, paused) {
    const ts = Date.now();
    if (paused) {
      this.overrides.set(instance_id, { paused: true, ts });
      try { this._setRuntimeOverride.run({ instance_id, paused: 1, ts }); } catch (_) {}
      return;
    }
    this.overrides.delete(instance_id);
    try { this._deleteRuntimeOverride.run(instance_id); } catch (_) {}
    const inst = this._getInstances.all().find(i => i.id === instance_id);
    if (inst) this.evaluate(inst);
  }

  // IO value override (test/debug / force-hold mode)
  setIOOverride(io_id, valueOrOptions, legacyActive) {
    const ioId = Number(io_id);
    if (!Number.isFinite(ioId)) throw new Error("invalid_io_id");
    const io = this._getIOById.get(ioId);
    if (!io) throw new Error("io_not_found");

    let active = false;
    let value = "";
    let permanent = true;
    let expiresAt = null;

    if (valueOrOptions && typeof valueOrOptions === "object" && !Array.isArray(valueOrOptions)) {
      active = !!valueOrOptions.active;
      value = valueOrOptions.value ?? "";
      if (valueOrOptions.permanent === true || String(valueOrOptions.duration || "").toUpperCase() === "PERM") {
        permanent = true;
      } else if (valueOrOptions.expires_at !== undefined && valueOrOptions.expires_at !== null && valueOrOptions.expires_at !== "") {
        const n = Number(valueOrOptions.expires_at);
        if (Number.isFinite(n) && n > Date.now()) {
          expiresAt = n;
          permanent = false;
        }
      } else {
        const durationMs =
          Number(valueOrOptions.duration_ms) ||
          (Number(valueOrOptions.duration_minutes) > 0 ? Number(valueOrOptions.duration_minutes) * 60 * 1000 : 0) ||
          (Number(valueOrOptions.duration_s) > 0 ? Number(valueOrOptions.duration_s) * 1000 : 0);
        if (Number.isFinite(durationMs) && durationMs > 0) {
          expiresAt = Date.now() + durationMs;
          permanent = false;
        }
      }
    } else {
      value = valueOrOptions;
      active = !!legacyActive;
      permanent = true;
    }

    if (!active) {
      this.ioOverrides.delete(ioId);
      try { this._deleteIORuntimeOverride.run(ioId); } catch (_) {}
      this._getInstances.all().forEach(inst => {
        if (!this.isPaused(inst.id)) this.evaluate(inst);
      });
      return { active: false, cleared: true };
    }

    const normalizedValue = this._normalizeOverrideValue(io, value);
    const entry = {
      value: normalizedValue,
      active: true,
      ts: Date.now(),
      expires_at: permanent ? null : expiresAt,
      permanent: !!permanent,
    };

    this.ioOverrides.set(ioId, entry);

    if (this.isOutputIO(io)) {
      this.sendIOCommand(io, normalizedValue, {
        allowWhenForced: true,
        reason: "IO override applied",
      });
    }

    this._getInstances.all().forEach(inst => {
      if (!this.isPaused(inst.id)) this.evaluate(inst);
    });
    return entry;
  }

  getIOOverrides() {
    this.pruneExpiredIOOverrides();
    const result = {};
    this.ioOverrides.forEach((_, k) => {
      const ov = this.getActiveIOOverride(k);
      if (ov) result[k] = ov;
    });
    return result;
  }

  isPaused(instance_id) {
    return this.overrides.get(instance_id)?.paused === true;
  }

  // ── History for charts ────────────────────────────────────────────────
  getHistory(instance_id, inputKeys, since) {
    const result = {};
    const mappings = this._getMappings.all(instance_id);

    for (const key of inputKeys) {
      const m  = mappings.find(x => x.input_key === key);
      const io = m?.io_id ? this._getIOById.get(m.io_id) : null;
      if (!io) { result[key] = []; continue; }

      const rows = this.db.prepare(`
        SELECT payload as value, ts FROM events
        WHERE device_id = ? AND topic LIKE ? AND ts >= ?
        ORDER BY ts ASC LIMIT 500
      `).all(io.device_id, `%/${io.key}`, since);

      result[key] = rows
        .map(r => ({ ts: r.ts, v: parseFloat(r.value) }))
        .filter(r => !isNaN(r.v));
    }
    return result;
  }

  // ── Live status (for dashboard widgets) ──────────────────────────────
  getLiveStatus(instance_id) {
    const inst = this._getInstances.all().find(i => i.id === instance_id);
    if (!inst) return { found: false };

    const ctx      = this.makeCtx(inst);
    const mappings = this._getMappings.all(instance_id);
    const settings = this.getSettings(instance_id);
    const lastLog  = this.getLog(instance_id, 3);
    const paused   = this.isPaused(instance_id);

    // Build values map for all inputs
    const values = {};
    for (const m of mappings) {
      if (m.input_key) values[m.input_key] = ctx.value(m.input_key) ?? ctx.state(m.input_key);
    }

    const state = this.runtimeState.get(instance_id) || null;
    return { found: true, paused, values, settings, lastLog, state, module_id: inst.module_id, test_mode: this.isInstanceDryRun(instance_id) };
  }

  // ── Periodic tick (every 30s) — ensures schedule/sunset triggers fire ─
  startTick(intervalMs = 30000) {
    if (this._tickInterval) return; // already started
    this._tickInterval = setInterval(() => {
      try { this.evaluateAll(); } catch (e) { console.error("[ENGINE] tick error:", e.message); }
    }, intervalMs);
    console.log(`[ENGINE] Periodic tick started (${intervalMs/1000}s interval)`);
  }

  stopTick() {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }
}

module.exports = { AutomationEngine };
