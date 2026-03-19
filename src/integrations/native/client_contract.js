'use strict';

function assertNativeClient(client, integrationKey) {
  if (!client || typeof client !== 'object') throw new Error(`native_client_invalid:${integrationKey || 'unknown'}`);
  if (typeof client.connect !== 'function') throw new Error(`native_client_missing_connect:${integrationKey || 'unknown'}`);
  if (typeof client.refresh !== 'function') throw new Error(`native_client_missing_refresh:${integrationKey || 'unknown'}`);
  if (typeof client.disconnect !== 'function') throw new Error(`native_client_missing_disconnect:${integrationKey || 'unknown'}`);
  if (client.executeCommand != null && typeof client.executeCommand !== 'function') throw new Error(`native_client_invalid_execute_command:${integrationKey || 'unknown'}`);
  if (client.onUpdate != null && typeof client.onUpdate !== 'function') throw new Error(`native_client_invalid_onUpdate:${integrationKey || 'unknown'}`);
  return client;
}

module.exports = { assertNativeClient };
