// tests/unit/native/module-loader.test.js
'use strict';

import { describe, it, expect, beforeEach } from 'vitest';
const { loadEspHomeClientModule, resetModulePromise } = require('../../../src/integrations/esphome/module-loader');

describe('loadEspHomeClientModule', () => {
  beforeEach(() => {
    resetModulePromise(); // ensure clean state between tests
  });

  it('resets modulePromise on failure so a retry is possible (C3)', async () => {
    let callCount = 0;
    const fakeImport = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('dependency not installed'));
      return Promise.resolve({ EspHomeClient: class {} });
    };

    // First call: should reject
    await expect(loadEspHomeClientModule(fakeImport)).rejects.toThrow('esphome_client_dependency_missing');

    // Reset between calls is automatic (C3 fix) — no manual reset needed here
    // Second call: should succeed
    const mod = await loadEspHomeClientModule(fakeImport);
    expect(mod).toBeDefined();
    expect(callCount).toBe(2); // import was called twice (no stuck promise)
  });

  it('caches the result on success — import called only once', async () => {
    let callCount = 0;
    const fakeImport = () => {
      callCount++;
      return Promise.resolve({ EspHomeClient: class {} });
    };

    await loadEspHomeClientModule(fakeImport);
    await loadEspHomeClientModule(fakeImport);
    await loadEspHomeClientModule(fakeImport);

    expect(callCount).toBe(1); // module loaded once, promise cached
  });

  it('wraps import error with esphome_client_dependency_missing', async () => {
    const cause = new Error('Cannot find module');
    const fakeImport = () => Promise.reject(cause);

    const err = await loadEspHomeClientModule(fakeImport).catch(e => e);
    expect(err.message).toBe('esphome_client_dependency_missing');
    expect(err.cause).toBe(cause);
  });
});
