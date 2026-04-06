'use strict';

const { buildNativeRuntimePayload, probeNativeDevice, discoverNativeAssist } = require('./native_live');
const { safeName } = require('../../esphome/schema');

let modulePromise = null;

function toIsoNow() {
  return new Date().toISOString();
}

function readJsonSafe(value, fallback) {
  try { return value ? JSON.parse(value) : (fallback == null ? null : fallback); }
  catch (_) { return fallback == null ? null : fallback; }
}

async function loadEspHomeClientModule() {
  if (!modulePromise) {
    modulePromise = import('esphome-client').catch(function(err) {
      var wrapped = new Error('esphome_client_dependency_missing');
      wrapped.cause = err;
      throw wrapped;
    });
  }
  return modulePromise;
}

function normalizeType(raw, entity) {
  var txt = String(raw || entity?.type || entity?.entityType || entity?.constructor?.name || '').trim().toLowerCase();
  if (txt === 'binarysensor') return 'binary_sensor';
  if (txt === 'textsensor') return 'text_sensor';
  if (txt === 'mediaplayer') return 'media_player';
  if (txt === 'alarmcontrolpanel') return 'alarm_control_panel';
  return txt;
}

function inferEntityClass(type, entity) {
  var t = String(type || '').trim().toLowerCase();
  if (t === 'switch' || t === 'button' || t === 'lock' || t === 'siren' || t === 'valve') return 'DO';
  if (t === 'light' || t === 'number' || t === 'fan' || t === 'cover' || t === 'climate' || t === 'select' || t === 'media_player') return 'AO';
  if (t === 'binary_sensor') return 'DI';
  if (t === 'sensor' || t === 'text_sensor' || t === 'update' || t === 'event') return 'AI';
  if (entity?.deviceClass === 'temperature' || entity?.deviceClass === 'humidity') return 'AI';
  return 'AI';
}

function inferEntityGroup(entityClass) {
  return entityClass === 'DO' || entityClass === 'AO' ? 'state' : 'tele';
}

function inferEntityKey(entity, index) {
  return safeName(entity?.objectId || entity?.key || entity?.entity || entity?.name || entity?.id || ('entity_' + (index + 1))) || ('entity_' + (index + 1));
}

function normalizeEntity(entity, index) {
  var type = normalizeType(null, entity);
  var key = inferEntityKey(entity, index);
  var entityClass = inferEntityClass(type, entity);
  var entityId = String(entity?.entity || entity?.entityId || entity?.id || (type ? (type + '-' + key) : key)).trim() || key;
  return {
    key: key,
    object_id: key,
    entity_id: entityId,
    name: String(entity?.name || key).trim() || key,
    entity_type: type || 'sensor',
    entity_class: entityClass,
    group: inferEntityGroup(entityClass),
    type: type || 'sensor',
    source: entityId,
    port_id: null,
    bus_id: null,
    unit: entity?.unitOfMeasurement != null ? String(entity.unitOfMeasurement) : (entity?.unit != null ? String(entity.unit) : null),
    device_class: entity?.deviceClass != null ? String(entity.deviceClass) : null,
    metadata: {
      discovered_from: 'native_stream',
      entity_category: entity?.entityCategory != null ? String(entity.entityCategory) : null,
      icon: entity?.icon != null ? String(entity.icon) : null,
      object_id: entity?.objectId != null ? String(entity.objectId) : null,
      raw_key: entity?.key != null ? String(entity.key) : null,
      state_class: entity?.stateClass != null ? String(entity.stateClass) : null,
      options: Array.isArray(entity?.options) ? entity.options.slice() : [],
      effects: Array.isArray(entity?.effects) ? entity.effects.slice() : [],
      color_modes: Array.isArray(entity?.supportedColorModes) ? entity.supportedColorModes.slice() : [],
      supports_brightness: entity?.supportsBrightness == null ? null : !!entity.supportsBrightness,
      supports_position: entity?.supportsPosition == null ? null : !!entity.supportsPosition,
      supports_tilt: entity?.supportsTilt == null ? null : !!entity.supportsTilt,
      raw_entity_id: entityId,
    },
  };
}

function normalizeDeviceInfo(info, runtime, encrypted) {
  if (!info || typeof info !== 'object') return null;
  return {
    name: info.name || runtime.device_name || null,
    friendly_name: runtime.friendly_name || info.friendlyName || info.name || runtime.device_name || null,
    mac_address: info.macAddress || info.mac || null,
    model: info.model || info.board || null,
    manufacturer: info.manufacturer || null,
    esphome_version: info.esphomeVersion || info.version || null,
    project_name: info.projectName || null,
    project_version: info.projectVersion || null,
    compilation_time: info.compilationTime || null,
    api_version: info.apiVersion || null,
    has_deep_sleep: info.hasDeepSleep == null ? null : !!info.hasDeepSleep,
    webserver_port: info.webserverPort == null ? null : info.webserverPort,
    encrypted: encrypted == null ? null : !!encrypted,
    host: runtime.api_host || runtime.ip_address || runtime.hostname || null,
    port: runtime.api_port || null,
  };
}

