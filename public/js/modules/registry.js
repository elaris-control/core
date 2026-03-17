// public/js/modules/registry.js
// Module registry — each module registers itself here.
// Core dispatch functions use the registry instead of if/else chains.
// To add a new module: create public/js/modules/mod_yourmodule.js and call registerModule().

window.ModuleRegistry = {};

window.registerModule = function(id, def) {
  window.ModuleRegistry[id] = def;
};
