const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'DAYLIGHT_LIGHT_MODULE',
  handlerName: 'daylightLightHandler',
  automationPath: 'daylight_light',
});
