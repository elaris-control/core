// src/modules/common.js
// Shared helpers for normalizing module definitions and standard capabilities.

const TEST_MODE_SETPOINT = Object.freeze({
  group: 'basic',
  key: 'test_mode',
  label: 'Test mode (dry run)',
  type: 'select',
  default: '0',
  options: ['0', '1'],
  help: 'Logic runs normally but real outputs are intercepted by the engine.'
});

function cloneSetpoint(sp) {
  return Object.assign({}, sp || {});
}

function withStandardTestMode(def) {
  if (!def) return def;
  const capabilities = Object.assign({}, def.capabilities || {});
  if (capabilities.test_mode === false) {
    return Object.assign({}, def, { capabilities });
  }

  const setpoints = Array.isArray(def.setpoints) ? def.setpoints.map(cloneSetpoint) : [];
  const existingIdx = setpoints.findIndex(sp => String(sp?.key || '') === 'test_mode');

  if (existingIdx >= 0) {
    setpoints[existingIdx] = Object.assign({}, TEST_MODE_SETPOINT, setpoints[existingIdx]);
  } else {
    setpoints.push(cloneSetpoint(TEST_MODE_SETPOINT));
  }

  capabilities.test_mode = true;
  return Object.assign({}, def, { capabilities, setpoints });
}

const OUTPUT_TYPES = ['DO', 'AO', 'RELAY', 'DIMMER', 'OUTPUT', 'DIGITAL_OUTPUT', 'ANALOG_OUTPUT'];
const ANALOG_TYPES = ['AO', 'DIMMER', 'ANALOG', 'PWM', 'ANALOG_OUTPUT'];

function isOutputType(type) {
  return OUTPUT_TYPES.includes(String(type).toUpperCase());
}

function isAnalogType(type) {
  return ANALOG_TYPES.includes(String(type).toUpperCase());
}

async function releaseOutputIO(io, { getIOById, sendIOCommand, getMappingsByIO }) {
  if (!io) return;
  if (!isOutputType(io.type)) return;
  const refCount = (getMappingsByIO?.(io.id) || []).length;
  if (refCount > 0) return;
  const safeValue = isAnalogType(io.type) ? '0' : 'OFF';
  try { await sendIOCommand(io.id, safeValue); } catch (_) {}
}

module.exports = {
  TEST_MODE_SETPOINT,
  withStandardTestMode,
  OUTPUT_TYPES,
  ANALOG_TYPES,
  isOutputType,
  isAnalogType,
  releaseOutputIO,
};
