// src/mqtt.js
// MQTT client — message pipeline architecture
// Messages flow through discrete steps: Parse → Classify → Filter → Process → Persist → Notify

const mqtt = require("mqtt");
const {
  ELARIS_PREFIX,
  ELARIS_SUBSCRIPTIONS,
  ESPHOME_STANDARD_SUBSCRIPTIONS,
  ESPHOME_COMPONENT_TYPES,
  isIdentitySensorKey,
  elarisCommandTopic,
} = require("./mqtt_topics");

// ── Hardcoded topic list for retained cleanup on MAC duplicate purge ────────
const KNOWN_RETAINED_TOPICS = [
  'ht_1','ht_2','ht_3','sht3x_temp','sht3x_hum','bh1750_lux',
  'di_1','di_2','di_3','di_4','di_5','di_6','di_7','di_8','di_9','di_10','di_11','di_12','di_13','di_14','di_15','di_16',
  'relay_1','relay_2','relay_3','relay_4','relay_5','relay_6','relay_7','relay_8','relay_9','relay_10','relay_11','relay_12','relay_13','relay_14','relay_15','relay_16',
];

// ── Identity sensor dispatch table ──────────────────────────────────────────
const IDENTITY_DISPATCH = [
  {
    match: (k) => /mac/.test(k) || k.endsWith('mac_address'),
    field: 'mac_address',
    metaKey: 'mac_address',
    handle: (dbApi, deviceId, value, ts) => {
      dbApi.updateEspHomeIdentity(deviceId, { mac_address: value, ts });
      let purgeInfo = { ok: true, purged: [] };
      try {
        if (typeof dbApi.purgeEsphomeSameMacDuplicates === 'function') {
          purgeInfo = dbApi.purgeEsphomeSameMacDuplicates(deviceId, value) || purgeInfo;
        }
      } catch (e) {
        console.error('[MQTT] purgeEsphomeSameMacDuplicates error:', e.message);
      }
      return purgeInfo;
    },
  },
  {
    match: (k) => k === 'ip_address' || k.endsWith('_ip') || k.endsWith('_ip_address'),
    field: 'ip_address',
    metaKey: 'ip_address',
    handle: (dbApi, deviceId, value, ts) => {
      dbApi.updateEspHomeIdentity(deviceId, { ip_address: value, ts });
      return null;
    },
  },
  {
    match: (k) => k === 'version' || k === 'esphome_version' || k === 'firmware_version',
    field: 'firmware_version',
    metaKey: 'firmware_version',
    handle: (dbApi, deviceId, value, ts) => {
      dbApi.updateEspHomeIdentity(deviceId, { firmware_version: value, ts });
      return null;
    },
  },
];

// ── Cross-cutting helpers ───────────────────────────────────────────────────

function persistEvent(dbApi, deviceId, topic, payload, ts) {
  if (typeof dbApi?.insertEvent?.run === 'function') {
    dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
  }
}

function notifyEmit(broadcast, withSiteScope, type, payload) {
  try { broadcast({ type, ts: Date.now(), ...withSiteScope(payload) }); } catch (_) {}
}

function touchRegistry(dbApi, deviceId, status, ts) {
  if (typeof dbApi?.touchEspHomeRegistry === 'function') {
    dbApi.touchEspHomeRegistry(deviceId, { status, ts });
  }
}

function cacheState(dbApi, deviceId, stateKey, value, ts) {
  if (typeof dbApi?.upsertState?.run === 'function') {
    dbApi.upsertState.run({ device_id: deviceId, key: stateKey, value, ts });
  }
}

function triggerSolar(solarAuto, deviceId, stateKey) {
  if (solarAuto) solarAuto.onSensorUpdate(deviceId, stateKey);
}

function cleanupRetainedTopics(client, deviceId, purgeInfo) {
  if (!Array.isArray(purgeInfo?.purged)) return;
  for (const item of purgeInfo.purged) {
    const oldId = String(item?.device_id || '').trim();
    const oldRoot = String(item?.mqtt_topic_root || '').trim();
    const roots = Array.from(new Set([oldRoot, oldId ? `elaris/${oldId}` : ''].filter(Boolean)));
    for (const root of roots) {
      try { client.publish(root + '/config', '', { qos: 0, retain: true }); } catch (_) {}
      try { client.publish(root + '/status', '', { qos: 0, retain: true }); } catch (_) {}
    }
    const leaf = oldId || (oldRoot.startsWith('elaris/') ? oldRoot.slice('elaris/'.length) : '');
    if (leaf) {
      for (const k of KNOWN_RETAINED_TOPICS) {
        const grp = k.startsWith('relay_') ? 'state' : 'tele';
        try { client.publish(`elaris/${leaf}/${grp}/${k}`, '', { qos: 0, retain: true }); } catch (_) {}
      }
    }
  }
}

