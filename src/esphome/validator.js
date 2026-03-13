const { parseGpio, toGpioLabel } = require('./schema');

function validateConfig({ profile, payload }) {
  const errors = [];
  const warnings = [];
  const entities = payload.entities || [];
  const usedRawGpios = new Map();

  if (!payload.device_name) errors.push('Device name is required.');
  if (!profile) errors.push('Board profile is required.');
  if (!payload.mqtt_host) errors.push('MQTT broker IP is required.');
  if (!payload.use_ethernet && profile?.supports?.wifi === false) {
    errors.push('This board profile is Ethernet-first. Enable Ethernet for first install.');
  }
  if (payload.use_ethernet && profile?.supports?.ethernet === false) {
    errors.push('Selected board profile does not support Ethernet.');
  }
  if (!payload.use_ethernet && profile?.supports?.wifi !== false && !payload.wifi_ssid) {
    errors.push('WiFi SSID is required when Ethernet is disabled.');
  }

  for (const entity of entities) {
    if (!entity.type) errors.push(`Entity "${entity.name}" is missing a type.`);
    if (!entity.name) errors.push('Each entity needs a name.');
    const resolved = profile?.resolveSource ? profile.resolveSource(entity.source) : null;
    if (resolved?.pin) entity._resolvedPin = resolved.pin;
    if (resolved?.pcf8574) {
      entity._resolvedExpander = resolved;
      continue;
    }

    const rawPinText = resolved?.pin || entity.pin || entity.source;
    const gpio = parseGpio(rawPinText);
    if (gpio === null) {
      errors.push(`Entity "${entity.name}" uses invalid source "${entity.source || entity.pin || ''}". Use a valid GPIO like GPIO26 or a board channel like OUT1/IN1.`);
      continue;
    }

    const key = `GPIO${gpio}`;
    if (!usedRawGpios.has(key)) usedRawGpios.set(key, []);
    usedRawGpios.get(key).push(entity.name);

    const rules = profile?.pinRules || {};
    if ((rules.flashPins || []).includes(gpio)) errors.push(`${entity.name}: ${toGpioLabel(gpio)} is a flash pin and cannot be used.`);
    if ((rules.reserved || []).includes(gpio)) errors.push(`${entity.name}: ${toGpioLabel(gpio)} is reserved by the board/profile.`);
    if (entity.type === 'relay' && (rules.inputOnly || []).includes(gpio)) errors.push(`${entity.name}: ${toGpioLabel(gpio)} is input-only and cannot be used as output.`);
    if ((rules.noPullup || []).includes(gpio) && entity.type === 'di') warnings.push(`${entity.name}: ${toGpioLabel(gpio)} has no internal pull-up; generator will use plain INPUT.`);
    if ((rules.strapping || []).includes(gpio)) warnings.push(`${entity.name}: ${toGpioLabel(gpio)} is a strapping pin; use with care.`);
  }

  for (const [gpio, names] of usedRawGpios.entries()) {
    if (names.length > 1) errors.push(`${gpio} is assigned more than once: ${names.join(', ')}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
  };
}

module.exports = { validateConfig };
