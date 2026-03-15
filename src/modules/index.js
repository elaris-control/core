// src/modules/index.js
// Module metadata registry — imports MODULE definitions from the per-module files in src/modules/.
// Used by the UI (module picker, instance config, nav, etc.).

function tryRequire(path) {
  try { return require(path); } catch (_) { return null; }
}

const { MODULE: SOLAR_MODULE            } = tryRequire('./solar')            || {};
const { MODULE: THERMOSTAT_MODULE       } = tryRequire('./thermostat')       || {};
const { MODULE: LIGHTING_MODULE         } = tryRequire('./lighting')         || {};
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

const MODULES = [
  SOLAR_MODULE              && withUi(SOLAR_MODULE,              { user_view: false, user_control: false }),
  THERMOSTAT_MODULE         && withUi(THERMOSTAT_MODULE,         { user_view: true,  user_control: true,  user_setpoints: ['setpoint', 'mode'] }),
  LIGHTING_MODULE           && withUi(LIGHTING_MODULE,           { user_view: true,  user_control: true,  user_commands: ['toggle', 'set_level'] }),
  AWNING_MODULE             && withUi(AWNING_MODULE,             { user_view: true,  user_control: true,  user_commands: ['open', 'close', 'stop'] }),
  CUSTOM_MODULE             && withUi(CUSTOM_MODULE,             { user_view: false, user_control: false }),
  SMART_LIGHTING_MODULE     && withUi(SMART_LIGHTING_MODULE,     { user_view: true,  user_control: true,  user_commands: ['activate_scenario'] }),
  ENERGY_MODULE             && withUi(ENERGY_MODULE,             { user_view: false, user_control: false }),
  WATER_MANAGER_MODULE      && withUi(WATER_MANAGER_MODULE,      { user_view: false, user_control: false }),
  LOAD_SHIFTER_MODULE       && withUi(LOAD_SHIFTER_MODULE,       { user_view: false, user_control: false }),
  PRESENCE_SIMULATOR_MODULE && withUi(PRESENCE_SIMULATOR_MODULE, { user_view: false, user_control: false }),
  MAINTENANCE_MODULE        && withUi(MAINTENANCE_MODULE,        { user_view: false, user_control: false }),
  IRRIGATION_MODULE         && withUi(IRRIGATION_MODULE,         { user_view: false, user_control: false }),
  HYDRONIC_MANAGER_MODULE   && withUi(HYDRONIC_MANAGER_MODULE,   { user_view: false, user_control: false }),
  POOL_SPA_MODULE           && withUi(POOL_SPA_MODULE,           { user_view: false, user_control: false }),
].filter(Boolean);

function getModule(id)    { return MODULES.find(m => m.id === id) || null; }
function listModules()    { return MODULES; }
function listCategories() { return CATEGORIES; }

module.exports = { MODULES, CATEGORIES, getModule, listModules, listCategories };