function flattenTelemetryState(data) {
  if (!data || typeof data !== 'object') return { raw: data };
  var out = {};
  Object.keys(data).forEach(function(key) {
    if (key === 'entity' || key === 'type' || key === 'metadata') return;
    var value = data[key];
    if (typeof value === 'function' || value === undefined) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).forEach(function(sub) {
        if (typeof value[sub] !== 'function') out[key + '_' + sub] = value[sub];
      });
      return;
    }
    out[key] = value;
  });
  return out;
}

function normalizeTelemetry(data, entitiesById) {
  var entityId = String(data?.entity || data?.entityId || data?.id || '').trim();
  var known = entityId ? entitiesById.get(entityId) : null;
  var type = normalizeType(data?.type || known?.entity_type, data);
  var objectId = safeName(data?.objectId || known?.object_id || entityId || '') || safeName(entityId) || safeName(type + '_state') || 'state';
  return {
    entity_id: entityId || known?.entity_id || objectId,
    entity_key: known?.key || objectId,
    entity_name: known?.name || entityId || objectId,
    entity_type: type || known?.entity_type || 'sensor',
    entity_class: known?.entity_class || inferEntityClass(type, data),
    group: known?.group || inferEntityGroup(known?.entity_class || inferEntityClass(type, data)),
    type: known?.type || type || 'sensor',
    value: Object.prototype.hasOwnProperty.call(data || {}, 'state') ? data.state : null,
    payload: flattenTelemetryState(data),
    ts: toIsoNow(),
  };
}

function makeLogger(deviceId) {
  var prefix = '[NATIVE ESPHOME ' + String(deviceId || 'unknown') + ']';
  return {
    debug: function(msg) { console.log(prefix, msg); },
    info: function(msg) { console.log(prefix, msg); },
    warn: function(msg) { console.warn(prefix, msg); },
    error: function(msg) { console.error(prefix, msg); },
  };
}

function makeCommandError(code, detail) {
  var err = new Error(code);
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  return err;
}

function isEncryptionRequiredReason(reason) {
  var msg = String(reason || '').toLowerCase();
  return msg.includes('requires encryption') || msg.includes('noise frame') || msg.includes('encryption') || msg.includes('psk');
}

function parsePercentOrUnitInterval(raw) {
  if (raw == null || raw === '') return null;
  var n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 1) n = n / 100;
  if (n < 0) n = 0;
  if (n > 1) n = 1;
  return n;
}

function resolveEntityReference(command, entities) {
  var list = Array.isArray(entities) ? entities : [];
  var wantedId = String(command?.entity_id || '').trim();
  var wantedKey = safeName(command?.entity_key || command?.key || command?.object_id || '').trim();
  var wantedType = normalizeType(command?.entity_type || '', command);
  function matches(row) {
    if (!row) return false;
    var rowId = String(row.entity_id || row.source || '').trim();
    var rowKey = safeName(row.key || row.object_id || '').trim();
    var rowType = normalizeType(row.entity_type || row.type || '', row);
    if (wantedId && rowId && rowId.toLowerCase() === wantedId.toLowerCase()) return true;
    if (wantedId && rowId && (rowType + '-' + rowKey).toLowerCase() === wantedId.toLowerCase()) return true;
    if (wantedKey && rowKey && rowKey.toLowerCase() === wantedKey.toLowerCase()) {
      if (!wantedType || rowType === wantedType) return true;
    }
    if (wantedKey && rowId && rowId.toLowerCase() === wantedKey.toLowerCase()) return true;
    return false;
  }
  var found = list.find(matches) || null;
  if (!found && wantedId && wantedType) {
    var joined = (wantedType + '-' + safeName(wantedId)).toLowerCase();
    found = list.find(function(row) { return String(row.entity_id || '').trim().toLowerCase() === joined; }) || null;
  }
  if (!found && wantedKey && wantedType) {
    var joined2 = (wantedType + '-' + wantedKey).toLowerCase();
    found = list.find(function(row) { return String(row.entity_id || '').trim().toLowerCase() === joined2; }) || null;
  }
  return found;
}

function buildSwitchCommand(command) {
  var action = String(command?.action || command?.value || '').trim().toLowerCase();
  if (action === 'on' || action === 'turn_on' || action === 'true' || action === '1') return true;
  if (action === 'off' || action === 'turn_off' || action === 'false' || action === '0') return false;
  if (typeof command?.state === 'boolean') return !!command.state;
  throw makeCommandError('switch_action_required');
}

