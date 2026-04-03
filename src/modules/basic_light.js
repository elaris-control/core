const { createLightModule } = require('./light_module_factory');

module.exports = createLightModule({
  moduleId: 'BASIC_LIGHT_MODULE',
  handlerName: 'basicLightHandler',
  automationPath: 'basic_light',
});
