import { describe, it, expect, beforeEach } from 'vitest';
import engineModule from '../../src/automation/engine.js';
import thermostatModule from '../../src/automation/thermostat.js';

const { AutomationEngine } = engineModule;
const { thermostatHandler } = thermostatModule;

function createFakeDb() {
  const settings = new Map();
  const logs = [];
  const instances = [
    { id: 1, module_id: 'thermostat', site_id: 10, active: 1, name: 'Living Room' }
  ];
  const mappings = [
    { instance_id: 1, input_key: 'temp_room', io_id: 10, io_key: 'temp_room', io_name: 'Room Temp', io_type: 'AI', group_name: 'g1', device_id: 'sensor1', unit: '°C' },
    { instance_id: 1, input_key: 'ac_relay', io_id: 11, io_key: 'relay1', io_name: 'Relay 1', io_type: 'DO', group_name: 'g1', device_id: 'dev1', unit: null }
  ];
  const ioRows = new Map([
    [10, { id: 10, key: 'temp_room', type: 'AI', device_id: 'sensor1' }],
    [11, { id: 11, key: 'relay1', type: 'DO', device_id: 'dev1' }],
  ]);
  const deviceState = new Map([[ 'sensor1:temp_room', '19' ], [ 'dev1:relay1', 'OFF' ]]);

  return {
    exec() {},
    prepare(sql) {
      if (sql.includes('FROM module_instances mi')) return { all: () => instances.slice() };
      if (sql.includes('FROM module_mappings mm')) return { all: (instanceId) => mappings.filter(m => m.instance_id === instanceId) };
      if (sql.includes('SELECT * FROM io WHERE id = ?')) return { get: (id) => ioRows.get(id) || null };
      if (sql.includes('SELECT value FROM device_state')) return { get: (deviceId, key) => deviceState.has(`${deviceId}:${key}`) ? { value: deviceState.get(`${deviceId}:${key}`) } : null };
      if (sql.includes('SELECT value FROM module_settings')) return { get: (instanceId, key) => settings.has(`${instanceId}:${key}`) ? { value: settings.get(`${instanceId}:${key}`) } : undefined };
      if (sql.includes('INSERT INTO module_settings')) return { run: ({ instance_id, key, value }) => settings.set(`${instance_id}:${key}`, String(value)) };
      if (sql.includes('INSERT INTO automation_log')) return { run: (row) => logs.push(row) };
      if (sql.includes('INSERT INTO module_runtime_overrides')) return { run() {} };
      if (sql.includes('DELETE FROM module_runtime_overrides')) return { run() {} };
      if (sql.includes('SELECT * FROM module_runtime_overrides')) return { all: () => [] };
      if (sql.includes('INSERT INTO io_runtime_overrides')) return { run() {} };
      if (sql.includes('DELETE FROM io_runtime_overrides')) return { run() {} };
      if (sql.includes('SELECT * FROM io_runtime_overrides')) return { all: () => [] };
      if (sql.includes('SELECT key, value FROM module_settings')) return { all: (instanceId) => Array.from(settings.entries()).filter(([k]) => k.startsWith(`${instanceId}:`)).map(([k, value]) => ({ key: k.split(':')[1], value })) };
      if (sql.includes('SELECT * FROM automation_log')) return { all: (instanceId, limit) => logs.filter(x => x.instance_id === instanceId).slice(-limit).reverse() };
      throw new Error(`Unhandled SQL in test fake DB: ${sql}`);
    }
  };
}

describe('thermostat + engine dry mode integration', () => {
  let broadcastEvents;
  let engine;

  beforeEach(() => {
    broadcastEvents = [];
    engine = new AutomationEngine({ db: createFakeDb(), broadcast: (event) => broadcastEvents.push(event) });
    engine.setMqttApi({
      sendCommand() {
        throw new Error('should not send real command during dry run');
      }
    });
    engine.register('thermostat', thermostatHandler);
    engine.setSetting(1, 'test_mode', '1');
    engine.setSetting(1, 'mode', 'heating');
    engine.setSetting(1, 'setpoint', '21');
    engine.setSetting(1, 'hysteresis', '0.5');
    engine.setSetting(1, 'min_run_time', '0');
    engine.setSetting(1, 'min_off_time', '0');
    engine.clearDryRunLog(1);
  });

  it('evaluates thermostat demand through engine and intercepts the output in dry mode', () => {
    const instance = engine._getInstances.all()[0];

    engine.evaluate(instance);

    const status = engine.getLiveStatus(1);
    expect(status.test_mode).toBe(true);
    expect(status.test_log_count).toBe(1);
    expect(status.test_log_recent[0]).toMatchObject({
      inputKey: 'ac_relay',
      ioKey: 'relay1',
      value: 'ON',
      moduleId: 'thermostat',
      siteId: 10,
    });

    expect(broadcastEvents.at(-1)).toMatchObject({
      module: 'thermostat',
      instance: 1,
      action: 'ac_relay_DRYRUN_ON',
      dry_run: true,
      requested_value: 'ON',
      io_key: 'relay1',
    });
  });
});
