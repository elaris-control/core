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
  const m = String(value).trim().match(/^GPIO\s*([0-9]+)$/i);
  if (!m) return null;
  return Number(m[1]);
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

function normalizeEntity(raw, index) {
  const type = String(raw?.type || '').trim().toLowerCase();
  const name = String(raw?.name || `Entity ${index + 1}`).trim() || `Entity ${index + 1}`;
  const key = safeName(raw?.key || name || `entity_${index + 1}`) || `entity_${index + 1}`;
  const pin = String(raw?.pin || raw?.source || '').trim();
  return {
    type,
    name,
    key,
    pin,
    source: pin,
    unit: raw?.unit || null,
    device_class: raw?.device_class || null,
    subtype: raw?.subtype || null,
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
};
