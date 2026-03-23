'use strict';

const { initEsphomeRoutes } = require('../../esphome_routes');
const { normalizeNativeImportPayload, importNativeDeviceStep1 } = require('./native_import');
const { probeNativeDevice, discoverNativeAssist, syncNativeAssist } = require('./native_live');
const { createEspHomeNativeClient } = require('./native_client');

function createEspHomeAdapter() {
  return {
    key: 'esphome',
    title: 'ESPHome',
    kind: 'compiler_runtime',
    description: 'Managed compiler/runtime adapter for ESPHome boards, YAML overlays, OTA edits, and board profiles.',
    supportsProfiles: true,
    supportsImports: true,
    supportsProvisioning: true,
    supportsStateSync: true,
    supportsNativeApi: true,
    supportsNativeSessions: true,
    ownershipDefaults(payload = {}) {
      return {
        integration_key: 'esphome',
        ownership_mode: payload.ownership_mode || 'managed_internal',
        config_source: payload.config_source || 'board_profile',
        read_only: payload.read_only == null ? 0 : payload.read_only,
      };
    },
    normalizeNativeImportPayload(payload = {}) {
      return normalizeNativeImportPayload({ ...payload, integration_key: 'esphome' });
    },
    importNative(ctx = {}, payload = {}) {
      return importNativeDeviceStep1(ctx.db, { ...payload, integration_key: 'esphome' });
    },
    async probeNative(ctx = {}, payload = {}) {
      return probeNativeDevice(ctx.db, { ...payload, integration_key: 'esphome' });
    },
    discoverNative(ctx = {}, payload = {}) {
      // Find live session entities for this device if nativeSessions is available
      var liveSession = null;
      if (ctx.nativeSessions && typeof ctx.nativeSessions.list === 'function') {
        var wantedName = String(payload.device_name || '').trim().toLowerCase();
        var sessions = ctx.nativeSessions.list('esphome') || [];
        liveSession = sessions.find(function(s) {
          return wantedName && String(s.device_name || '').trim().toLowerCase() === wantedName;
        }) || null;
      }
      return discoverNativeAssist(ctx.db, { ...payload, integration_key: 'esphome', native_session: liveSession || payload.native_session }, { profileAssist: false });
    },
    syncNative(ctx = {}, payload = {}) {
      return syncNativeAssist(ctx.db, { ...payload, integration_key: 'esphome' });
    },
    createNativeClient(ctx = {}, payload = {}) {
      return createEspHomeNativeClient(ctx, { ...payload, integration_key: 'esphome' });
    },
    mount(app, ctx) {
      initEsphomeRoutes(app, ctx);
    },
  };
}

module.exports = { createEspHomeAdapter };