// ── Pipeline steps ──────────────────────────────────────────────────────────

function parseMessage(topic, payloadBuf, packet) {
  return {
    topic,
    payload: payloadBuf.toString("utf8"),
    trimmedPayload: payloadBuf.toString("utf8").trim(),
    ts: Date.now(),
    retained: !!packet?.retain,
    parts: topic.split("/"),
  };
}

function classifyMessage(parts, trimmedPayload) {
  const looksInteresting = (
    parts[0] === ELARIS_PREFIX ||
    (parts.length === 2 && parts[1] === 'status') ||
    (parts.length === 4 && ESPHOME_COMPONENT_TYPES.includes(parts[1]) && parts[3] === 'state')
  );

  if (parts[0] === ELARIS_PREFIX) {
    return {
      type: 'elaris',
      deviceId: parts[1] || "unknown",
      group: parts[2] || "unknown",
      key: parts[3] || "unknown",
      looksInteresting,
    };
  }

  if (parts.length === 2 && parts[1] === 'status') {
    return { type: 'esphome_status', deviceId: parts[0] || 'unknown', looksInteresting };
  }

  if (parts.length === 4 && parts[3] === 'state') {
    const component = parts[1];
    const diagKey = String(parts[2] || '').trim().toLowerCase();
    const isIdentityDiag = isIdentitySensorKey(diagKey);

    if (component === 'switch') {
      return { type: 'esphome_state', deviceId: parts[0] || 'unknown', group: 'state', key: parts[2], diagKey, isIdentityDiag, looksInteresting };
    }
    if (component === 'binary_sensor') {
      return { type: 'esphome_state', deviceId: parts[0] || 'unknown', group: 'tele', key: parts[2], diagKey, isIdentityDiag, looksInteresting };
    }
    if (component === 'sensor' || component === 'text_sensor') {
      return { type: 'esphome_state', deviceId: parts[0] || 'unknown', group: 'tele', key: parts[2], diagKey, isIdentityDiag, looksInteresting };
    }
  }

  return { type: 'unknown', looksInteresting };
}

// ── Main init ───────────────────────────────────────────────────────────────

