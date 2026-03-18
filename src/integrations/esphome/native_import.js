'use strict';

const { safeName, normalizeIntegrationKey, normalizeOwnershipMode, normalizeConfigSource, normalizeReadOnly } = require('../../esphome/schema');

function toIsoNow() {
  return new Date().toISOString();
}

function parseSiteId(value) {
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizePort(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : (fallback || 6053);
}

function guessEntityClass(raw) {
  var txt = String(raw == null ? '' : raw).trim().toUpperCase();
  if (['DO', 'RELAY', 'OUTPUT', 'SWITCH'].includes(txt)) return 'DO';
  if (['DI', 'INPUT', 'BINARY_SENSOR'].includes(txt)) return 'DI';
  if (['AI', 'ANALOG', 'SENSOR'].includes(txt)) return 'AI';
  if (['AO', 'ANALOG_OUTPUT', 'DIMMER'].includes(txt)) return 'AO';
  return '';
}

function inferGroup(entityClass, explicit) {
  var raw = String(explicit || '').trim().toLowerCase();
  if (raw === 'state' || raw === 'tele') return raw;
  return entityClass === 'DO' || entityClass === 'AO' ? 'state' : 'tele';
}

function inferType(entityClass, explicit) {
  var raw = String(explicit || '').trim().toLowerCase();
  if (raw) return raw;
  if (entityClass === 'DO') return 'relay';
  if (entityClass === 'AO') return 'ao';
  return 'sensor';
}

function normalizeNativeEntity(row, index) {
  var name = String(row && (row.name || row.label) || '').trim();
  var key = safeName(row && (row.key || row.object_id || row.id || name || ('entity_' + (index + 1)))) || ('entity_' + (index + 1));
  var entityClass = guessEntityClass(row && (row.entity_class || row.class || row.kind || row.type));
  var source = String(row && (row.source || row.port_id || row.bus_id || row.pin || row.address || '') || '').trim();
  var group = inferGroup(entityClass, row && row.group);
  var type = inferType(entityClass, row && row.type);
  var portId = String(row && row.port_id || '').trim() || null;
  var busId = String(row && row.bus_id || '').trim() || null;
  return {
    key: key,
    name: name || key,
    entity_class: entityClass || (type === 'relay' ? 'DO' : 'AI'),
    group: group,
    type: type,
    source: source || null,
    port_id: portId,
    bus_id: busId,
    unit: row && row.unit != null ? String(row.unit) : null,
    device_class: row && row.device_class != null ? String(row.device_class) : null,
    metadata: row && row.metadata != null ? row.metadata : null,
  };
}

function normalizeNativeImportPayload(body) {
  var payload = body || {};
  var entitiesIn = Array.isArray(payload.entities) ? payload.entities : [];
  var entities = entitiesIn.map(normalizeNativeEntity).filter(function(e) { return !!e.key; });
  var integrationKey = normalizeIntegrationKey(payload.integration_key || 'esphome');
  var ownershipMode = normalizeOwnershipMode(payload.ownership_mode || 'external_native');
  var configSource = normalizeConfigSource(payload.config_source || 'native_api');
  var readOnly = normalizeReadOnly(payload.read_only == null ? 1 : payload.read_only, ownershipMode);
  return {
    site_id: parseSiteId(payload.site_id),
    device_name: String(payload.device_name || '').trim(),
    friendly_name: String(payload.friendly_name || payload.device_name || '').trim(),
    board_profile_id: String(payload.board_profile_id || '').trim() || 'external_native_generic',
    ip_address: String(payload.ip_address || payload.host || '').trim(),
    hostname: String(payload.hostname || '').trim(),
    api_host: String(payload.api_host || payload.ip_address || payload.host || '').trim(),
    api_port: normalizePort(payload.api_port, 6053),
    encryption_key: String(payload.encryption_key || payload.api_encryption_key || '').trim(),
    mqtt_topic_root: String(payload.mqtt_topic_root || '').trim(),
    integration_key: integrationKey,
    ownership_mode: ownershipMode,
    config_source: configSource,
    read_only: readOnly,
    entities: entities,
    source_meta: {
      import_mode: 'external_native_step1',
      adapter: integrationKey,
      native_api: {
        host: String(payload.api_host || payload.ip_address || payload.host || '').trim() || null,
        port: normalizePort(payload.api_port, 6053),
        encryption_key_present: !!String(payload.encryption_key || payload.api_encryption_key || '').trim(),
      },
      imported_at: toIsoNow(),
      entity_count: entities.length,
    },
  };
}

function findExistingDevice(db, payload) {
  if (!db) return null;
  var byName = payload.device_name ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND lower(name)=lower(?) ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.device_name) : null;
  if (byName) return byName;
  var byIp = payload.ip_address ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND ip_address=? ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.ip_address) : null;
  if (byIp) return byIp;
  var byHost = payload.hostname ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND hostname=? ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.hostname) : null;
  if (byHost) return byHost;
  return null;
}

