'use strict';

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('integration_adapter_invalid');
  const key = String(adapter.key || '').trim();
  if (!key) throw new Error('integration_adapter_missing_key');
  if (typeof adapter.mount !== 'function') throw new Error(`integration_adapter_${key}_missing_mount`);
  return { ...adapter, key };
}

function createIntegrationRegistry() {
  const map = new Map();

  function register(adapter) {
    const checked = assertAdapter(adapter);
    if (map.has(checked.key)) throw new Error(`integration_adapter_duplicate:${checked.key}`);
    map.set(checked.key, checked);
    return checked;
  }

  function get(key) {
    const want = String(key || '').trim();
    return want ? (map.get(want) || null) : null;
  }

  function list() {
    return Array.from(map.values()).map((adapter) => ({
      key: adapter.key,
      title: String(adapter.title || adapter.key),
      kind: String(adapter.kind || 'runtime'),
      description: String(adapter.description || '').trim() || null,
      supportsProfiles: !!adapter.supportsProfiles,
      supportsImports: !!adapter.supportsImports,
      supportsProvisioning: !!adapter.supportsProvisioning,
      supportsStateSync: !!adapter.supportsStateSync,
      supportsNativeApi: !!adapter.supportsNativeApi,
      supportsNativeSessions: !!adapter.supportsNativeSessions,
    }));
  }

  function mountAll(app, ctx) {
    for (const adapter of map.values()) {
      adapter.mount(app, { ...(ctx || {}), integrationRegistry: api, integrationKey: adapter.key });
    }
  }

  const api = { register, get, list, mountAll };
  return api;
}

module.exports = { createIntegrationRegistry, assertAdapter };
