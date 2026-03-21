// tests/helpers/fake-native-adapter.js
'use strict';

/**
 * Creates a configurable fake native client.
 *
 * @param {object} [overrides]
 * @param {object}   [overrides.connectResult]     - What client.connect() resolves with
 * @param {object}   [overrides.refreshResult]     - What client.refresh() resolves with
 * @param {object}   [overrides.disconnectResult]  - What client.disconnect() resolves with
 * @param {string}   [overrides.transport]         - e.g. 'tcp'
 * @param {string}   [overrides.sessionMode]       - e.g. 'live'
 * @param {number}   [overrides.refreshMs]         - Auto-refresh interval
 * @param {Error}    [overrides.connectError]      - If set, connect() rejects with this
 * @param {Error}    [overrides.disconnectError]   - If set, disconnect() rejects with this
 */
function createFakeClient(overrides = {}) {
  const calls = [];

  const defaultConnectResult = {
    connected: true,
    state: 'connected',
    transport_state: 'reachable',
    protocol_phase: 'connected',
    entities: [],
    ...(overrides.connectResult || {}),
  };

  const defaultRefreshResult = {
    connected: true,
    state: 'connected',
    entities: [],
    ...(overrides.refreshResult || {}),
  };

  const defaultDisconnectResult = {
    connected: false,
    state: 'disconnected',
    ...(overrides.disconnectResult || {}),
  };

  const client = {
    transport: overrides.transport || 'tcp',
    sessionMode: overrides.sessionMode || 'live',
    refreshMs: overrides.refreshMs || 0,

    async connect(payload, ctx) {
      calls.push({ method: 'connect', payload, ctx });
      if (overrides.connectError) throw overrides.connectError;
      return defaultConnectResult;
    },

    async refresh(payload, ctx) {
      calls.push({ method: 'refresh', payload, ctx });
      return defaultRefreshResult;
    },

    async disconnect(payload, ctx) {
      calls.push({ method: 'disconnect', payload, ctx });
      if (overrides.disconnectError) throw overrides.disconnectError;
      return defaultDisconnectResult;
    },

    async executeCommand(command, payload, ctx) {
      calls.push({ method: 'executeCommand', command, payload, ctx });
      return { connected: true, command_result: { ok: true, ts: new Date().toISOString() } };
    },

    // Test introspection
    _calls: calls,
    callsFor(method) { return calls.filter(c => c.method === method); },
  };

  return client;
}

/**
 * Creates a fake adapter (what session_manager receives as `adapter`).
 *
 * @param {object|Function} [clientOrFactory]
 *   - If an object: used as the client for every createNativeClient() call
 *   - If a function: called as a factory (ctx, payload) => client, for per-call customisation
 *   - If omitted: creates a default fake client
 */
function createFakeAdapter(clientOrFactory) {
  const adapterCalls = [];

  return {
    createNativeClient(ctx, payload) {
      adapterCalls.push({ ctx, payload });
      if (typeof clientOrFactory === 'function') return clientOrFactory(ctx, payload);
      return clientOrFactory || createFakeClient();
    },
    _calls: adapterCalls,
  };
}

module.exports = { createFakeClient, createFakeAdapter };
