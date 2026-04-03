const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'STAIRCASE_MODULE',
  handlerName: 'staircaseHandler',
  automationPath: 'staircase',
});
