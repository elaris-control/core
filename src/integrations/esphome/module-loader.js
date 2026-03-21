// src/integrations/esphome/module-loader.js
'use strict';

let modulePromise = null;

/**
 * Loads esphome-client (ESM) once and caches the promise.
 * On failure, resets the cache so the next call can retry.
 *
 * @param {Function} [_importFn] - Injectable for testing only. Default: () => import('esphome-client')
 */
async function loadEspHomeClientModule(_importFn) {
  const doImport = typeof _importFn === 'function' ? _importFn : () => import('esphome-client');
  if (!modulePromise) {
    modulePromise = doImport().catch(function (err) {
      modulePromise = null; // C3 fix: allow retry after failure
      var wrapped = new Error('esphome_client_dependency_missing');
      wrapped.cause = err;
      throw wrapped;
    });
  }
  return modulePromise;
}

/** For testing only — resets the module cache between test cases. */
function resetModulePromise() {
  modulePromise = null;
}

module.exports = { loadEspHomeClientModule, resetModulePromise };
