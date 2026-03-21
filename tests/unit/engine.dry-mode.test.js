import { describe, it, expect, beforeEach } from 'vitest';
const { AutomationEngine } = require('../../src/automation/engine');

function createFakeDb() {
  const settings = new Map();
  const logs = [];
  const instances = [
    { id: 1, module_id: 'thermostat', site_id: 10, active: 1, name: 'Living Room' }
  ];
  const mappings = [
    { instance_id: 1, input_key: 'ac_relay', io_id: 11, io_key: 'relay1', io_name: 'Relay 1', io_type: 'DO', group_name: 'g1', device_id: 'dev1', unit: null }
  ];
  const ioRows = new Map([[11, { id: 11, key: 'relay1', type: 'DO', device_id: 'dev1' }]]);

  return {
    exec() {},
    prepare(sql) {
      if (sql.includes('FROM module_instances mi')) return { all: () => instances.slice() };
      if (sql.includes('FROM module_mappings mm')) return { all: (instanceId) => mappings.filter(m => m.instance_id === instanceId) };
      if (sql.includes('SELECT * FROM io WHERE id = ?')) return { get: (id) => ioRows.get(id) || null };
      if (sql.includes('SELECT value FROM device_state')) return { get: () => null };
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

describe('AutomationEngine dry mode', () => {
  let broadcastEvents;
  let engine;
  let mqttApi;

  beforeEach(() => {
    broadcastEvents = [];
    engine = new AutomationEngine({ db: createFakeDb(), broadcast: (event) => broadcastEvents.push(event) });
    mqttApi = { sendCommand: () => { throw new Error('should not send real command during dry run'); } };
    engine.setMqttApi(mqttApi);
    engine.setSetting(1, 'test_mode', '1');
  });

  it('intercepts sendCommand and records dry-run activity', () => {
    const instance = engine._getInstances.all()[0];
    const result = engine.sendCommand(instance, 'ac_relay', 1, 'Heat demand');

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.value).toBe('ON');

    const summary = engine.getDryRunLogSummary(1, 20);
    expect(summary.count).toBe(1);
    expect(summary.recent[0]).toMatchObject({
      inputKey: 'ac_relay',
      ioKey: 'relay1',
      value: 'ON',
      reason: 'Heat demand',
      moduleId: 'thermostat',
      siteId: 10,
    });

    expect(broadcastEvents.at(-1)).toMatchObject({
      dry_run: true,
      requested_value: 'ON',
      io_key: 'relay1',
      action: 'ac_relay_DRYRUN_ON',
    });
  });

  it('getLiveStatus exposes recent dry-run commands', () => {
    const instance = engine._getInstances.all()[0];
    engine.sendCommand(instance, 'ac_relay', 'OFF', 'Cooling satisfied');

    const status = engine.getLiveStatus(1);
    expect(status.test_mode).toBe(true);
    expect(status.test_log_count).toBe(1);
    expect(status.test_log_recent[0]).toMatchObject({ value: 'OFF', inputKey: 'ac_relay' });
  });
});
