// tests/unit/native/session-manager.test.js
'use strict';

import { describe, it, expect } from 'vitest';
const { makeSessionKey, createNativeSessionManager } = require('../../../src/integrations/native/session_manager');
const { createFakeAdapter, createFakeClient } = require('../../helpers/fake-native-adapter');

// ─── makeSessionKey ────────────────────────────────────────────────────────────

describe('makeSessionKey', () => {
  it('builds key from integration key + device_id (priority 1)', () => {
    const k = makeSessionKey('esphome', { device_id: 42, device_name: 'sensor', ip_address: '1.2.3.4' });
    expect(k).toBe('esphome::42');
  });

  it('falls back to device_name when no device_id', () => {
    const k = makeSessionKey('esphome', { device_name: 'My Sensor', ip_address: '1.2.3.4' });
    expect(k).toBe('esphome::my sensor');
  });

  it('uses api_host as first host fallback (when no device_id or device_name)', () => {
    const k = makeSessionKey('esphome', { api_host: 'esp-xyz.local' });
    expect(k).toBe('esphome::esp-xyz.local');
  });

  it('uses ip_address when no device_id, device_name, or api_host', () => {
    const k = makeSessionKey('esphome', { ip_address: '192.168.1.10' });
    expect(k).toBe('esphome::192.168.1.10');
  });

  it('uses hostname as last host fallback', () => {
    const k = makeSessionKey('esphome', { hostname: 'esp-abc.local' });
    expect(k).toBe('esphome::esp-abc.local');
  });

  it('normalises integration key to lowercase + trimmed', () => {
    const k = makeSessionKey('  ESPHome  ', { device_id: 1 });
    expect(k).toBe('esphome::1');
  });

  it('throws when integration key is empty', () => {
    expect(() => makeSessionKey('', { device_id: 1 })).toThrow('native_session_identity_required');
  });

  it('throws when no identity field is present', () => {
    expect(() => makeSessionKey('esphome', {})).toThrow('native_session_identity_required');
  });

  it('same device_id always produces the same key regardless of other fields', () => {
    const k1 = makeSessionKey('esphome', { device_id: 7, device_name: 'a', ip_address: '1.1.1.1' });
    const k2 = makeSessionKey('esphome', { device_id: 7, device_name: 'b', ip_address: '2.2.2.2' });
    expect(k1).toBe(k2);
  });
});

// ─── C1: disconnect → reconnect ───────────────────────────────────────────────

describe('createNativeSessionManager — disconnect clears client, reconnect recreates it', () => {
  function makeManager() {
    const broadcasts = [];
    const mgr = createNativeSessionManager({
      db: {},
      broadcast: (ev) => broadcasts.push(ev),
    });
    return { mgr, broadcasts };
  }

  const PAYLOAD = { device_id: 1, device_name: 'test-device', ip_address: '10.0.0.1' };
  const IKEY = 'esphome';

  it('connect succeeds on first call', async () => {
    const { mgr } = makeManager();
    const client1 = createFakeClient();
    const adapter = createFakeAdapter(client1);

    const snap = await mgr.connect(adapter, IKEY, PAYLOAD);
    expect(snap.connected).toBe(true);
    expect(snap.state).toBe('connected');
  });

  it('after disconnect, session _client is nulled — next connect creates a fresh client', async () => {
    const { mgr } = makeManager();

    let callCount = 0;
    // Factory: returns a new client on each createNativeClient call
    const adapter = createFakeAdapter((_ctx, _payload) => {
      callCount++;
      return createFakeClient();
    });

    await mgr.connect(adapter, IKEY, PAYLOAD);
    expect(callCount).toBe(1);

    await mgr.disconnect(IKEY, PAYLOAD);

    // reconnect — should create a brand new client
    await mgr.connect(adapter, IKEY, PAYLOAD);
    expect(callCount).toBe(2); // C1: a second client was created
  });

  it('reconnect after disconnect returns connected state', async () => {
    const { mgr } = makeManager();
    const adapter = createFakeAdapter(() => createFakeClient());

    await mgr.connect(adapter, IKEY, PAYLOAD);
    await mgr.disconnect(IKEY, PAYLOAD);

    const snap = await mgr.connect(adapter, IKEY, PAYLOAD);
    expect(snap.connected).toBe(true);
  });

  it('disconnect without prior connect throws session not found', async () => {
    const { mgr } = makeManager();
    await expect(mgr.disconnect(IKEY, PAYLOAD)).rejects.toThrow('native_session_not_found');
  });
});
