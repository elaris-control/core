// src/mqtt.js
const mqtt = require("mqtt");

function initMQTT({ url = "mqtt://localhost:1883", dbApi, broadcast, solarAuto = null }) {
  const client = mqtt.connect(url);

  function emit(type, payload) {
    try { broadcast({ type, ts: Date.now(), ...payload }); } catch (_) {}
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
    emit("mqtt_status", { status: "connected" });
  });

  client.on("reconnect", () => emit("mqtt_status", { status: "reconnecting" }));
  client.on("close", () => emit("mqtt_status", { status: "disconnected" }));
  client.on("offline", () => emit("mqtt_status", { status: "offline" }));
  client.on("error", (e) => emit("mqtt_status", { status: "error", error: String(e?.message || e) }));

  client.on("message", (topic, payloadBuf) => {
    const payload = payloadBuf.toString("utf8");
    const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';
    const ts = Date.now();

    const parts = topic.split("/");

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
          dbApi.noteDeviceConfig({ deviceId, config: cfg, ts });
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

      dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts });

      if (group === "tele" || group === "state") {
        dbApi.upsertState.run({
          device_id: deviceId,
          key: `${group}.${key}`,
          value: payload,
          ts,
        });
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
    if (!known) return;

    if (parts.length === 2 && parts[1] === 'status') {
      dbApi.noteDeviceAndMaybePendingIO({ deviceId, group: 'meta', key: 'status', value: payload, ts });
      dbApi.insertEvent.run({ device_id: deviceId, topic, payload, ts });
      emit("mqtt", { topic, deviceId, group: 'meta', key: 'status', payload });
      return;
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

    dbApi.noteDeviceAndMaybePendingIO({ deviceId, group, key, value: payload, ts });
    dbApi.upsertState.run({ device_id: deviceId, key: `${group}.${key}`, value: payload, ts });
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

  return { client, sendCommand };
}

module.exports = { initMQTT };
