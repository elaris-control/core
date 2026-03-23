'use strict';

const net = require('net');
const { safeName } = require('../../esphome/schema');
const { getCatalogProfile } = require('../../esphome/profile_registry');
const { deriveBoardPorts } = require('../../esphome/board_port_registry');
const { importNativeDeviceStep1 } = require('./native_import');

function toIsoNow() {
  return new Date().toISOString();
}

function parseSiteId(value, fallback) {
  var n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Math.trunc(Number(fallback)) : 1;
}

function normalizePort(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : (fallback || 6053);
}

function normalizeHost(payload) {
  return String(payload.api_host || payload.ip_address || payload.host || payload.hostname || '').trim();
}

function readJsonSafe(value, fallback) {
  try { return value ? JSON.parse(value) : (fallback == null ? null : fallback); }
  catch (_) { return fallback == null ? null : fallback; }
}

function findDeviceByIdentity(db, payload) {
  if (!db) return null;
  var byId = payload.device_id ? db.prepare('SELECT * FROM esphome_devices WHERE id=? LIMIT 1').get(Number(payload.device_id)) : null;
  if (byId) return byId;
  var byName = payload.device_name ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND lower(name)=lower(?) ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.device_name) : null;
  if (byName) return byName;
  var byIp = payload.ip_address ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND ip_address=? ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.ip_address) : null;
  if (byIp) return byIp;
  var byHost = payload.hostname ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND hostname=? ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.hostname) : null;
  if (byHost) return byHost;
  var byApiHost = payload.api_host ? db.prepare(`SELECT * FROM esphome_devices WHERE deleted_at IS NULL AND (hostname=? OR ip_address=?) ORDER BY updated_at DESC, id DESC LIMIT 1`).get(payload.api_host, payload.api_host) : null;
  if (byApiHost) return byApiHost;
  return null;
}

function buildNativeRuntimePayload(db, rawBody) {
  var body = rawBody || {};
  var existing = findDeviceByIdentity(db, body) || null;
  var siteId = parseSiteId(body.site_id, existing && existing.site_id);
  var deviceName = String(body.device_name || existing?.name || '').trim();
  var friendlyName = String(body.friendly_name || existing?.friendly_name || deviceName).trim();
  var boardProfileId = String(body.board_profile_id || existing?.board_profile_id || '').trim();
  var ipAddress = String(body.ip_address || existing?.ip_address || '').trim();
  var hostname = String(body.hostname || existing?.hostname || '').trim();
  var apiHost = String(body.api_host || ipAddress || hostname || '').trim();
  var apiPort = normalizePort(body.api_port, existing && existing.transport === 'native_api' ? 6053 : 6053);
  var encryptionKey = String(body.encryption_key || existing?.encryption_key || '').trim();
  return {
    existing: existing,
    site_id: siteId,
    device_id: existing?.id || (body.device_id ? Number(body.device_id) : null),
    device_name: deviceName,
    friendly_name: friendlyName || deviceName,
    board_profile_id: boardProfileId,
    ip_address: ipAddress,
    hostname: hostname,
    api_host: apiHost,
    api_port: apiPort,
    encryption_key: encryptionKey,
    mqtt_topic_root: String(body.mqtt_topic_root || existing?.mqtt_topic_root || '').trim(),
  };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    var started = Date.now();
    var settled = false;
    if (!host) return resolve({ ok: false, reachable: false, error: 'missing_host', latency_ms: null });
    var socket = new net.Socket();
    function finish(out) {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(out);
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', function() {
      finish({ ok: true, reachable: true, latency_ms: Date.now() - started, remote_family: socket.remoteFamily || null });
    });
    socket.once('timeout', function() {
      finish({ ok: false, reachable: false, error: 'timeout', latency_ms: Date.now() - started });
    });
    socket.once('error', function(err) {
      finish({ ok: false, reachable: false, error: String(err && err.code || err && err.message || 'connect_error'), latency_ms: Date.now() - started });
    });
    try { socket.connect(port, host); }
    catch (err) { finish({ ok: false, reachable: false, error: String(err && err.message || err), latency_ms: Date.now() - started }); }
  });
}

function makeEntityClassFromPort(port) {
  var group = String(port?.group || '').trim().toLowerCase();
  if (group === 'do') return 'DO';
  if (group === 'di') return 'DI';
  if (group === 'ao') return 'AO';
  return 'AI';
}

function makeEntityTypeFromPort(port) {
  var group = String(port?.group || '').trim().toLowerCase();
  if (group === 'do') return 'relay';
  if (group === 'ao') return 'ao';
  if (group === 'ht' || group === 'onewire') {
    if ((port.supports || []).includes('dht11')) return 'dht11';
    if ((port.supports || []).includes('dht')) return 'dht';
    return 'ds18b20';
  }
  if (group === 'ai') return 'analog';
  return 'sensor';
}

