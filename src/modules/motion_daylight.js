const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'MOTION_DAYLIGHT_MODULE',
  handlerName: 'motionDaylightHandler',
  automationPath: 'motion_daylight',
});
