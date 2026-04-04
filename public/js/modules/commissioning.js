// public/js/modules/commissioning.js
// Generic commissioning dispatcher — data-driven, no if/else chains.
// Each module registers its analyzer via ModuleRegistry[moduleId].analyzeMappings

const COMMISSIONING_REGISTRY = {};

function registerCommissioning(moduleId, title, analyzeFn) {
  COMMISSIONING_REGISTRY[moduleId] = { title, analyze: analyzeFn };
}

function runCommissioningCheck(moduleId, mappings) {
  const entry = COMMISSIONING_REGISTRY[moduleId];
  if (!entry) return null;
  const analysis = entry.analyze(mappings);
  const blocking = analysis.issues.filter(i => i.severity === 'bad' || i.severity === 'warn');
  if (!blocking.length) return null;
  const msg = blocking.map(i => '  ' + String(i.message).replace(/<[^>]+>/g, '')).join('\n');
  return confirm(`${entry.title} commissioning check:\n\n${msg}\n\nSave anyway?`);
}

// Auto-register from ModuleRegistry when mod_*.js files call registerModule
const _origRegisterModule = window.registerModule;
window.registerModule = function(id, def) {
  if (_origRegisterModule) _origRegisterModule(id, def);
  // If the module has an analyze function, auto-register commissioning
  const analyzeFn = window['analyze' + id.replace(/_/g, '_').replace(/^./, c => c.toUpperCase()) + 'Mappings'];
  if (typeof analyzeFn === 'function') {
    const titleMap = {
      thermostat: 'Thermostat',
      lighting: 'Lighting',
      solar: 'Solar',
      energy: 'Energy Monitor',
      smart_lighting: 'Smart Lighting',
      load_shifter: 'Load Shifter',
      presence_simulator: 'Presence Simulator',
      irrigation: 'Irrigation',
      pool_spa: 'Pool & Spa',
      hydronic_manager: 'Hydronic',
      basic_light: 'Basic Light',
      motion_light: 'Motion Light',
      daylight_light: 'Daylight Light',
      scheduled_light: 'Scheduled Light',
      motion_daylight: 'Motion + Daylight',
      scheduled_motion: 'Scheduled + Motion',
    };
    registerCommissioning(id, titleMap[id] || id, analyzeFn);
  }
};