function makeGroupFromClass(entityClass) {
  return entityClass === 'DO' || entityClass === 'AO' ? 'state' : 'tele';
}

function normalizeEntityRow(row, index) {
  var key = safeName(row && (row.key || row.object_id || row.id || row.name || ('entity_' + (index + 1)))) || ('entity_' + (index + 1));
  var source = String(row && (row.source || row.port_id || row.bus_id || row.pin || '') || '').trim() || null;
  var entityClass = String(row && (row.entity_class || row.class || row.kind || '') || '').trim().toUpperCase() || 'AI';
  var out = {
    key: key,
    name: String(row && (row.name || row.label || key) || key).trim() || key,
    entity_class: entityClass,
    group: String(row && row.group || makeGroupFromClass(entityClass)).trim().toLowerCase(),
    type: String(row && row.type || '').trim().toLowerCase() || (entityClass === 'DO' ? 'relay' : (entityClass === 'AO' ? 'ao' : 'sensor')),
    source: source,
    port_id: String(row && row.port_id || source || '').trim() || null,
    bus_id: String(row && row.bus_id || '').trim() || null,
    unit: row && row.unit != null ? String(row.unit) : null,
    device_class: row && row.device_class != null ? String(row.device_class) : null,
    metadata: row && row.metadata != null ? row.metadata : null,
  };
  return out;
}

function collectStoredEntities(device) {
  var parsed = readJsonSafe(device && device.last_validation_json, {}) || {};
  var base = Array.isArray(parsed.entities) ? parsed.entities : [];
  var nativeRuntime = parsed && parsed.native_runtime && typeof parsed.native_runtime === 'object' ? parsed.native_runtime : {};
  var streamed = Array.isArray(nativeRuntime.last_native_entities) ? nativeRuntime.last_native_entities : [];
  var merged = base.concat(streamed);
  return merged.map(normalizeEntityRow).filter(function(row) { return !!row.key; });
}

function buildEntitiesFromProfile(db, profileId) {
  var profile = profileId ? getCatalogProfile(db, profileId) : null;
  if (!profile) return [];
  var runtime = deriveBoardPorts(profile || {});
  return (runtime.ports || []).map(function(port, index) {
    var entityClass = makeEntityClassFromPort(port);
    var label = String(port.label || port.id || ('Port ' + (index + 1))).trim();
    var key = safeName(port.id || port.label || ('port_' + (index + 1))) || ('port_' + (index + 1));
    return normalizeEntityRow({
      key: key,
      name: label,
      entity_class: entityClass,
      group: makeGroupFromClass(entityClass),
      type: makeEntityTypeFromPort(port),
      source: String(port.id || port.label || '').trim() || null,
      port_id: String(port.id || port.label || '').trim() || null,
      metadata: {
        discovered_from: 'board_profile_assist',
        port_group: port.group || null,
        supports: port.supports || [],
        pin: port.pin || null,
      },
    }, index);
  });
}

function mergeEntities(stored, assisted) {
  var map = new Map();
  function add(row, sourceTag) {
    if (!row) return;
    var normalized = normalizeEntityRow(row);
    var identity = [String(normalized.port_id || '').trim().toUpperCase(), String(normalized.bus_id || '').trim().toUpperCase(), String(normalized.source || '').trim().toUpperCase(), String(normalized.key || '').trim().toUpperCase()].filter(Boolean)[0];
    if (!identity) return;
    if (!map.has(identity)) {
      map.set(identity, { ...normalized, metadata: { ...(normalized.metadata || {}), merge_source: sourceTag } });
      return;
    }
    var prev = map.get(identity);
    map.set(identity, {
      ...normalized,
      ...prev,
      key: prev.key || normalized.key,
      name: prev.name || normalized.name,
      entity_class: prev.entity_class || normalized.entity_class,
      group: prev.group || normalized.group,
      type: prev.type || normalized.type,
      source: prev.source || normalized.source,
      port_id: prev.port_id || normalized.port_id,
      bus_id: prev.bus_id || normalized.bus_id,
      metadata: { ...(normalized.metadata || {}), ...(prev.metadata || {}), merge_source: sourceTag + '+merged' },
    });
  }
  (stored || []).forEach(function(row) { add(row, 'stored'); });
  (assisted || []).forEach(function(row) { add(row, 'assisted'); });
  return Array.from(map.values());
}

function mergeProbeIntoValidation(device, probe) {
  var parsed = readJsonSafe(device && device.last_validation_json, {}) || {};
  parsed.native_runtime = {
    ...(parsed.native_runtime || {}),
    last_probe_at: toIsoNow(),
    last_probe: probe,
  };
  return JSON.stringify(parsed);
}

