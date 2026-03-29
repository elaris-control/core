// src/modules/index.js
// Module metadata registry — imports MODULE definitions from the per-module files in src/modules/.
// Used by the UI (module picker, instance config, nav, etc.).

const { withStandardTestMode } = require('./common');

function tryRequire(path) {
  try { return require(path); } catch (_) { return null; }
}

const { MODULE: SOLAR_MODULE            } = tryRequire('./solar')            || {};
const { MODULE: THERMOSTAT_MODULE       } = tryRequire('./thermostat')       || {};
const { MODULE: LIGHTING_MODULE         } = tryRequire('./lighting')         || {};
const { MODULE: STAIRCASE_MODULE        } = tryRequire('./staircase')        || {};
const { MODULE: AWNING_MODULE           } = tryRequire('./awning')           || {};
const { MODULE: CUSTOM_MODULE           } = tryRequire('./custom')           || {};
const { MODULE: SMART_LIGHTING_MODULE   } = tryRequire('./smart_lighting')   || {};
const { MODULE: ENERGY_MODULE           } = tryRequire('./energy')           || {};
const { MODULE: WATER_MANAGER_MODULE    } = tryRequire('./water_manager')    || {};
const { MODULE: LOAD_SHIFTER_MODULE     } = tryRequire('./load_shifter')     || {};
const { MODULE: PRESENCE_SIMULATOR_MODULE } = tryRequire('./presence_simulator') || {};
const { MODULE: MAINTENANCE_MODULE      } = tryRequire('./maintenance')      || {};
const { MODULE: IRRIGATION_MODULE       } = tryRequire('./irrigation')       || {};
const { MODULE: HYDRONIC_MANAGER_MODULE } = tryRequire('./hydronic_manager') || {};
const { MODULE: POOL_SPA_MODULE         } = tryRequire('./pool_spa')         || {};

function withUi(def, ui) {
  return Object.assign({}, def, {
    ui: Object.assign({
      user_view: false,
      user_control: false,
      user_setpoints: [],
      user_commands: []
    }, def?.ui || {}, ui || {})
  });
}

const CATEGORIES = [
  { id: "hydraulic", label: "Hydraulic / Solar",  icon: "💧" },
  { id: "climate",   label: "Climate Control",     icon: "🌡️" },
  { id: "lighting",  label: "Lighting",            icon: "💡" },
  { id: "shading",   label: "Shading / Blinds",    icon: "🌬️" },
  { id: "custom",    label: "Engineering Rules",   icon: "⚙️" },
  { id: "smart",     label: "Smart Scenes",         icon: "✨" },
  { id: "safety",    label: "Safety & Protection",  icon: "🛡️" },
  { id: "water",     label: "Water / Irrigation",    icon: "🌿" },
];

function normalizeModule(def, ui) {
  return withStandardTestMode(withUi(def, ui));
}

const MODULES = [
  SOLAR_MODULE              && normalizeModule(SOLAR_MODULE,              { user_view: false, user_control: false }),
  THERMOSTAT_MODULE         && normalizeModule(THERMOSTAT_MODULE,         { user_view: true,  user_control: true,  user_setpoints: ['setpoint', 'mode'] }),
  LIGHTING_MODULE           && normalizeModule(LIGHTING_MODULE,           { user_view: true,  user_control: true,  user_commands: ['toggle', 'set_level'] }),
  STAIRCASE_MODULE          && normalizeModule(STAIRCASE_MODULE,          { user_view: true,  user_control: true,  user_commands: ['toggle'] }),
  AWNING_MODULE             && normalizeModule(AWNING_MODULE,             { user_view: true,  user_control: true,  user_commands: ['open', 'close', 'stop'] }),
  CUSTOM_MODULE             && normalizeModule(CUSTOM_MODULE,             { user_view: false, user_control: false }),
  SMART_LIGHTING_MODULE     && normalizeModule(SMART_LIGHTING_MODULE,     { user_view: true,  user_control: true,  user_commands: ['activate_scenario'] }),
  ENERGY_MODULE             && normalizeModule(ENERGY_MODULE,             { user_view: false, user_control: false }),
  WATER_MANAGER_MODULE      && normalizeModule(WATER_MANAGER_MODULE,      { user_view: false, user_control: false }),
  LOAD_SHIFTER_MODULE       && normalizeModule(LOAD_SHIFTER_MODULE,       { user_view: false, user_control: false }),
  PRESENCE_SIMULATOR_MODULE && normalizeModule(PRESENCE_SIMULATOR_MODULE, { user_view: false, user_control: false }),
  MAINTENANCE_MODULE        && normalizeModule(MAINTENANCE_MODULE,        { user_view: false, user_control: false }),
  IRRIGATION_MODULE         && normalizeModule(IRRIGATION_MODULE,         { user_view: false, user_control: false }),
  HYDRONIC_MANAGER_MODULE   && normalizeModule(HYDRONIC_MANAGER_MODULE,   { user_view: false, user_control: false }),
  POOL_SPA_MODULE           && normalizeModule(POOL_SPA_MODULE,           { user_view: false, user_control: false }),
].filter(Boolean);

function getModule(id)    { return MODULES.find(m => m.id === id) || null; }
function listModules()    { return MODULES; }
function listCategories() { return CATEGORIES; }

module.exports = { MODULES, CATEGORIES, getModule, listModules, listCategories };