function buildLightCommand(command) {
  var action = String(command?.action || '').trim().toLowerCase();
  var out = {};
  if (action === 'on' || action === 'turn_on') out.state = true;
  else if (action === 'off' || action === 'turn_off') out.state = false;
  else if (typeof command?.state === 'boolean') out.state = !!command.state;
  if (command?.brightness != null && command.brightness !== '') {
    var b = parsePercentOrUnitInterval(command.brightness);
    if (b == null) throw makeCommandError('light_brightness_invalid');
    out.brightness = b;
  }
  if (command?.transition_ms != null && command.transition_ms !== '') {
    var t = Number(command.transition_ms);
    if (Number.isFinite(t) && t >= 0) out.transitionLength = t;
  }
  if (command?.effect) out.effect = String(command.effect).trim();
  if (Object.keys(out).length === 0) throw makeCommandError('light_command_empty');
  return out;
}

function buildCoverCommand(command) {
  var action = String(command?.action || '').trim().toLowerCase();
  if (action === 'open') return { position: 1.0 };
  if (action === 'close') return { position: 0.0 };
  if (action === 'stop') return { stop: true };
  var position = parsePercentOrUnitInterval(command?.position);
  if (position != null) return { position: position };
  throw makeCommandError('cover_action_required');
}

function buildSelectCommand(command) {
  var option = String(command?.option || command?.value || command?.action || '').trim();
  if (!option) throw makeCommandError('select_option_required');
  return option;
}

function buildClimateCommand(command) {
  var out = {};
  var mode = String(command?.mode || command?.action || '').trim().toLowerCase();
  if (mode && mode !== 'set' && mode !== 'apply') out.mode = mode;
  if (command?.target_temperature != null && command.target_temperature !== '') {
    var t = Number(command.target_temperature);
    if (!Number.isFinite(t)) throw makeCommandError('climate_target_temperature_invalid');
    out.targetTemperature = t;
  }
  if (command?.target_temperature_high != null && command.target_temperature_high !== '') {
    var th = Number(command.target_temperature_high);
    if (!Number.isFinite(th)) throw makeCommandError('climate_target_temperature_high_invalid');
    out.targetTemperatureHigh = th;
  }
  if (command?.target_temperature_low != null && command.target_temperature_low !== '') {
    var tl = Number(command.target_temperature_low);
    if (!Number.isFinite(tl)) throw makeCommandError('climate_target_temperature_low_invalid');
    out.targetTemperatureLow = tl;
  }
  if (command?.fan_mode) out.fanMode = String(command.fan_mode).trim();
  if (command?.swing_mode) out.swingMode = String(command.swing_mode).trim();
  if (Object.keys(out).length === 0) throw makeCommandError('climate_command_empty');
  return out;
}

function buildFanCommand(command) {
  var out = {};
  var action = String(command?.action || '').trim().toLowerCase();
  if (action === 'on' || action === 'turn_on') out.state = true;
  else if (action === 'off' || action === 'turn_off') out.state = false;
  if (command?.speed_level != null && command.speed_level !== '') {
    var s = Number(command.speed_level);
    if (!Number.isFinite(s)) throw makeCommandError('fan_speed_level_invalid');
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    out.speedLevel = s;
  }
  if (command?.direction) out.direction = String(command.direction).trim().toLowerCase();
  if (command?.oscillating != null && command.oscillating !== '') {
    var raw = String(command.oscillating).trim().toLowerCase();
    out.oscillating = raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }
  if (Object.keys(out).length === 0) throw makeCommandError('fan_command_empty');
  return out;
}

function buildNumberCommand(command) {
  var value = Number(command?.value);
  if (!Number.isFinite(value)) throw makeCommandError('number_value_required');
  return value;
}

function buildLockCommand(command) {
  var action = String(command?.action || command?.value || '').trim().toLowerCase();
  if (action !== 'lock' && action !== 'unlock' && action !== 'open') throw makeCommandError('lock_action_required');
  var code = command?.code != null && String(command.code).trim() ? String(command.code).trim() : undefined;
  return { action: action, code: code };
}

function buildMediaPlayerCommand(command, moduleExports) {
  var enumObj = moduleExports?.MediaPlayerCommand || moduleExports?.default?.MediaPlayerCommand || null;
  var action = String(command?.action || '').trim().toLowerCase();
  var mapping = {
    play: 'PLAY',
    pause: 'PAUSE',
    stop: 'STOP',
    mute: 'MUTE',
    unmute: 'UNMUTE',
    toggle: 'TOGGLE',
  };
  var key = mapping[action];
  if (!key) throw makeCommandError('media_player_action_required');
  var out = { command: enumObj && enumObj[key] != null ? enumObj[key] : key };
  if (command?.media_url) out.mediaUrl = String(command.media_url).trim();
  if (command?.volume != null && command.volume !== '') {
    var v = parsePercentOrUnitInterval(command.volume);
    if (v == null) throw makeCommandError('media_player_volume_invalid');
    out.volume = v;
  }
  return out;
}

