const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'MOTION_LIGHT_MODULE',
  handlerName: 'motionLightHandler',
  automationPath: 'motion_light',
});
