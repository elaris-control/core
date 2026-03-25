// src/mqtt.js
const mqtt = require("mqtt");

function initMQTT({ url = "mqtt://localhost:1883", dbApi, broadcast, solarAuto = null }) {
  const client = mqtt.connect(url);

  // In-memory map of retained topics from devices not in ELARIS registry
  // deviceId → Set<topic>
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
    try { broadcast({ type, ts: Date.now(), ...withSiteScope(payload) }); } catch (_) {}
  }

  client.on("connect", () => {
    // ELARIS custom topics
    client.subscribe("elaris/+/config");
    client.subscribe("elaris/+/tele/+");
    client.subscribe("elaris/+/state/+");
    client.subscribe("elaris/+/cmnd/+");

    // Standard ESPHome MQTT topics for already-registered devices
    client.subscribe("+/status");
    client.subscribe("+/switch/+/state");
    client.subscribe("+/binary_sensor/+/state");
    client.subscribe("+/sensor/+/state");
    client.subscribe("+/text_sensor/+/state");

    console.log("[MQTT] connected & subscribed");
    mqttDebug('subscriptions_ready', {
      custom: ['elaris/+/config','elaris/+/tele/+','elaris/+/state/+','elaris/+/cmnd/+'],
      standard: ['+/status','+/switch/+/state','+/binary_sensor/+/state','+/sensor/+/state','+/text_sensor/+/state']
    });
    emit("mqtt_status", { status: "connected" });
  });

  client.on("reconnect", () => emit("mqtt_status", { status: "reconnecting" }));
  client.on("close", () => emit("mqtt_status", { status: "disconnected" }));
  client.on("offline", () => emit("mqtt_status", { status: "offline" }));
  client.on("error", (e) => emit("mqtt_status", { status: "error", error: String(e?.message || e) }));

  client.on("message", (topic, payloadBuf, packet = {}) => {
    const payload = payloadBuf.toString("utf8");
    const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';
    const ts = Date.now();
    const retained = !!packet?.retain;

    const parts = topic.split("/");
    const looksInteresting = (
      parts[0] === 'elaris' ||
      (parts.length === 2 && parts[1] === 'status') ||
      (parts.length === 4 && ['switch','binary_sensor','sensor','text_sensor'].includes(parts[1]) && parts[3] === 'state')
    );
    if (looksInteresting) {
      mqttDebug('rx', { topic, retained, payload: String(trimmedPayload || payload || '').slice(0, 180) });
    }

    // ELARIS custom topics: elaris/<device>/<group>/<key>
    if (parts[0] === 'elaris') {
      const deviceId = parts[1] || "unknown";
      const group = parts[2] || "unknown";
      const key = parts[3] || "unknown";

      if (group === "config") {
        const body = String(payload || "").trim();
        if (!body) {
          // Ignore retained-delete / empty config messages.
          dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
          emit("mqtt_config_ignored", { deviceId, topic, reason: 'empty_payload' });
          return;
        }
        try {
          const cfg = JSON.parse(body);
          dbApi.noteDeviceConfig({ deviceId, config: cfg, ts, retained });
          emit("mqtt_config", { deviceId, topic });
        } catch (e) {
          emit("mqtt_config_error", { deviceId, topic, error: String(e?.message || e) });
        }

        dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
        return;
      }

      if ((group === 'tele' || group === 'state') && !trimmedPayload) {
        // Ignore retained-delete / empty state messages so deleted legacy topics
        // do not recreate pending IO rows.
        dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
        emit("mqtt_ignored", { topic, deviceId, group, key: `${group}.${key}`, reason: 'empty_payload' });
        return;
      }

      const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts, retained });
      mqttDebug('custom_topic_processed', { deviceId, group, key, retained, result: noteResult?.reason || null, pending: !!noteResult?.ok });

      if (group === "tele" || group === "state") {
        dbApi.upsertState.run({
          device_id: deviceId,
          key: `${group}.${key}`,
          value: payload,
          ts,
        });
        mqttDebug('state_cache_upsert', { deviceId, state_key: `${group}.${key}`, retained, from: 'custom' });
      }

      dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
      if ((group === "tele" || group === "state") && solarAuto) {
        solarAuto.onSensorUpdate(deviceId, `${group}.${key}`);
      }
      emit("mqtt", { topic, deviceId, group, key: `${group}.${key}`, payload });
      return;
    }

    // Standard ESPHome topics: <device>/status, <device>/switch/<key>/state, etc.
    const deviceId = parts[0] || 'unknown';
    const known = typeof dbApi.findEspHomeRegistry === 'function' ? dbApi.findEspHomeRegistry(deviceId) : null;
    if (!known) {
      if (looksInteresting) mqttDebug('standard_topic_registry_miss', { deviceId, topic, retained });
      if (retained) {
        if (!missedRetained.has(deviceId)) missedRetained.set(deviceId, new Set());
        missedRetained.get(deviceId).add(topic);
      }
      return;
    }
    mqttDebug('standard_topic_registry_hit', { deviceId, topic, retained, registry_id: known?.id || null, board_profile_id: known?.board_profile_id || null, mqtt_topic_root: known?.mqtt_topic_root || null });

    const diagKey = (parts.length === 4 && parts[3] === 'state') ? String(parts[2] || '').trim().toLowerCase() : '';
    const isIdentityDiag = !!diagKey && (
      /mac/.test(diagKey) || diagKey.endsWith('mac_address') ||
      diagKey === 'ip_address' || diagKey.endsWith('_ip') || diagKey.endsWith('_ip_address') ||
      diagKey === 'version' || diagKey === 'esphome_version' || diagKey === 'firmware_version'
    );

    // If device uses custom MQTT, keep custom sensor topics as primary source to avoid duplicates.
    // But DO/DI standard topics are still valuable fallback when the YAML does not mirror them
    // to custom ELARIS topics. Identity diagnostics must also always be kept.
    if (known?.mqtt_topic_root && parts.length === 4 && parts[3] === 'state' &&
        parts[1] === 'sensor' && !isIdentityDiag) {
      mqttDebug('native_topic_skipped', { deviceId, topic, reason: 'has_custom_mqtt' });
      return;
    }

    if (parts.length === 2 && parts[1] === 'status') {
      const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group: 'meta', key: 'status', value: payload, ts, retained, allowRetained: true });
      mqttDebug('status_processed', { deviceId, retained, payload: trimmedPayload || payload, result: noteResult?.reason || null, pending: !!noteResult?.ok });
      if (typeof dbApi.touchEspHomeRegistry === 'function') {
        const lower = String(trimmedPayload || '').toLowerCase();
        const status = lower === 'offline' ? 'offline' : 'online';
        dbApi.touchEspHomeRegistry(deviceId, { status, ts });
        mqttDebug('registry_touch', { deviceId, status, retained, from: 'status_topic' });
      }
      dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
      emit("mqtt", { topic, deviceId, group: 'meta', key: 'status', payload });
      return;
    }

    if (parts.length === 4 && (parts[1] === 'text_sensor' || parts[1] === 'sensor') && parts[3] === 'state') {
      if (diagKey) {
        if ((/mac/.test(diagKey) || diagKey.endsWith('mac_address')) && typeof dbApi.updateEspHomeIdentity === 'function') {
          dbApi.updateEspHomeIdentity(deviceId, { mac_address: trimmedPayload, ts });
          let purgeInfo = { ok: true, purged: [] };
          try {
            if (typeof dbApi.purgeEsphomeSameMacDuplicates === 'function') {
              purgeInfo = dbApi.purgeEsphomeSameMacDuplicates(deviceId, trimmedPayload) || purgeInfo;
            }
          } catch (_) {}
          if (Array.isArray(purgeInfo?.purged)) {
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
                const knownTopics = [
                  'ht_1','ht_2','ht_3','sht3x_temp','sht3x_hum','bh1750_lux',
                  'di_1','di_2','di_3','di_4','di_5','di_6','di_7','di_8','di_9','di_10','di_11','di_12','di_13','di_14','di_15','di_16',
                  'relay_1','relay_2','relay_3','relay_4','relay_5','relay_6','relay_7','relay_8','relay_9','relay_10','relay_11','relay_12','relay_13','relay_14','relay_15','relay_16'
                ];
                for (const k of knownTopics) {
                  const grp = k.startsWith('relay_') ? 'state' : 'tele';
                  try { client.publish(`elaris/${leaf}/${grp}/${k}`, '', { qos: 0, retain: true }); } catch (_) {}
                }
              }
            }
          }
          mqttDebug('identity_update', { deviceId, field: 'mac_address', value: trimmedPayload, purged_same_mac: purgeInfo?.purged?.map(x => x.device_id) || [] });
          dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
          emit("mqtt", { topic, deviceId, group: 'meta', key: 'mac_address', payload });
          return;
        }
        if ((diagKey === 'ip_address' || diagKey.endsWith('_ip') || diagKey.endsWith('_ip_address')) && typeof dbApi.updateEspHomeIdentity === 'function') {
          dbApi.updateEspHomeIdentity(deviceId, { ip_address: trimmedPayload, ts });
          mqttDebug('identity_update', { deviceId, field: 'ip_address', value: trimmedPayload });
          dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
          emit("mqtt", { topic, deviceId, group: 'meta', key: 'ip_address', payload });
          return;
        }
        if ((diagKey === 'version' || diagKey === 'esphome_version' || diagKey === 'firmware_version') && typeof dbApi.updateEspHomeIdentity === 'function') {
          dbApi.updateEspHomeIdentity(deviceId, { firmware_version: trimmedPayload, ts });
          mqttDebug('identity_update', { deviceId, field: 'firmware_version', value: trimmedPayload });
          dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
          emit("mqtt", { topic, deviceId, group: 'meta', key: 'firmware_version', payload });
          return;
        }
      }
    }

    let group = null;
    let key = null;
    if (parts.length === 4 && parts[1] === 'switch' && parts[3] === 'state') {
      group = 'state';
      key = parts[2];
    } else if (parts.length === 4 && parts[1] === 'binary_sensor' && parts[3] === 'state') {
      group = 'tele';
      key = parts[2];
    } else if (parts.length === 4 && (parts[1] === 'sensor' || parts[1] === 'text_sensor') && parts[3] === 'state') {
      group = 'tele';
      key = parts[2];
    }
    if (!group || !key) return;

    if (!trimmedPayload) {
      dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
      emit("mqtt_ignored", { topic, deviceId, group, key: `${group}.${key}`, reason: 'empty_payload' });
      return;
    }

    const noteResult = dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts, retained, allowRetained: true });
    mqttDebug('standard_state_processed', { deviceId, group, key, retained, result: noteResult?.reason || null, pending: !!noteResult?.ok });
    if (typeof dbApi.touchEspHomeRegistry === 'function') {
      dbApi.touchEspHomeRegistry(deviceId, { status: 'online', ts });
      mqttDebug('registry_touch', { deviceId, status: 'online', retained, from: 'standard_state' });
    }
    dbApi.upsertState.run({ device_id: deviceId, key: `${group}.${key}`, value: payload, ts });
    mqttDebug('state_cache_upsert', { deviceId, state_key: `${group}.${key}`, retained, from: 'standard' });
    dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
    if (solarAuto) solarAuto.onSensorUpdate(deviceId, `${group}.${key}`);
    emit("mqtt", { topic, deviceId, group, key: `${group}.${key}`, payload });
  });

  function sendCommand(deviceId, key, value) {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    const topicCmnd = `elaris/${deviceId}/cmnd/${key}`;
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