function makeOptimisticState(entity, command, normalizedPayload) {
  var type = normalizeType(entity?.entity_type || entity?.type || '', entity);
  var action = String(command?.action || '').trim().toLowerCase();
  if (type === 'switch') {
    var on = normalizedPayload === true;
    return { state: on, value: on ? 'ON' : 'OFF' };
  }
  if (type === 'light') {
    return { state: normalizedPayload.state !== undefined ? !!normalizedPayload.state : (action !== 'off'), brightness: normalizedPayload.brightness ?? null, effect: normalizedPayload.effect || null };
  }
  if (type === 'cover') {
    return { position: normalizedPayload.position ?? null, stop: !!normalizedPayload.stop, state: normalizedPayload.stop ? 'STOPPED' : (normalizedPayload.position === 1 ? 'OPEN' : (normalizedPayload.position === 0 ? 'CLOSED' : 'MOVING')) };
  }
  if (type === 'select') {
    return { option: String(normalizedPayload), value: String(normalizedPayload) };
  }
  if (type === 'climate') {
    return {
      mode: normalizedPayload.mode || null,
      targetTemperature: normalizedPayload.targetTemperature ?? null,
      targetTemperatureHigh: normalizedPayload.targetTemperatureHigh ?? null,
      targetTemperatureLow: normalizedPayload.targetTemperatureLow ?? null,
      fanMode: normalizedPayload.fanMode || null,
      swingMode: normalizedPayload.swingMode || null,
      value: (normalizedPayload.mode != null && normalizedPayload.mode !== '') ? normalizedPayload.mode : (normalizedPayload.targetTemperature != null ? normalizedPayload.targetTemperature : (normalizedPayload.targetTemperatureHigh != null ? normalizedPayload.targetTemperatureHigh : (normalizedPayload.targetTemperatureLow != null ? normalizedPayload.targetTemperatureLow : null))),
    };
  }
  if (type === 'fan') {
    return {
      state: normalizedPayload.state == null ? null : !!normalizedPayload.state,
      speedLevel: normalizedPayload.speedLevel ?? null,
      direction: normalizedPayload.direction || null,
      oscillating: normalizedPayload.oscillating == null ? null : !!normalizedPayload.oscillating,
      value: normalizedPayload.speedLevel ?? (normalizedPayload.state ? 'ON' : 'OFF'),
    };
  }
  if (type === 'number') {
    return { state: normalizedPayload, value: normalizedPayload };
  }
  if (type === 'lock') {
    return { state: normalizedPayload.action, value: normalizedPayload.action, code_used: !!normalizedPayload.code };
  }
  if (type === 'media_player') {
    return { command: normalizedPayload.command, mediaUrl: normalizedPayload.mediaUrl || null, volume: normalizedPayload.volume ?? null, value: normalizedPayload.command };
  }
  return { request: command || null };
}

function persistNativeRuntime(db, runtime, patch) {
  if (!db || !runtime || !runtime.existing) return;
  var existing = runtime.existing;
  var parsed = readJsonSafe(existing.last_validation_json, {}) || {};
  parsed.native_runtime = {
    ...(parsed.native_runtime || {}),
    last_stream_at: toIsoNow(),
    ...(patch || {}),
  };
  var nextStatus = patch?.status || (existing.status || 'imported');
  var nowIso = toIsoNow();
  db.prepare(`UPDATE esphome_devices
    SET last_validation_json=?, last_seen_at=?, status=?, updated_at=?
    WHERE id=?`).run(
    JSON.stringify(parsed),
    nowIso,
    nextStatus,
    nowIso,
    existing.id
  );
}


function persistNativeCommand(db, runtime, commandResult) {
  if (!db || !runtime || !runtime.existing) return;
  persistNativeRuntime(db, runtime, {
    status: 'online',
    last_native_command_at: commandResult?.ts || toIsoNow(),
    last_native_command: commandResult || null,
  });
}

