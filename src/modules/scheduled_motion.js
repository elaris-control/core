const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'SCHEDULED_MOTION_MODULE',
  handlerName: 'scheduledMotionHandler',
  automationPath: 'scheduled_motion',
});
