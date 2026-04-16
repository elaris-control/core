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

const HA_DISCOVERY_PREFIX = 'homeassistant';
const HA_DISCOVERY_SUBSCRIPTION = 'homeassistant/#';

// MVP scope: components that map cleanly to ELARIS IO semantics.
const HA_SUPPORTED_COMPONENTS = new Set([
  'sensor', 'binary_sensor', 'switch', 'number',
  'light', 'fan', 'cover', 'climate',
]);

// Maps HA component type -> io group_name
const HA_COMPONENT_GROUP = {
  sensor: 'tele', binary_sensor: 'tele', climate: 'tele',
  switch: 'state', number: 'state', light: 'state', fan: 'state', cover: 'state',
};

// Maps HA component type -> ELARIS io type
// cover -> di (read-only: open/closed state, no command support)
// climate -> sensor (current_temperature state, mode_command_topic for basic control)
const HA_COMPONENT_TYPE = {
  sensor: 'sensor',
  binary_sensor: 'di',
  switch: 'relay',
  number: 'ao',
  light: 'relay',
  fan: 'relay',
  cover: 'di',
  climate: 'sensor',
};

const ALL_SUBSCRIPTIONS = [...ELARIS_SUBSCRIPTIONS, ...ESPHOME_STANDARD_SUBSCRIPTIONS, HA_DISCOVERY_SUBSCRIPTION];

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
  HA_DISCOVERY_PREFIX,
  HA_DISCOVERY_SUBSCRIPTION,
  HA_SUPPORTED_COMPONENTS,
  HA_COMPONENT_GROUP,
  HA_COMPONENT_TYPE,
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