function buildFallbackSnapshot(payload, probeResult, discoveryResult, note) {
  var runtime = buildNativeRuntimePayload(null, payload || {});
  var reachable = !!probeResult?.reachable;
  var entities = Array.isArray(discoveryResult?.entities) ? discoveryResult.entities : [];
  var encryptionRequired = isEncryptionRequiredReason(note);
  return {
    connected: false,
    live_stream: false,
    state: reachable ? (encryptionRequired ? 'encryption_required' : 'fallback_assisted') : 'degraded',
    transport: 'native_api',
    transport_state: reachable ? 'reachable' : 'unreachable',
    protocol_phase: reachable ? (encryptionRequired ? 'encryption_required' : 'probe_ok') : 'probe_failed',
    session_mode: 'probe_assisted',
    probe: probeResult?.probe || probeResult || null,
    discovery: discoveryResult || null,
    fallback: true,
    fallback_reason: note || null,
    requires_encryption: encryptionRequired,
    device_info: {
      device_name: runtime.device_name || null,
      friendly_name: runtime.friendly_name || runtime.device_name || null,
      board_profile_id: runtime.board_profile_id || null,
      host: runtime.api_host || null,
      port: runtime.api_port || null,
      encryption_key_present: !!runtime.encryption_key,
      encryption_required: encryptionRequired,
      native_client_mode: 'fallback_probe_assist',
      note: encryptionRequired
        ? 'Host reachable, but ESPHome native API requires an encryption key. Using fallback-assisted discovery only.'
        : (note || 'Fell back to probe-assisted mode.'),
    },
    entities: entities,
    state_snapshot: {
      kind: 'snapshot_only',
      reachable: reachable,
      entity_count: entities.length,
      state_count: 0,
    },
    error: note || (reachable ? null : (probeResult?.probe?.error || probeResult?.error || null)),
  };
}