function importNativeDeviceStep1(db, rawBody) {
  if (!db) throw new Error('no_db');
  var payload = normalizeNativeImportPayload(rawBody);
  if (!payload.device_name) throw new Error('missing_device_name');
  if (!payload.entities.length) throw new Error('missing_entities');
  var nowIso = toIsoNow();
  var nowTs = Date.now();
  var existing = findExistingDevice(db, payload);
  var upsertPending = db.prepare(`
    INSERT INTO pending_io(device_id, key, group_name, first_seen, last_seen, last_value, site_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, group_name, key) DO UPDATE SET
      last_seen=excluded.last_seen,
      last_value=excluded.last_value,
      site_id=excluded.site_id
  `);
  var isBlocked = db.prepare(`SELECT 1 FROM blocked_io WHERE device_id=? AND group_name=? AND key=? LIMIT 1`);
  var ensureDeviceSite = db.prepare(`INSERT INTO device_site(device_id, site_id, assigned_ts) VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET site_id=excluded.site_id, assigned_ts=excluded.assigned_ts`);
  var insDevice = db.prepare(`
    INSERT INTO esphome_devices (
      site_id, name, friendly_name, board_profile_id, chip, framework, transport, network_mode, status,
      serial_port, mac_address, ip_address, hostname, mqtt_topic_root, firmware_version, yaml_path, yaml_hash,
      last_validation_json, integration_key, ownership_mode, config_source, read_only,
      last_seen_at, created_at, updated_at, deleted_at, deleted_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);
  var updDevice = db.prepare(`
    UPDATE esphome_devices SET
      site_id=?, name=?, friendly_name=?, board_profile_id=?, chip=?, framework=?, transport=?, network_mode=?, status=?,
      serial_port=?, mac_address=?, ip_address=?, hostname=?, mqtt_topic_root=?, firmware_version=?, yaml_path=?, yaml_hash=?,
      last_validation_json=?, integration_key=?, ownership_mode=?, config_source=?, read_only=?,
      last_seen_at=?, updated_at=?, deleted_at=NULL, deleted_reason=NULL
    WHERE id=?
  `);

  var result = { ok: true, created: false, updated: false, device_id: payload.device_name, esphome_device_id: null, pending_injected: 0, blocked_skipped: 0, imported_entities: payload.entities.length };

  db.transaction(function() {
    var validationJson = JSON.stringify({
      ok: true,
      mode: 'external_native_step1',
      source_meta: payload.source_meta,
      entities: payload.entities,
    });

    if (existing) {
      updDevice.run(
        payload.site_id,
        payload.device_name,
        payload.friendly_name || payload.device_name,
        payload.board_profile_id,
        existing.chip || null,
        existing.framework || null,
        existing.transport || 'native_api',
        existing.network_mode || (payload.ip_address ? 'wifi' : null),
        'imported',
        existing.serial_port || null,
        existing.mac_address || null,
        payload.ip_address || null,
        payload.hostname || safeName(payload.device_name),
        payload.mqtt_topic_root || existing.mqtt_topic_root || null,
        existing.firmware_version || null,
        existing.yaml_path || null,
        existing.yaml_hash || null,
        validationJson,
        payload.integration_key,
        payload.ownership_mode,
        payload.config_source,
        payload.read_only,
        nowIso,
        nowIso,
        existing.id
      );
      result.esphome_device_id = existing.id;
      result.updated = true;
    } else {
      var ins = insDevice.run(
        payload.site_id,
        payload.device_name,
        payload.friendly_name || payload.device_name,
        payload.board_profile_id,
        null,
        null,
        'native_api',
        payload.ip_address ? 'wifi' : null,
        'imported',
        null,
        null,
        payload.ip_address || null,
        payload.hostname || safeName(payload.device_name),
        payload.mqtt_topic_root || null,
        null,
        null,
        null,
        validationJson,
        payload.integration_key,
        payload.ownership_mode,
        payload.config_source,
        payload.read_only,
        nowIso,
        nowIso,
        nowIso
      );
      result.esphome_device_id = Number(ins.lastInsertRowid || 0) || null;
      result.created = true;
    }

    ensureDeviceSite.run(payload.device_name, payload.site_id, nowTs);

    payload.entities.forEach(function(entity) {
      if (isBlocked.get(payload.device_name, entity.group, entity.key)) {
        result.blocked_skipped += 1;
        return;
      }
      var sourceMeta = {
        entity_class: entity.entity_class,
        source: entity.source || null,
        port_id: entity.port_id || null,
        bus_id: entity.bus_id || null,
        unit: entity.unit || null,
        device_class: entity.device_class || null,
        metadata: entity.metadata || null,
      };
      upsertPending.run(payload.device_name, entity.key, entity.group, nowTs, nowTs, JSON.stringify(sourceMeta), payload.site_id);
      result.pending_injected += 1;
    });
  })();

  return result;
}

module.exports = {
  normalizeNativeImportPayload,
  normalizeNativeEntity,
  importNativeDeviceStep1,
};
