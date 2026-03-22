'use strict';

const { assertNativeClient } = require('./client_contract');

function toIsoNow() {
  return new Date().toISOString();
}

function makeSessionKey(integrationKey, payload) {
  var key = String(integrationKey || '').trim().toLowerCase();
  var deviceId = payload?.device_id != null ? String(payload.device_id).trim() : '';
  var deviceName = String(payload?.device_name || '').trim().toLowerCase();
  var host = String(payload?.api_host || payload?.ip_address || payload?.hostname || '').trim().toLowerCase();
  var identity = deviceId || deviceName || host;
  if (!key || !identity) throw new Error('native_session_identity_required');
  return key + '::' + identity;
}

function cleanPayload(payload) {
  var out = { ...(payload || {}) };
  if (out.encryption_key) out.encryption_key = '***';
  if (out.api_encryption_key) out.api_encryption_key = '***';
  if (out.password) out.password = '***';
  return out;
}

function cleanCommand(command) {
  var out = { ...(command || {}) };
  if (out.code) out.code = '***';
  if (out.password) out.password = '***';
  return out;
}

function createNativeSessionManager(opts) {
  var sessions = new Map();
  var broadcast = typeof opts?.broadcast === 'function' ? opts.broadcast : null;

  function snapshotSession(session) {
    if (!session) return null;
    return {
      session_key: session.session_key,
      integration_key: session.integration_key,
      state: session.state,
      connected: !!session.connected,
      live_stream: !!session.live_stream,
      transport: session.transport || null,
      transport_state: session.transport_state || null,
      protocol_phase: session.protocol_phase || null,
      session_mode: session.session_mode || null,
      site_id: session.site_id || null,
      device_id: session.device_id || null,
      device_name: session.device_name || null,
      friendly_name: session.friendly_name || null,
      board_profile_id: session.board_profile_id || null,
      last_connect_at: session.last_connect_at || null,
      last_refresh_at: session.last_refresh_at || null,
      last_disconnect_at: session.last_disconnect_at || null,
      last_error: session.last_error || null,
      reconnect_interval_ms: session.reconnect_interval_ms || null,
      device_info: session.device_info || null,
      entities: Array.isArray(session.entities) ? session.entities : [],
      entity_count: Array.isArray(session.entities) ? session.entities.length : 0,
      state_snapshot: session.state_snapshot || null,
      probe: session.probe || null,
      discovery: session.discovery || null,
      last_command_at: session.last_command_at || null,
      last_command_result: session.last_command_result || null,
      payload: cleanPayload(session.payload || {}),
      updated_at: session.updated_at || null,
    };
  }

  function publish(kind, session, extra) {
    if (!broadcast || !session) return;
    var snap = snapshotSession(session);
    broadcast({
      type: kind || 'native_session_update',
      site_id: snap.site_id || null,
      device_id: snap.device_name || snap.device_id || null,
      integration_key: snap.integration_key,
      native_session: snap,
      ...(extra || {}),
      ts: Date.now(),
    });
  }

  function get(sessionKey) {
    var key = String(sessionKey || '').trim().toLowerCase();
    return key ? (sessions.get(key) || null) : null;
  }

  function list(integrationKey) {
    var key = String(integrationKey || '').trim().toLowerCase();
    return Array.from(sessions.values())
      .filter(function(session) { return !key || session.integration_key === key; })
      .map(snapshotSession)
      .sort(function(a, b) {
        var at = new Date(a.updated_at || 0).getTime() || 0;
        var bt = new Date(b.updated_at || 0).getTime() || 0;
        return bt - at;
      });
  }

  function mergeSessionResult(session, result, defaults) {
    if (!session || !result) return;
    var priorEntities = Array.isArray(session.entities) ? session.entities : [];
    session.connected = result.connected == null ? !!session.connected : !!result.connected;
    session.live_stream = result.live_stream == null ? !!session.live_stream : !!result.live_stream;
    session.state = String(result.state || defaults?.state || session.state || (session.connected ? 'connected' : 'idle'));
    session.transport = result.transport || session.transport || defaults?.transport || null;
    session.transport_state = result.transport_state || defaults?.transport_state || session.transport_state || (session.connected ? 'reachable' : 'idle');
    session.protocol_phase = result.protocol_phase || defaults?.protocol_phase || session.protocol_phase || null;
    session.session_mode = result.session_mode || session.session_mode || defaults?.session_mode || null;
    if (result.probe != null) session.probe = result.probe;
    if (result.discovery != null) session.discovery = result.discovery;
    if (result.device_info != null) session.device_info = result.device_info;
    if (Array.isArray(result.entities)) session.entities = result.entities;
    if (result.state_snapshot != null) session.state_snapshot = result.state_snapshot;
    if (result.error !== undefined) session.last_error = result.error || null;
    if (result.device_id != null) session.device_id = result.device_id;
    if (result.site_id != null) session.site_id = result.site_id;
    if (result.device_name) session.device_name = String(result.device_name).trim() || session.device_name;
    if (result.friendly_name) session.friendly_name = String(result.friendly_name).trim() || session.friendly_name;
    if (result.board_profile_id) session.board_profile_id = String(result.board_profile_id).trim() || session.board_profile_id;
    if (result.command_result != null) {
      session.last_command_at = result.command_result.ts || toIsoNow();
      session.last_command_result = result.command_result;
    }
    session.updated_at = toIsoNow();
    publish('native_session_update', session);
    var nextEntities = Array.isArray(session.entities) ? session.entities : [];
    if (Array.isArray(result.entities) || nextEntities.length !== priorEntities.length) publish('native_session_entities', session);
    if (result.state_snapshot != null) publish('native_session_state', session);
    if (result.command_result != null) publish('native_session_command', session, { command_result: result.command_result });
  }

  function attachClientUpdates(session) {
    return function(result) {
      try {
        mergeSessionResult(session, result || {}, {});
      } catch (err) {
        session.last_error = String(err?.message || err);
        session.updated_at = toIsoNow();
        publish('native_session_update', session);
      }
    };
  }

  function ensureSession(adapter, integrationKey, payload) {
    var sessionKey = makeSessionKey(integrationKey, payload);
    var existing = sessions.get(sessionKey);
    if (existing) {
      existing.payload = { ...(existing.payload || {}), ...(payload || {}) };
      existing.site_id = payload?.site_id != null ? Number(payload.site_id) : existing.site_id;
      existing.device_id = payload?.device_id != null ? Number(payload.device_id) : existing.device_id;
      existing.device_name = payload?.device_name || existing.device_name || null;
      existing.friendly_name = payload?.friendly_name || existing.friendly_name || null;
      existing.board_profile_id = payload?.board_profile_id || existing.board_profile_id || null;
      return existing;
    }
    var session = {
      session_key: sessionKey,
      integration_key: integrationKey,
      payload: { ...(payload || {}) },
      site_id: payload?.site_id != null ? Number(payload.site_id) : null,
      device_id: payload?.device_id != null ? Number(payload.device_id) : null,
      device_name: String(payload?.device_name || '').trim() || null,
      friendly_name: String(payload?.friendly_name || '').trim() || null,
      board_profile_id: String(payload?.board_profile_id || '').trim() || null,
      state: 'idle',
      connected: false,
      live_stream: false,
      transport: null,
      transport_state: 'idle',
      protocol_phase: 'idle',
      session_mode: null,
      reconnect_interval_ms: null,
      device_info: null,
      entities: [],
      state_snapshot: null,
      probe: null,
      discovery: null,
      last_error: null,
      last_command_at: null,
      last_command_result: null,
      updated_at: toIsoNow(),
      _client: null,
      _timer: null,
    };
    sessions.set(sessionKey, session);
    var client = assertNativeClient(adapter.createNativeClient({ db: opts.db, sessionKey: sessionKey, onUpdate: attachClientUpdates(session) }, payload), integrationKey);
    session.transport = client.transport || null;
    session.session_mode = client.sessionMode || null;
    session.reconnect_interval_ms = Number(client.refreshMs || 0) > 0 ? Number(client.refreshMs) : null;
    session._client = client;
    return session;
  }

  async function runRefresh(session, cause) {
    if (!session || !session._client) throw new Error('native_session_missing');
    var result = await session._client.refresh(session.payload || {}, { cause: cause || 'refresh', session: snapshotSession(session) });
    mergeSessionResult(session, result, {});
    session.last_refresh_at = toIsoNow();
    session.updated_at = session.last_refresh_at;
    return snapshotSession(session);
  }

  async function connect(adapter, integrationKey, payload) {
    if (!adapter || typeof adapter.createNativeClient !== 'function') throw new Error('integration_native_client_unsupported');
    var session = ensureSession(adapter, integrationKey, payload || {});
    session.state = 'connecting';
    session.transport_state = 'dialing';
    session.protocol_phase = 'connect';
    session.last_error = null;
    session.updated_at = toIsoNow();
    publish('native_session_update', session);
    var result = await session._client.connect(session.payload || {}, { session: snapshotSession(session) });
    mergeSessionResult(session, result, { protocol_phase: 'connected' });
    session.last_connect_at = toIsoNow();
    session.last_refresh_at = session.last_connect_at;
    session.updated_at = session.last_connect_at;
    if (session._timer) { clearInterval(session._timer); session._timer = null; }
    if (session.reconnect_interval_ms && session.connected) {
      session._timer = setInterval(function() {
        runRefresh(session, 'interval').catch(function(err) {
          session.last_error = String(err?.message || err);
          session.state = 'error';
          session.updated_at = toIsoNow();
          publish('native_session_update', session);
        });
      }, session.reconnect_interval_ms);
    }
    publish('native_session_update', session);
    return snapshotSession(session);
  }

  async function refresh(integrationKey, payload) {
    var sessionKey = makeSessionKey(integrationKey, payload || {});
    var session = sessions.get(sessionKey);
    if (!session) throw new Error('native_session_not_found');
    session.payload = { ...(session.payload || {}), ...(payload || {}) };
    return runRefresh(session, 'manual');
  }

  async function execute(adapter, integrationKey, payload, command) {
    var sessionKey = makeSessionKey(integrationKey, payload || {});
    var session = sessions.get(sessionKey);
    if (!session) {
      if (!adapter || typeof adapter.createNativeClient !== 'function') throw new Error('native_session_not_found');
      await connect(adapter, integrationKey, payload || {});
      session = sessions.get(sessionKey);
    }
    if (!session || !session._client) throw new Error('native_session_not_found');
    session.payload = { ...(session.payload || {}), ...(payload || {}) };
    if (typeof session._client.executeCommand !== 'function') throw new Error('native_command_unsupported');
    session.protocol_phase = 'command';
    session.last_error = null;
    session.updated_at = toIsoNow();
    publish('native_session_update', session, { command_request: cleanCommand(command) });
    var result = await session._client.executeCommand(command || {}, session.payload || {}, { session: snapshotSession(session) });
    mergeSessionResult(session, result || {}, { protocol_phase: 'command_applied' });
    if (!session.last_command_at) session.last_command_at = toIsoNow();
    if (!session.last_command_result) session.last_command_result = { ok: true, request: cleanCommand(command), ts: session.last_command_at };
    session.updated_at = toIsoNow();
    publish('native_session_update', session, { command_result: session.last_command_result });
    return snapshotSession(session);
  }

  async function disconnect(integrationKey, payload) {
    var sessionKey = makeSessionKey(integrationKey, payload || {});
    var session = sessions.get(sessionKey);
    if (!session) throw new Error('native_session_not_found');
    if (session._timer) { clearInterval(session._timer); session._timer = null; }
    var result = await session._client.disconnect(session.payload || {}, { session: snapshotSession(session) });
    mergeSessionResult(session, result, { state: 'disconnected', transport_state: 'idle', protocol_phase: 'disconnect' });
    session.connected = false;
    session.live_stream = false;
    session.last_disconnect_at = toIsoNow();
    session.updated_at = session.last_disconnect_at;
    publish('native_session_update', session);
    return snapshotSession(session);
  }

  function shutdown() {
    for (const session of sessions.values()) {
      if (session._timer) clearInterval(session._timer);
      session._timer = null;
    }
    sessions.clear();
  }

  return {
    connect,
    refresh,
    execute,
    disconnect,
    get: function(sessionKey) { return snapshotSession(get(sessionKey)); },
    list,
    shutdown,
  };
}

module.exports = { createNativeSessionManager, makeSessionKey };
