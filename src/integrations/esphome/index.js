'use strict';

const { initEsphomeRoutes } = require('../../esphome_routes');
const { normalizeNativeImportPayload, importNativeDeviceStep1 } = require('./native_import');

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
    mount(app, ctx) {
      initEsphomeRoutes(app, ctx);
    },
  };
}

module.exports = { createEspHomeAdapter };
