const crypto = require('crypto');

function safeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseGpio(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value);
  const raw = String(value).trim().replace(/^['"]|['"]$/g, '');
  let m = raw.match(/^GPIO\s*([0-9]+)$/i);
  if (m) return Number(m[1]);
  m = raw.match(/^([0-9]+)$/);
  if (m) return Number(m[1]);
  return null;
}

function toGpioLabel(n) {
  return `GPIO${Number(n)}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort(), 2);
}

function normalizeIntegrationKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw || 'esphome';
}

function normalizeOwnershipMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'external_readonly' || raw === 'external_native' || raw === 'managed_internal') return raw;
  return 'managed_internal';
}

function normalizeConfigSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['board_profile', 'use_my_yaml_overlay', 'ota_managed_edit', 'external_yaml', 'native_api', 'saved_config'].includes(raw)) return raw;
  return 'board_profile';
}

function normalizeReadOnly(value, ownershipMode) {
  if (value === true || value === 1 || String(value).trim() === '1') return 1;
  if (ownershipMode === 'external_readonly') return 1;
  return 0;
}

function normalizeEntity(raw, index) {
  const type = String(raw?.type || '').trim().toLowerCase();
  const name = String(raw?.name || `Entity ${index + 1}`).trim() || `Entity ${index + 1}`;
  const key = safeName(raw?.key || name || `entity_${index + 1}`) || `entity_${index + 1}`;
  const source = String(raw?.source || raw?.pin || raw?.port_id || raw?.bus_id || '').trim();
  const pin = String(raw?.pin || '').trim();
  const portId = String(raw?.port_id || '').trim();
  const busId = String(raw?.bus_id || '').trim();
  const address = String(raw?.address || '').trim();
  return {
    type,
    name,
    key,
    pin,
    source,
    port_id: portId || null,
    bus_id: busId || null,
    address: address || null,
    unit: raw?.unit || null,
    device_class: raw?.device_class || null,
    subtype: raw?.subtype || null,
    template_id: raw?.template_id || null,
    scale: raw?.scale || null,
    scale_factor: raw?.scale_factor || null,
    scale_unit: raw?.scale_unit || null,
    metadata: raw?.metadata || null,
  };
}

function normalizePayload(body) {
  return {
    site_id: Number(body?.site_id || 1),
    device_name: String(body?.device_name || '').trim(),
    board_profile_id: String(body?.board_profile_id || body?.board_id || '').trim(),
    board_custom: String(body?.board_custom || '').trim(),
    wifi_ssid: String(body?.wifi_ssid || '').trim(),
    wifi_pass: String(body?.wifi_pass || ''),
    use_ethernet: !!body?.use_ethernet,
    mqtt_host: String(body?.mqtt_host || '').trim(),
    port: String(body?.port || '').trim(),
    framework: String(body?.framework || '').trim() || null,
    client_id: String(body?.client_id || '').trim() || null,
    existing_device_id: Number(body?.existing_device_id) || null,
    integration_key: normalizeIntegrationKey(body?.integration_key),
    ownership_mode: normalizeOwnershipMode(body?.ownership_mode),
    config_source: normalizeConfigSource(body?.config_source),
    read_only: normalizeReadOnly(body?.read_only, normalizeOwnershipMode(body?.ownership_mode)),
    entities: Array.isArray(body?.entities) ? body.entities.map(normalizeEntity) : [],
  };
}

module.exports = {
  safeName,
  parseGpio,
  toGpioLabel,
  sha256,
  stableStringify,
  normalizeEntity,
  normalizePayload,
  normalizeIntegrationKey,
  normalizeOwnershipMode,
  normalizeConfigSource,
  normalizeReadOnly,
};