function createEspHomeNativeClient(ctx = {}, initialPayload = {}) {
  var db = ctx.db || null;
  var onUpdate = typeof ctx.onUpdate === 'function' ? ctx.onUpdate : null;
  var currentClient = null;
  var currentModuleExports = null;
  var listenersBound = false;
  var currentRuntime = buildNativeRuntimePayload(db, initialPayload || {});
  var state = {
    connected: false,
    live_stream: false,
    state: 'idle',
    transport: 'native_api',
    transport_state: 'idle',
    protocol_phase: 'idle',
    session_mode: 'binary_stream',
    probe: null,
    discovery: null,
    device_info: null,
    entities: [],
    state_snapshot: {
      kind: 'native_stream',
      entity_count: 0,
      state_count: 0,
      by_entity: {},
      last_event_at: null,
    },
    error: null,
  };
  var entitiesById = new Map();
  var entityList = [];
  var stateByEntity = new Map();

  function emitUpdate(extra) {
    var snapshot = {
      connected: !!state.connected,
      live_stream: !!state.live_stream,
      state: state.state,
      transport: state.transport,
      transport_state: state.transport_state,
      protocol_phase: state.protocol_phase,
      session_mode: state.session_mode,
      probe: state.probe,
      discovery: state.discovery,
      device_info: state.device_info,
      entities: entityList.slice(),
      state_snapshot: {
        ...(state.state_snapshot || {}),
        entity_count: entityList.length,
        state_count: stateByEntity.size,
        by_entity: Object.fromEntries(Array.from(stateByEntity.entries())),
      },
      error: state.error,
      site_id: currentRuntime.site_id || null,
      device_id: currentRuntime.device_id || null,
      device_name: state.device_info?.name || currentRuntime.device_name || null,
      friendly_name: currentRuntime.friendly_name || null,
      board_profile_id: currentRuntime.board_profile_id || null,
      ...(extra || {}),
    };
    if (onUpdate) onUpdate(snapshot);
    return snapshot;
  }

  async function fallbackSnapshot(merged, reason) {
    var probeResult = await probeNativeDevice(db, merged);
    var discoveryResult = discoverNativeAssist(db, merged);
    var snap = buildFallbackSnapshot(merged, probeResult, discoveryResult, reason);
    state.connected = !!snap.connected;
    state.live_stream = !!snap.live_stream;
    state.state = snap.state;
    state.transport_state = snap.transport_state;
    state.protocol_phase = snap.protocol_phase;
    state.probe = snap.probe;
    state.discovery = snap.discovery;
    state.device_info = snap.device_info;
    entityList = Array.isArray(snap.entities) ? snap.entities.slice() : [];
    entitiesById = new Map(entityList.map(function(row) { return [String(row.entity_id || row.source || row.key), row]; }));
    stateByEntity = new Map();
    state.state_snapshot = snap.state_snapshot;
    state.error = snap.error || null;
    try {
      persistNativeRuntime(db, currentRuntime, {
        status: snap.live_stream ? 'online' : (snap.probe && snap.probe.reachable ? 'imported' : 'error'),
        last_native_entities: entityList,
        last_native_entity_count: entityList.length,
        last_stream_error: snap.error || null,
        last_probe: snap.probe || null,
        last_native_session_mode: snap.session_mode || null,
        encryption_required: !!snap.requires_encryption,
        fallback_reason: snap.fallback_reason || null,
      });
    } catch (_) {}
    emitUpdate();
    return snap;
  }

  function bindClientListeners(client, moduleExports) {
    if (!client || listenersBound) return;
    listenersBound = true;
    var eventNames = ['sensor','binary_sensor','switch','light','climate','cover','fan','number','select','lock','media_player','text_sensor','update','event','telemetry'];

    client.on('connect', function(encrypted) {
      state.connected = true;
      state.live_stream = true;
      state.state = 'connected';
      state.transport_state = 'streaming';
      state.protocol_phase = encrypted ? 'stream_connected_noise' : 'stream_connected_plaintext';
      state.error = null;
      if (state.device_info) state.device_info.encrypted = !!encrypted;
      persistNativeRuntime(db, currentRuntime, { status: 'online', last_stream_connected_at: toIsoNow(), encrypted: !!encrypted });
      emitUpdate();
      try {
        if (moduleExports && moduleExports.LogLevel && typeof client.subscribeToLogs === 'function') client.subscribeToLogs(moduleExports.LogLevel.INFO);
      } catch (_) {}
    });

    client.on('disconnect', function(reason) {
      state.connected = false;
      state.live_stream = false;
      state.state = 'disconnected';
      state.transport_state = 'idle';
      state.protocol_phase = 'stream_disconnected';
      state.error = reason ? String(reason) : null;
      persistNativeRuntime(db, currentRuntime, { status: 'imported', last_stream_disconnect_at: toIsoNow(), last_stream_error: state.error });
      emitUpdate();
    });

    client.on('deviceInfo', function(info) {
      state.device_info = normalizeDeviceInfo(info, currentRuntime, state.device_info && state.device_info.encrypted);
      persistNativeRuntime(db, currentRuntime, { status: 'online', last_device_info: state.device_info });
      emitUpdate();
    });

    client.on('entities', function(entities) {
      entityList = (Array.isArray(entities) ? entities : []).map(normalizeEntity);
      entitiesById = new Map(entityList.map(function(row) { return [String(row.entity_id || row.source || row.key), row]; }));
      state.discovery = {
        mode: 'native_stream',
        entity_count: entityList.length,
        discovered_at: toIsoNow(),
      };
      state.protocol_phase = 'entities_ready';
      state.state_snapshot = {
        ...(state.state_snapshot || {}),
        kind: 'native_stream',
        entity_count: entityList.length,
        state_count: stateByEntity.size,
        by_entity: Object.fromEntries(Array.from(stateByEntity.entries())),
        last_event_at: toIsoNow(),
      };
      persistNativeRuntime(db, currentRuntime, { status: 'online', last_native_entities: entityList, last_native_entity_count: entityList.length });
      emitUpdate({ entities: entityList.slice(), discovery: state.discovery });
    });

    eventNames.forEach(function(eventName) {
      client.on(eventName, function(data) {
        var normalized = normalizeTelemetry({ ...(data || {}), type: eventName }, entitiesById);
        stateByEntity.set(normalized.entity_id, normalized);
        state.state_snapshot = {
          kind: 'native_stream',
          entity_count: entityList.length,
          state_count: stateByEntity.size,
          by_entity: Object.fromEntries(Array.from(stateByEntity.entries())),
          last_event_at: normalized.ts,
        };
        state.connected = true;
        state.live_stream = true;
        state.state = 'connected';
        state.transport_state = 'streaming';
        state.protocol_phase = 'state_stream';
        state.error = null;
        persistNativeRuntime(db, currentRuntime, { status: 'online', last_stream_state_at: normalized.ts, last_stream_state: normalized });
        emitUpdate({ state_snapshot: state.state_snapshot });
      });
    });

    client.on('log', function(data) {
      persistNativeRuntime(db, currentRuntime, { status: state.connected ? 'online' : 'imported', last_native_log: data || null, last_native_log_at: toIsoNow() });
    });

    client.on('error', function(err) {
      state.error = String(err?.message || err || 'native_client_error');
      state.state = state.connected ? 'degraded' : 'error';
      state.transport_state = state.connected ? 'degraded' : 'error';
      state.protocol_phase = 'stream_error';
      persistNativeRuntime(db, currentRuntime, { status: state.connected ? 'online' : 'imported', last_stream_error: state.error });
      emitUpdate();
    });
  }

  async function ensureConnected(moduleExports, merged) {
    if (currentClient) return currentClient;
    currentModuleExports = moduleExports || currentModuleExports;
    var EspHomeClient = moduleExports?.EspHomeClient || moduleExports?.default?.EspHomeClient || moduleExports?.default || null;
    if (!EspHomeClient) throw new Error('esphome_client_export_missing');
    currentClient = new EspHomeClient({
      clientId: 'elaris-native',
      host: merged.api_host,
      port: merged.api_port,
      psk: merged.encryption_key || undefined,
      serverName: merged.hostname || undefined,
      logger: makeLogger(merged.device_name || merged.api_host),
    });
    bindClientListeners(currentClient, moduleExports);
    return currentClient;
  }

  function waitForInitialReady(timeoutMs) {
    return new Promise(function(resolve, reject) {
      var done = false;
      var timer = setTimeout(function() {
        if (done) return;
        done = true;
        reject(new Error('native_stream_timeout'));
      }, timeoutMs);
      function finish() {
        if (done) return;
        if (!state.connected) return;
        if (!entityList.length && !state.device_info) return;
        done = true;
        clearTimeout(timer);
        resolve();
      }
      var poll = setInterval(function() {
        if (done) return clearInterval(poll);
        finish();
      }, 150);
    });
  }

  return {
    transport: 'native_api',
    sessionMode: 'binary_stream',
    refreshMs: 15000,
    async connect(payload = {}) {
      var merged = { ...(initialPayload || {}), ...(payload || {}) };
      currentRuntime = buildNativeRuntimePayload(db, merged);
      if (!merged.api_host && !merged.ip_address && !merged.hostname) throw new Error('missing_api_host');
      merged.api_host = merged.api_host || merged.ip_address || merged.hostname;
      try {
        var moduleExports = await loadEspHomeClientModule();
        var client = await ensureConnected(moduleExports, merged);
        state.transport_state = 'dialing';
        state.protocol_phase = 'connect';
        state.error = null;
        emitUpdate();
        client.connect();
        await waitForInitialReady(Math.min(Math.max(Number(merged.connect_timeout_ms || 9000), 2000), 20000));
        if (entityList.length) persistNativeRuntime(db, currentRuntime, { status: 'online', last_native_entities: entityList, last_native_entity_count: entityList.length });
        return emitUpdate();
      } catch (err) {
        return fallbackSnapshot(merged, String(err?.message || err || 'native_connect_failed'));
      }
    },
    async refresh(payload = {}) {
      var merged = { ...(initialPayload || {}), ...(payload || {}) };
      currentRuntime = buildNativeRuntimePayload(db, merged);
      if (!currentClient) {
        try {
          var moduleExports = await loadEspHomeClientModule();
          await ensureConnected(moduleExports, merged);
        } catch (err) {
          return fallbackSnapshot(merged, String(err?.message || err || 'native_refresh_fallback'));
        }
      }
      state.protocol_phase = 'refresh';
      state.transport_state = state.connected ? 'streaming' : 'dialing';
      emitUpdate();
      if (!state.connected && currentClient) {
        try { currentClient.connect(); }
        catch (_) {}
        try { await waitForInitialReady(Math.min(Math.max(Number(merged.connect_timeout_ms || 5000), 1500), 12000)); }
        catch (_) {}
      }
      if (!entityList.length) {
        var discovery = discoverNativeAssist(db, merged);
        if (Array.isArray(discovery.entities) && discovery.entities.length) {
          entityList = discovery.entities.slice();
          entitiesById = new Map(entityList.map(function(row) { return [String(row.entity_id || row.source || row.key), row]; }));
          state.discovery = discovery;
        }
      }
      return emitUpdate({ protocol_phase: state.connected ? 'stream_live' : 'refresh_assisted' });
    },
    async executeCommand(command = {}, payload = {}) {
      var merged = { ...(initialPayload || {}), ...(payload || {}) };
      currentRuntime = buildNativeRuntimePayload(db, merged);
      if (!currentClient || !state.connected || !state.live_stream) throw makeCommandError('native_command_requires_live_session');
      var entity = resolveEntityReference(command, entityList);
      if (!entity) throw makeCommandError('native_entity_not_found');
      var entityType = normalizeType(entity.entity_type || entity.type || '', entity);
      var entityId = String(entity.entity_id || entity.source || '').trim();
      if (!entityId) throw makeCommandError('native_entity_id_missing');
      var commandResult = {
        ok: true,
        entity_id: entityId,
        entity_key: entity.key || null,
        entity_name: entity.name || entityId,
        entity_type: entityType,
        request: null,
        ts: toIsoNow(),
      };
      var optimistic = null;
      if (entityType === 'switch') {
        var switchState = buildSwitchCommand(command);
        if (typeof currentClient.sendSwitchCommand !== 'function') throw makeCommandError('native_switch_command_unsupported');
        currentClient.sendSwitchCommand(entityId, switchState);
        commandResult.request = { action: switchState ? 'on' : 'off', state: switchState };
        optimistic = makeOptimisticState(entity, command, switchState);
      } else if (entityType === 'light') {
        var lightPayload = buildLightCommand(command);
        if (typeof currentClient.sendLightCommand !== 'function') throw makeCommandError('native_light_command_unsupported');
        currentClient.sendLightCommand(entityId, lightPayload);
        commandResult.request = { ...lightPayload };
        optimistic = makeOptimisticState(entity, command, lightPayload);
      } else if (entityType === 'cover') {
        var coverPayload = buildCoverCommand(command);
        if (typeof currentClient.sendCoverCommand !== 'function') throw makeCommandError('native_cover_command_unsupported');
        currentClient.sendCoverCommand(entityId, coverPayload);
        commandResult.request = { ...coverPayload };
        optimistic = makeOptimisticState(entity, command, coverPayload);
      } else if (entityType === 'select') {
        var option = buildSelectCommand(command);
        if (typeof currentClient.sendSelectCommand !== 'function') throw makeCommandError('native_select_command_unsupported');
        currentClient.sendSelectCommand(entityId, option);
        commandResult.request = { option: option };
        optimistic = makeOptimisticState(entity, command, option);
      } else if (entityType === 'climate') {
        var climatePayload = buildClimateCommand(command);
        if (typeof currentClient.sendClimateCommand !== 'function') throw makeCommandError('native_climate_command_unsupported');
        currentClient.sendClimateCommand(entityId, climatePayload);
        commandResult.request = { ...climatePayload };
        optimistic = makeOptimisticState(entity, command, climatePayload);
      } else if (entityType === 'fan') {
        var fanPayload = buildFanCommand(command);
        if (typeof currentClient.sendFanCommand !== 'function') throw makeCommandError('native_fan_command_unsupported');
        currentClient.sendFanCommand(entityId, fanPayload);
        commandResult.request = { ...fanPayload };
        optimistic = makeOptimisticState(entity, command, fanPayload);
      } else if (entityType === 'number') {
        var numberValue = buildNumberCommand(command);
        if (typeof currentClient.sendNumberCommand !== 'function') throw makeCommandError('native_number_command_unsupported');
        currentClient.sendNumberCommand(entityId, numberValue);
        commandResult.request = { value: numberValue };
        optimistic = makeOptimisticState(entity, command, numberValue);
      } else if (entityType === 'lock') {
        var lockPayload = buildLockCommand(command);
        if (typeof currentClient.sendLockCommand !== 'function') throw makeCommandError('native_lock_command_unsupported');
        currentClient.sendLockCommand(entityId, lockPayload.action, lockPayload.code);
        commandResult.request = { ...lockPayload };
        optimistic = makeOptimisticState(entity, command, lockPayload);
      } else if (entityType === 'media_player') {
        var mediaPayload = buildMediaPlayerCommand(command, currentModuleExports);
        if (typeof currentClient.sendMediaPlayerCommand !== 'function') throw makeCommandError('native_media_player_command_unsupported');
        currentClient.sendMediaPlayerCommand(entityId, mediaPayload);
        commandResult.request = { ...mediaPayload };
        optimistic = makeOptimisticState(entity, command, mediaPayload);
      } else {
        throw makeCommandError('native_entity_type_not_supported', entityType);
      }
      if (optimistic) {
        var normalized = {
          entity_id: entityId,
          entity_key: entity.key || null,
          entity_name: entity.name || entityId,
          entity_type: entityType,
          entity_class: entity.entity_class || inferEntityClass(entityType, entity),
          group: entity.group || inferEntityGroup(entity.entity_class || inferEntityClass(entityType, entity)),
          type: entity.type || entityType,
          value: Object.prototype.hasOwnProperty.call(optimistic, 'value') ? optimistic.value : (optimistic.state ?? null),
          payload: optimistic,
          ts: commandResult.ts,
        };
        stateByEntity.set(entityId, normalized);
        state.state_snapshot = {
          kind: 'native_stream',
          entity_count: entityList.length,
          state_count: stateByEntity.size,
          by_entity: Object.fromEntries(Array.from(stateByEntity.entries())),
          last_event_at: commandResult.ts,
        };
      }
      state.connected = true;
      state.live_stream = true;
      state.state = 'connected';
      state.transport_state = 'streaming';
      state.protocol_phase = 'command_sent';
      state.error = null;
      persistNativeCommand(db, currentRuntime, commandResult);
      return emitUpdate({ command_result: commandResult, state_snapshot: state.state_snapshot });
    },
    async disconnect() {
      if (currentClient && typeof currentClient.disconnect === 'function') {
        try { currentClient.disconnect(); }
        catch (_) {}
      }
      currentClient = null;
      currentModuleExports = null;
      listenersBound = false;
      state.connected = false;
      state.live_stream = false;
      state.state = 'disconnected';
      state.transport_state = 'idle';
      state.protocol_phase = 'disconnect';
      state.error = null;
      emitUpdate();
      return emitUpdate();
    },
  };
}

module.exports = { createEspHomeNativeClient };
