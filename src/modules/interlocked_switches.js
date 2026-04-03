const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'INTERLOCKED_SWITCHES_MODULE',
  handlerName: 'interlockedSwitchesHandler',
  automationPath: 'interlocked_switches',
});