function initMQTT({ url = "mqtt://localhost:1883", dbApi, broadcast, solarAuto = null }) {
  const client = mqtt.connect(url);
  const missedRetained = new Map();

  function isMqttDebugEnabled() {
    try {
      if (typeof dbApi?.getAppSetting === 'function') {
        const raw = dbApi.getAppSetting('mqtt_debug_enabled', null);
        if (raw != null) {
          const v = String(raw).trim().toLowerCase();
          if (['1','true','yes','on','enabled'].includes(v)) return true;
          if (['0','false','no','off','disabled'].includes(v)) return false;
        }
      }
    } catch (_) {}
    return process.env.ELARIS_MQTT_DEBUG === '0' ? false : true;
  }

  function mqttDebug(label, meta = null) {
    if (!isMqttDebugEnabled()) return;
    try {
      if (meta == null) console.log(`[MQTT DEBUG] ${label}`);
      else console.log(`[MQTT DEBUG] ${label}`, meta);
    } catch (_) {}
  }

  function withSiteScope(payload = {}) {
    const deviceId = payload?.deviceId ? String(payload.deviceId) : "";
    if (!deviceId) return payload;
    try {
      const ref = typeof dbApi.getDeviceSite?.get === "function"
        ? dbApi.getDeviceSite.get(deviceId)
        : (typeof dbApi.getDeviceSite === "function" ? dbApi.getDeviceSite(deviceId) : null);
      const siteId = ref?.site_id != null ? Number(ref.site_id) : null;
      if (siteId) return { ...payload, siteId, site_id: siteId };
    } catch (_) {}
    return payload;
  }

  function emit(type, payload) {
    notifyEmit(broadcast, withSiteScope, type, payload);
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  client.on("connect", () => {
    ELARIS_SUBSCRIPTIONS.forEach(t => client.subscribe(t));
    ESPHOME_STANDARD_SUBSCRIPTIONS.forEach(t => client.subscribe(t));
    console.log("[MQTT] connected & subscribed");
    mqttDebug('subscriptions_ready', { custom: ELARIS_SUBSCRIPTIONS, standard: ESPHOME_STANDARD_SUBSCRIPTIONS });
    emit("mqtt_status", { status: "connected" });
  });

  client.on("reconnect", () => emit("mqtt_status", { status: "reconnecting" }));
  client.on("close", () => emit("mqtt_status", { status: "disconnected" }));
  client.on("offline", () => emit("mqtt_status", { status: "offline" }));
  client.on("error", (e) => emit("mqtt_status", { status: "error", error: String(e?.message || e) }));

  // ── Message pipeline ──────────────────────────────────────────────────────

  client.on("message", (topic, payloadBuf, packet = {}) => {
    const parsed = parseMessage(topic, payloadBuf, packet);
    const { topic: msgTopic, payload, trimmedPayload, ts, retained, parts } = parsed;
    const classification = classifyMessage(parts, trimmedPayload);

    if (classification.looksInteresting) {
      mqttDebug('rx', { topic: msgTopic, retained, payload: String(trimmedPayload || payload || '').slice(0, 180) });
    }

    const msgType = classification.type;

    // ── ELARIS custom topics ──────────────────────────────────────────────
    if (msgType === 'elaris') {
      const { deviceId, group, key } = classification;

      if (group === "config") {
        if (!trimmedPayload) {
          persistEvent(dbApi, deviceId, msgTopic, payload, ts);
          emit("mqtt_config_ignored", { deviceId, topic: msgTopic, reason: 'empty_payload' });
          return;
        }
        try {
          const cfg = JSON.parse(String(payload).trim());
          dbApi.noteDeviceConfig({ deviceId, config: cfg, ts, retained });
          emit("mqtt_config", { deviceId, topic: msgTopic });
        } catch (e) {
          emit("mqtt_config_error", { deviceId, topic: msgTopic, error: String(e?.message || e) });
        }
        if (typeof solarAuto?.notifyDeviceReconnect === 'function') {
          solarAuto.notifyDeviceReconnect(deviceId);
        }
        persistEvent(dbApi, deviceId, msgTopic, payload, ts);
        return;
      }

      if (group === "cmnd") {
        persistEvent(dbApi, deviceId, msgTopic, payload, ts);
        emit("mqtt_command_observed", { deviceId, topic: msgTopic, key, payload });
        return;
      }

      if ((group === 'tele' || group === 'state') && !trimmedPayload) {
        persistEvent(dbApi, deviceId, msgTopic, payload, ts);
        emit("mqtt_ignored", { topic: msgTopic, deviceId, group, key: `${group}.${key}`, reason: 'empty_payload' });
        return;
      }

      const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts, retained });
      mqttDebug('custom_topic_processed', { deviceId, group, key, retained, result: noteResult?.reason || null, pending: !!noteResult?.ok });

      if (group === "tele" || group === "state") {
        cacheState(dbApi, deviceId, `${group}.${key}`, payload, ts);
        mqttDebug('state_cache_upsert', { deviceId, state_key: `${group}.${key}`, retained, from: 'custom' });
      }

      persistEvent(dbApi, deviceId, msgTopic, payload, ts);
      triggerSolar(solarAuto, deviceId, `${group}.${key}`);
      emit("mqtt", { topic: msgTopic, deviceId, group, key: `${group}.${key}`, payload });
      return;
    }

    // ── ESPHome standard topics ───────────────────────────────────────────
    if (msgType === 'esphome_status') {
      const { deviceId } = classification;
      const known = typeof dbApi.findEspHomeRegistry === 'function' ? dbApi.findEspHomeRegistry(deviceId) : null;
      if (!known) {
        if (classification.looksInteresting) mqttDebug('standard_topic_registry_miss', { deviceId, topic: msgTopic, retained });
        if (retained) {
          if (!missedRetained.has(deviceId)) missedRetained.set(deviceId, new Set());
          missedRetained.get(deviceId).add(msgTopic);
        }
        return;
      }

      const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group: 'meta', key: 'status', value: payload, ts, retained, allowRetained: true });
      mqttDebug('status_processed', { deviceId, retained, payload: trimmedPayload || payload, result: noteResult?.reason || null, pending: !!noteResult?.ok });

      const lower = String(trimmedPayload || '').toLowerCase();
      const status = lower === 'offline' ? 'offline' : 'online';
      touchRegistry(dbApi, deviceId, status, ts);
      if (status === 'online' && typeof solarAuto?.notifyDeviceReconnect === 'function') {
        solarAuto.notifyDeviceReconnect(deviceId);
      }
      mqttDebug('registry_touch', { deviceId, status, retained, from: 'status_topic' });

      persistEvent(dbApi, deviceId, msgTopic, payload, ts);
      emit("mqtt", { topic: msgTopic, deviceId, group: 'meta', key: 'status', payload });
      return;
    }

    if (msgType === 'esphome_state') {
      const { deviceId, group, key, diagKey, isIdentityDiag } = classification;
      const known = typeof dbApi.findEspHomeRegistry === 'function' ? dbApi.findEspHomeRegistry(deviceId) : null;
      if (!known) {
        if (classification.looksInteresting) mqttDebug('standard_topic_registry_miss', { deviceId, topic: msgTopic, retained });
        if (retained) {
          if (!missedRetained.has(deviceId)) missedRetained.set(deviceId, new Set());
          missedRetained.get(deviceId).add(msgTopic);
        }
        return;
      }

      mqttDebug('standard_topic_registry_hit', { deviceId, topic: msgTopic, retained, registry_id: known?.id || null, board_profile_id: known?.board_profile_id || null, mqtt_topic_root: known?.mqtt_topic_root || null });

      // Skip native sensor topics for custom MQTT devices (state comes through elaris/...)
      if (known?.mqtt_topic_root && !isIdentityDiag) {
        const component = parts[1];
        if (component === 'sensor') {
          mqttDebug('native_topic_skipped', { deviceId, topic: msgTopic, reason: 'has_custom_mqtt' });
          return;
        }
        if (component === 'switch' || component === 'binary_sensor') {
          mqttDebug('native_topic_state_only', { deviceId, topic: msgTopic, reason: 'managed_device_config_discovery' });
          // Fall through — state cache / registry touch / emit still run, but skip pending discovery
        }
      }

      // Identity sensor dispatch
      if (diagKey && isIdentityDiag) {
        const dispatchEntry = IDENTITY_DISPATCH.find(d => d.match(diagKey));
        if (dispatchEntry && typeof dbApi.updateEspHomeIdentity === 'function') {
          const purgeInfo = dispatchEntry.handle(dbApi, deviceId, trimmedPayload, ts);
          if (dispatchEntry.field === 'mac_address') {
            cleanupRetainedTopics(client, deviceId, purgeInfo);
          }
          mqttDebug('identity_update', { deviceId, field: dispatchEntry.field, value: trimmedPayload, purged: purgeInfo?.purged?.map(x => x.device_id) || [] });
          persistEvent(dbApi, deviceId, msgTopic, payload, ts);
          emit("mqtt", { topic: msgTopic, deviceId, group: 'meta', key: dispatchEntry.metaKey, payload });
          return;
        }
      }

      const skipPendingDiscovery = !!(known?.mqtt_topic_root);

      if (!trimmedPayload) {
        persistEvent(dbApi, deviceId, msgTopic, payload, ts);
        emit("mqtt_ignored", { topic: msgTopic, deviceId, group, key: `${group}.${key}`, reason: 'empty_payload' });
        return;
      }

      if (!skipPendingDiscovery) {
        const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts, retained, allowRetained: true });
        mqttDebug('standard_state_processed', { deviceId, group, key, retained, result: noteResult?.reason || null, pending: !!noteResult?.ok });
      }

      touchRegistry(dbApi, deviceId, 'online', ts);
      mqttDebug('registry_touch', { deviceId, status: 'online', retained, from: 'standard_state' });

      cacheState(dbApi, deviceId, `${group}.${key}`, payload, ts);
      mqttDebug('state_cache_upsert', { deviceId, state_key: `${group}.${key}`, retained, from: 'standard' });

      persistEvent(dbApi, deviceId, msgTopic, payload, ts);
      triggerSolar(solarAuto, deviceId, `${group}.${key}`);
      emit("mqtt", { topic: msgTopic, deviceId, group, key: `${group}.${key}`, payload });
      return;
    }

    // Unknown message type — silently ignore
  });

  // ── Public API ────────────────────────────────────────────────────────────

  function sendCommand(deviceId, key, value) {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    const topicCmnd = elarisCommandTopic(deviceId, key);
    client.publish(topicCmnd, payload, { qos: 0, retain: false });
    emit("command_sent", { deviceId, key, value: payload, topic: topicCmnd });
    console.log("[MQTT] publish", topicCmnd, payload);
    return { topic: topicCmnd, payload };
  }

  function getMissedRetained() {
    const result = [];
    for (const [deviceId, topics] of missedRetained) {
      result.push({ deviceId, topics: Array.from(topics) });
    }
    return result;
  }

  function clearMissedRetainedForDevice(deviceId) {
    const topics = missedRetained.has(deviceId) ? Array.from(missedRetained.get(deviceId)) : [];
    missedRetained.delete(deviceId);
    return topics;
  }

  return { client, sendCommand, getMissedRetained, clearMissedRetainedForDevice };
}

module.exports = { initMQTT };
