const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'SCHEDULED_LIGHT_MODULE',
  handlerName: 'scheduledLightHandler',
  automationPath: 'scheduled_light',
});
