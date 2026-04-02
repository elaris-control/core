'use strict';

const ELARIS_PREFIX = 'elaris';

const ELARIS_SUBSCRIPTIONS = [
  `${ELARIS_PREFIX}/+/config`,
  `${ELARIS_PREFIX}/+/tele/+`,
  `${ELARIS_PREFIX}/+/state/+`,
  `${ELARIS_PREFIX}/+/cmnd/+`,
];

const ESPHOME_STANDARD_SUBSCRIPTIONS = [
  '+/status',
  '+/switch/+/state',
  '+/binary_sensor/+/state',
  '+/sensor/+/state',
  '+/text_sensor/+/state',
];

const ALL_SUBSCRIPTIONS = [...ELARIS_SUBSCRIPTIONS, ...ESPHOME_STANDARD_SUBSCRIPTIONS];

const ESPHOME_COMPONENT_TYPES = ['switch', 'binary_sensor', 'sensor', 'text_sensor'];

const IDENTITY_SENSOR_KEYS = new Set([
  'mac_address', 'mac', 'ip_address', 'ip', 'version',
  'esphome_version', 'firmware_version',
]);

function isIdentitySensorKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (IDENTITY_SENSOR_KEYS.has(k)) return true;
  if (k.endsWith('_mac_address') || k.endsWith('_ip') || k.endsWith('_ip_address')) return true;
  return false;
}

function elarisTopic(deviceId, group, key) {
  return `${ELARIS_PREFIX}/${deviceId}/${group}/${key}`;
}

function elarisConfigTopic(deviceId) {
  return `${ELARIS_PREFIX}/${deviceId}/config`;
}

function elarisCommandTopic(deviceId, key) {
  return `${ELARIS_PREFIX}/${deviceId}/cmnd/${key}`;
}

function elarisStateTopic(deviceId, key) {
  return `${ELARIS_PREFIX}/${deviceId}/state/${key}`;
}

function elarisTeleTopic(deviceId, key) {
  return `${ELARIS_PREFIX}/${deviceId}/tele/${key}`;
}

module.exports = {
  ELARIS_PREFIX,
  ELARIS_SUBSCRIPTIONS,
  ESPHOME_STANDARD_SUBSCRIPTIONS,
  ALL_SUBSCRIPTIONS,
  ESPHOME_COMPONENT_TYPES,
  IDENTITY_SENSOR_KEYS,
  isIdentitySensorKey,
  elarisTopic,
  elarisConfigTopic,
  elarisCommandTopic,
  elarisStateTopic,
  elarisTeleTopic,
};