async function probeNativeDevice(db, rawBody) {
  var payload = buildNativeRuntimePayload(db, rawBody);
  if (!payload.api_host) throw new Error('missing_api_host');
  var timeoutMs = Math.min(Math.max(Number(rawBody && rawBody.timeout_ms || 2500), 500), 15000);
  var probe = await tcpProbe(payload.api_host, payload.api_port, timeoutMs);
  probe.host = payload.api_host;
  probe.port = payload.api_port;
  probe.timeout_ms = timeoutMs;
  probe.protocol_hint = payload.encryption_key ? 'noise_expected' : 'plaintext_or_noise_unknown';

  if (db && payload.existing) {
    var now = toIsoNow();
    var nextStatus = probe.reachable ? 'online' : (String(payload.existing.status || '').trim() || 'imported');
    db.prepare(`UPDATE esphome_devices
      SET ip_address=COALESCE(?, ip_address), hostname=COALESCE(?, hostname), status=?, last_seen_at=?, last_validation_json=?, updated_at=?
      WHERE id=?`).run(
      payload.ip_address || null,
      payload.hostname || null,
      nextStatus,
      probe.reachable ? now : payload.existing.last_seen_at,
      mergeProbeIntoValidation(payload.existing, probe),
      now,
      payload.existing.id
    );
  }

  return {
    ok: !!probe.reachable,
    reachable: !!probe.reachable,
    device_id: payload.device_name || payload.existing?.name || null,
    esphome_device_id: payload.existing?.id || null,
    probe: probe,
  };
}

function discoverNativeAssist(db, rawBody, opts) {
  var profileAssist = !(opts && opts.profileAssist === false);
  var payload = buildNativeRuntimePayload(db, rawBody);
  var existing = payload.existing;
  var profileId = String(payload.board_profile_id || existing?.board_profile_id || '').trim();
  var nativeSession = rawBody && rawBody.native_session && typeof rawBody.native_session === 'object' ? rawBody.native_session : null;
  var live = Array.isArray(nativeSession && nativeSession.entities) ? nativeSession.entities.map(normalizeEntityRow).filter(function(row) { return !!row.key; }) : [];
  var stored = collectStoredEntities(existing);
  var assisted = profileAssist ? buildEntitiesFromProfile(db, profileId) : [];
  var entities = mergeEntities(live.concat(stored), assisted);
  var discoveryMode = live.length ? 'live_session' : (stored.length ? 'stored_only' : (assisted.length ? 'profile_assist' : 'none'));
  return {
    ok: true,
    device_id: payload.device_name || existing?.name || (nativeSession && nativeSession.device_name) || null,
    esphome_device_id: existing?.id || null,
    board_profile_id: profileId || (nativeSession && nativeSession.board_profile_id) || null,
    discovery_mode: discoveryMode,
    live_count: live.length,
    stored_count: stored.length,
    assisted_count: assisted.length,
    entity_count: entities.length,
    entities: entities,
    warnings: entities.length ? [] : [
      profileAssist
        ? 'No live native session entities, stored native entities, or board-profile-assisted ports were available.'
        : 'No native entities found for this device. Connect via native session first, then try again.',
    ],
  };
}

function syncNativeAssist(db, rawBody) {
  if (!db) throw new Error('no_db');
  var payload = buildNativeRuntimePayload(db, rawBody);
  var existing = payload.existing;
  if (!existing && !payload.device_name) throw new Error('missing_device_name');
  var discovered = discoverNativeAssist(db, rawBody);
  if (!discovered.entities.length) throw new Error('native_discovery_empty');
  return importNativeDeviceStep1(db, {
    site_id: payload.site_id,
    device_name: payload.device_name || existing?.name,
    friendly_name: payload.friendly_name || existing?.friendly_name || payload.device_name || existing?.name,
    board_profile_id: payload.board_profile_id || existing?.board_profile_id || 'external_native_generic',
    ip_address: payload.ip_address || existing?.ip_address || '',
    hostname: payload.hostname || existing?.hostname || '',
    api_host: payload.api_host || existing?.ip_address || existing?.hostname || '',
    api_port: payload.api_port || 6053,
    encryption_key: payload.encryption_key || '',
    mqtt_topic_root: payload.mqtt_topic_root || existing?.mqtt_topic_root || '',
    ownership_mode: rawBody && Object.prototype.hasOwnProperty.call(rawBody, 'ownership_mode') ? rawBody.ownership_mode : (existing?.ownership_mode || 'external_native'),
    config_source: rawBody && Object.prototype.hasOwnProperty.call(rawBody, 'config_source') ? rawBody.config_source : (existing?.config_source || 'native_api'),
    read_only: rawBody && Object.prototype.hasOwnProperty.call(rawBody, 'read_only') ? rawBody.read_only : (existing ? Number(existing.read_only || 0) : 1),
    entities: discovered.entities,
  });
}

module.exports = {
  buildNativeRuntimePayload,
  probeNativeDevice,
  discoverNativeAssist,
  syncNativeAssist,
};
