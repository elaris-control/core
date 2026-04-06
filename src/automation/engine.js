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
    this.dryRunLog = new Map(); // instance_id → recent dry-run commands
    this._lastSentState = new Map(); // "deviceId:ioKey" → { value, ts } — prevents flip-flop across all modules
    this._deviceReconnectTs = new Map(); // deviceId → ts of reconnect — 10s stabilization window
    this._startupTs = Date.now();         // startup timestamp — onSensorUpdate blocked for 10s

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
      CREATE INDEX IF NOT EXISTS idx_module_mappings_io ON module_mappings(io_id);
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
    this._getMappingsWithIO = db.prepare(`
      SELECT mm.*, io.key as io_key, io.name as io_name,
             io.type as io_type, io.group_name, io.device_id, io.unit,
             io.id as io_id, io.key as io_raw_key
      FROM module_mappings mm
      LEFT JOIN io ON io.id = mm.io_id
      WHERE mm.instance_id = ?
    `);
    this._getLatestState = db.prepare(`
      SELECT value FROM device_state
      WHERE device_id = ? AND key = ?
      ORDER BY ts DESC LIMIT 1
    `);
    this._getMqttTopicRoot = db.prepare(`
      SELECT mqtt_topic_root FROM esphome_devices
      WHERE name = ? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1
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

  setNativeSessionManager(nativeSessions, adapter) {
    this.nativeSessions = nativeSessions;
    this.nativeAdapter = adapter;
  }

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
        const stateKey = io.group_name ? `${io.group_name}.${io.key}` : io.key;
        const row = engine._getLatestState.get(io.device_id, stateKey) || engine._getLatestState.get(io.device_id, io.key);
        if (!row) return null;
        const v = parseFloat(row.value);
        return isNaN(v) ? null : v;
      },

      // Get raw string state (e.g. "ON"/"OFF")
      state(inputKey) {
        if (this._stateOverrides && this._stateOverrides[inputKey] != null) return this._stateOverrides[inputKey];
        const io = this.io(inputKey);
        if (!io) return null;
        const ov = engine.getActiveIOOverride(io.id);
        if (ov && ov.active) return String(ov.value);
        const stateKey = io.group_name ? `${io.group_name}.${io.key}` : io.key;
        const row = engine._getLatestState.get(io.device_id, stateKey) || engine._getLatestState.get(io.device_id, io.key);
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
      isOn(inputKey) { const v = this.state(inputKey); return v != null && typeof v === 'string' ? v.toUpperCase() === 'ON' : v === 1 || v === true; },

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

      testLog(limit = 20) {
        return engine.getDryRunLog(instance.id, limit);
      },

      clearTestLog() {
        return engine.clearDryRunLog(instance.id);
      },

      testLogSummary(limit = 20) {
        return engine.getDryRunLogSummary(instance.id, limit);
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

  recordDryRun(instance_id, entry) {
    const id = Number(instance_id);
    if (!Number.isFinite(id) || !entry) return [];
    const row = {
      ts: Number(entry.ts) || Date.now(),
      inputKey: entry.inputKey || entry.input_key || null,
      ioKey: entry.ioKey || entry.io_key || null,
      value: entry.value == null ? '' : String(entry.value),
      reason: entry.reason == null ? '' : String(entry.reason),
      moduleId: entry.moduleId || entry.module_id || null,
      siteId: entry.siteId || entry.site_id || null,
    };
    const log = this.dryRunLog.get(id) || [];
    log.push(row);
    const maxEntries = 200;
    if (log.length > maxEntries) log.splice(0, log.length - maxEntries);
    this.dryRunLog.set(id, log);
    return log;
  }

  getDryRunLog(instance_id, limit = 20) {
    const id = Number(instance_id);
    if (!Number.isFinite(id)) return [];
    const log = this.dryRunLog.get(id) || [];
    const n = Math.max(0, Number(limit) || 0);
    return n > 0 ? log.slice(-n) : log.slice();
  }

  clearDryRunLog(instance_id) {
    const id = Number(instance_id);
    if (!Number.isFinite(id)) return [];
    this.dryRunLog.set(id, []);
    return [];
  }

  getDryRunLogSummary(instance_id, limit = 20) {
    const id = Number(instance_id);
    if (!Number.isFinite(id)) return { count: 0, recent: [] };
    const log = this.dryRunLog.get(id) || [];
    const n = Math.max(0, Number(limit) || 0);
    return {
      count: log.length,
      recent: n > 0 ? log.slice(-n) : log.slice(),
    };
  }

  sendIOCommand(io, value, meta = {}) {
    if (!io) return { ok: false, error: "io_not_found" };

    const normalized = this._normalizeOverrideValue(io, value);
    const dryRun = meta.dryRun === true || (!!meta.instanceId && this.isInstanceDryRun(meta.instanceId));
    if (dryRun) {
      const dryRunTs = Date.now();
      if (meta.instanceId) {
        this.recordDryRun(meta.instanceId, {
          ts: dryRunTs,
          inputKey: meta.inputKey || null,
          ioKey: io.key,
          value: normalized,
          reason: meta.reason || 'Dry-run command intercepted',
          moduleId: meta.moduleId || null,
          siteId: meta.siteId ?? null,
        });
      }
      if (meta.instanceId && !meta.fromSendCommand) {
        const actionKey = meta.inputKey || io.key || 'io';
        const actionName = `${actionKey}_DRYRUN_${normalized}`;
        const reason = `[TEST MODE] ${meta.reason || 'Dry-run command intercepted'}`;
        try {
          this._logAction.run({ instance_id: meta.instanceId, action: actionName, reason, ts: dryRunTs });
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
            ts: dryRunTs,
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

    // Try native session first (for external devices connected via ESPHome native API)
    if (this.nativeSessions && this.nativeAdapter) {
      const deviceName = String(io.device_id || '').trim();
      const sessionKey = `esphome::${deviceName}`;
      const sessions = this.nativeSessions.list ? this.nativeSessions.list('esphome') : [];
      const hasActive = sessions.some(s => {
        const name = String(s.device_name || '').trim().toLowerCase();
        return name === deviceName.toLowerCase() && s.connected && s.live_stream;
      });
      if (hasActive) {
        const ioType = String(io.type || '').toLowerCase();
        let command;
        if (ioType === 'ao' || ioType === 'analog_out' || ioType === 'number' || ioType === 'dimmer') {
          const numVal = parseFloat(normalized);
          command = { entity_key: io.key, entity_type: 'number', action: 'set', value: Number.isFinite(numVal) ? numVal : 0 };
        } else {
          const action = String(normalized).toUpperCase() === 'ON' || normalized === true || normalized === 1 || normalized === '1' ? 'on' : 'off';
          command = { entity_key: io.key, entity_type: 'switch', action };
        }
        const payload = { device_name: deviceName };
        // Fire-and-forget — fall through to MQTT regardless so commands always reach the device
        this.nativeSessions.execute(this.nativeAdapter, 'esphome', payload, command).catch(err => {
          console.warn(`[ENGINE] native command failed ${deviceName}/${io.key}: ${err?.code || err?.message || err}`);
        });
      }
    }

    // Skip redundant sends — if relay is already in desired state, don't resend
    // Uses both MQTT state AND last-sent-state as fallback (handles null state after reconnect)
    if (!meta.force) {
      const sentKey = `${io.device_id}:${io.key}`;
      const lastSent = this._lastSentState.get(sentKey);
      const now = Date.now();

      // Skip if same value sent within last 5 seconds (flip-flop prevention)
      if (lastSent && lastSent.value === normalized && (now - lastSent.ts) < 5000) {
        return { ok: true, value: normalized, skipped: true, reason: 'recently_sent' };
      }

      // Also check current MQTT state
      const stateKey = io.group_name ? `${io.group_name}.${io.key}` : io.key;
      const row = this._getLatestState.get(io.device_id, stateKey) || this._getLatestState.get(io.device_id, io.key);
      if (row) {
        const cu = String(row.value).toUpperCase();
        const currentOn = cu === 'ON' || cu === '1' || cu === 'TRUE' || cu === 'YES';
        const nv = String(normalized).toUpperCase();
        const desiredOn = nv === 'ON' || nv === '1' || nv === 'TRUE' || nv === 'YES';
        if (currentOn === desiredOn) {
          // Update last-sent-state so the 5s cooldown is refreshed
          this._lastSentState.set(sentKey, { value: normalized, ts: now });
          return { ok: true, value: normalized, skipped: true, reason: 'already_in_state' };
        }
      } else if (lastSent) {
        // MQTT state unknown — check last-sent-state as fallback
        const lu = String(lastSent.value).toUpperCase();
        const lastOn = lu === 'ON' || lu === '1' || lu === 'TRUE' || lu === 'YES';
        const nv = String(normalized).toUpperCase();
        const desiredOn = nv === 'ON' || nv === '1' || nv === 'TRUE' || nv === 'YES';
        if (lastOn === desiredOn) {
          return { ok: true, value: normalized, skipped: true, reason: 'last_sent_matches' };
        }
      }
    }

    if (!this.mqttApi) return { ok: false, error: "mqtt_not_ready" };
    const mqttRootRow = this._getMqttTopicRoot.get(io.device_id);
    const mqttTopicRoot = String(mqttRootRow?.mqtt_topic_root || '').trim() || null;
    let sent = null;
    if (this.mqttApi.sendCommand) {
      sent = this.mqttApi.sendCommand(io.device_id, io.key, normalized, mqttTopicRoot);
    } else if (this.mqttApi.publish) {
      this.mqttApi.publish(io.device_id, io.key, normalized);
      sent = { topic: `${io.device_id}/${io.key}`, payload: normalized };
    }
    return { ok: true, value: normalized, sent };
  }

  // ── Command execution ─────────────────────────────────────────────────
  sendCommand(instance, inputKey, value, reason, meta = {}) {
    const mappings = this._getMappings.all(instance.id);
    const m        = mappings.find(x => x.input_key === inputKey);
    if (!m?.io_id) return { ok: false, error: "mapping_not_found" };
    const io = this._getIOById.get(m.io_id);
    if (!io) return { ok: false, error: "io_not_found" };

    // Normalize the value to compare against last sent state
    const normalized = this._normalizeOverrideValue(io, value);
    const sentKey = `${io.device_id}:${io.key}`;
    const lastSent = this._lastSentState.get(sentKey);
    const now = Date.now();

    // Skip if same value sent within last 5 seconds (flip-flop prevention)
    if (!meta.force && lastSent && lastSent.value === normalized && (now - lastSent.ts) < 5000) {
      return { ok: true, value: normalized, skipped: true, reason: 'recently_sent' };
    }

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

    if (result.skipped) return result;

    // Track what we just sent (device-level key, not instance-level)
    this._lastSentState.set(sentKey, { value: normalized, ts: now });

    const isDryRun = result.dryRun === true;
    const customAction = (meta && typeof meta.action === 'string') ? String(meta.action).trim() : '';
    const skipLog = !!(meta && meta.skipLog);
    const actionName = customAction
      ? (isDryRun ? `${customAction}_DRYRUN` : customAction)
      : (isDryRun ? `${inputKey}_DRYRUN_${result.value}` : `${inputKey}_${result.value}`);
    const actionReason = isDryRun ? `[TEST MODE] ${reason}` : reason;

    if (!skipLog) {
      this._logAction.run({
        instance_id: instance.id,
        action:      actionName,
        reason:      actionReason,
        ts:          Date.now(),
      });
    }

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

      // Skip evaluation if any mapped relay/DO output has unknown state
      // (common after MQTT reconnect / ESP reboot — prevents false flip-flop)
      const relayOutputKeys = ['light_relay', 'light_relay_2', 'light_relay_3', 'light_relay_4',
        'filter_pump', 'pump', 'heater', 'backup', 'ac_relay',
        'central_pump', 'solar_pump', 'spa_jets', 'lights', 'hp_defrost',
        'ph_minus_pump', 'ph_plus_pump', 'cl_pump', 'heat_source_1', 'heat_source_2',
        'humidity_relay', 'tv_relay', 'radio_relay', 'awning_relay', 'presence_sensor',
        'dimmer_output'];
      const callOutputKeys = ['zone_1_output', 'zone_2_output', 'zone_3_output', 'zone_4_output', 'zone_5_output', 'zone_6_output'];
      for (const key of relayOutputKeys) {
        const io = ctx.io(key);
        if (!io) continue;
        const raw = ctx.state(key);
        if (raw === null || raw === undefined) {
          return; // Unknown output state — skip to avoid false decisions
        }
      }
      // Call-thermostat outputs: treat unknown as OFF so the handler can engage the relay
      for (const key of callOutputKeys) {
        const io = ctx.io(key);
        if (!io) continue;
        const raw = ctx.state(key);
        if (raw === null || raw === undefined) {
          ctx._stateOverrides = ctx._stateOverrides || {};
          ctx._stateOverrides[key] = 'OFF';
        }
      }

      // Fetch site info for modules that need lat/lon (lighting sunrise/sunset)
      let siteInfo = null;
      try {
        const siteRow = this.db.prepare(`SELECT lat, lon, timezone FROM sites WHERE id = (SELECT site_id FROM module_instances WHERE id = ?)`).get(instance.id);
        if (siteRow?.lat) siteInfo = siteRow;
      } catch {}
      handler(ctx, (inputKey, value, reason, meta = {}) => {
        this.sendCommand(instance, inputKey, value, reason, meta || {});
      }, siteInfo);
    } catch (e) {
      console.error(`[ENGINE] Error in ${instance.module_id}/${instance.id}:`, e.message);
    }
  }

  // ── Called on every MQTT update ───────────────────────────────────────
  onSensorUpdate(deviceId, key) {
    // Block MQTT-triggered evaluations for 10s after startup — retained messages
    // arrive immediately on subscribe and can carry stale/transitional relay states.
    // evaluateAll() at 2s calls evaluate() directly and is not affected.
    if (Date.now() - this._startupTs < 10000) return;

    const reconnectTs = this._deviceReconnectTs.get(deviceId);
    const inStabilization = reconnectTs && (Date.now() - reconnectTs) < 10000;

    const instances = this._getInstances.all();
    for (const inst of instances) {
      const mappings = this._getMappings.all(inst.id);
      let relevant = false;
      for (const m of mappings) {
        if (!m.io_id) continue;
        const io = this._getIOById.get(m.io_id);
        if (!io || io.device_id !== deviceId) continue;
        const rawKey = String(io.key || '');
        const groupedKey = io.group_name ? `${io.group_name}.${io.key}` : rawKey;
        if (key === rawKey || key === groupedKey) {
          relevant = true;
          break;
        }
      }
      if (relevant && !inStabilization) this.evaluate(inst);
    }
  }

  notifyDeviceReconnect(deviceId) {
    this._deviceReconnectTs.set(String(deviceId), Date.now());
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

  getInstance(instance_id) {
    return this._getInstances.all().find(i => i.id === Number(instance_id)) || null;
  }

  getMappings(instance_id) {
    return this._getMappings.all(Number(instance_id));
  }

  getIO(io_id) {
    return this._getIOById.get(Number(io_id)) || null;
  }

  logAction(instance_id, action, reason) {
    this._logAction.run({
      instance_id: Number(instance_id),
      action,
      reason,
      ts: Date.now(),
    });
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

    // If it's an output (Relay/AO/DO) and "real" mode is enabled, send the MQTT command
    const isReal = valueOrOptions && valueOrOptions.real;
    console.log(`[DEBUG OVERRIDE] IO=${ioId} Type=${io.type} isOutput=${this.isOutputIO(io)} isReal=${isReal} Val=${normalizedValue} RealFromOpts=${valueOrOptions?.real}`);
    if (this.isOutputIO(io) && isReal) {
      console.log(`[DEBUG OVERRIDE] -> Calling sendIOCommand with allowWhenForced=true`);
      this.sendIOCommand(io, normalizedValue, {
        reason: 'Manual Override (Real)',
        skipLog: false,
        allowWhenForced: true,
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
    const dryRunSummary = this.getDryRunLogSummary(instance_id, 20);
    return { found: true, paused, values, settings, lastLog, state, module_id: inst.module_id, test_mode: this.isInstanceDryRun(instance_id), test_log_count: dryRunSummary.count, test_log_recent: dryRunSummary.recent };
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
