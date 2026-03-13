// src/modules/index.js
// Module metadata registry — imports MODULE definitions from the per-module files in src/modules/.
// Used by the UI (module picker, instance config, nav, etc.).

const { MODULE: SOLAR_MODULE            } = require('./solar');
const { MODULE: THERMOSTAT_MODULE       } = require('./thermostat');
const { MODULE: LIGHTING_MODULE         } = require('./lighting');
const { MODULE: AWNING_MODULE           } = require('./awning');
const { MODULE: CUSTOM_MODULE           } = require('./custom');
const { MODULE: SMART_LIGHTING_MODULE   } = require('./smart_lighting');
const { MODULE: ENERGY_MODULE           } = require('./energy');
const { MODULE: WATER_MANAGER_MODULE    } = require('./water_manager');
const { MODULE: LOAD_SHIFTER_MODULE     } = require('./load_shifter');
const { MODULE: PRESENCE_SIMULATOR_MODULE } = require('./presence_simulator');
const { MODULE: MAINTENANCE_MODULE      } = require('./maintenance');
const { MODULE: IRRIGATION_MODULE       } = require('./irrigation');
const { MODULE: HYDRONIC_MANAGER_MODULE } = require('./hydronic_manager');
const { MODULE: POOL_SPA_MODULE         } = require('./pool_spa');

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
  withUi(SOLAR_MODULE,              { user_view: false, user_control: false }),
  withUi(THERMOSTAT_MODULE,         { user_view: true,  user_control: true,  user_setpoints: ['setpoint', 'mode'] }),
  withUi(LIGHTING_MODULE,           { user_view: true,  user_control: true,  user_commands: ['toggle', 'set_level'] }),
  withUi(AWNING_MODULE,             { user_view: true,  user_control: true,  user_commands: ['open', 'close', 'stop'] }),
  withUi(CUSTOM_MODULE,             { user_view: false, user_control: false }),
  withUi(SMART_LIGHTING_MODULE,     { user_view: true,  user_control: true,  user_commands: ['activate_scenario'] }),
  withUi(ENERGY_MODULE,             { user_view: false, user_control: false }),
  withUi(WATER_MANAGER_MODULE,      { user_view: false, user_control: false }),
  withUi(LOAD_SHIFTER_MODULE,       { user_view: false, user_control: false }),
  withUi(PRESENCE_SIMULATOR_MODULE, { user_view: false, user_control: false }),
  withUi(MAINTENANCE_MODULE,        { user_view: false, user_control: false }),
  withUi(IRRIGATION_MODULE,         { user_view: false, user_control: false }),
  withUi(HYDRONIC_MANAGER_MODULE,   { user_view: false, user_control: false }),
  withUi(POOL_SPA_MODULE,           { user_view: false, user_control: false })
];

function getModule(id)    { return MODULES.find(m => m.id === id) || null; }
function listModules()    { return MODULES; }
function listCategories() { return CATEGORIES; }

module.exports = { MODULES, CATEGORIES, getModule, listModules, listCategories };
