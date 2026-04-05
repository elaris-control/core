// src/automation/staircase.js
// 🏢 Staircase lighting — multiple button inputs + PIR with common off timer

const holdUntil = new Map();
const switchSeen = new Map(); // instId -> {switch_di:'0', switch_di_2:'0', ...}
const pirSeen = new Map();
const manualState = new Map();
const holdLastBroadcast = new Map(); // instId -> bucket (avoid spam on every tick)
const lastSwitchActivity = new Map(); // instId -> timestamp (for reconnect gap detection)

function slugifyActionPart(input, fallback = 'Staircase') {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const slug = raw
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function actionName(ctx, source, on) {
  const instName = slugifyActionPart(ctx?.instance?.name || 'Staircase', 'Staircase');
  const src = slugifyActionPart(source || 'Timer', 'Timer');
  return `${instName}_${src}_Calling_${on ? 'ON' : 'OFF'}`;
}

function relayKeys(ctx) {
  return ['light_relay','light_relay_2','light_relay_3','light_relay_4'].filter(k => !!ctx.io(k));
}

function setRelays(send, ctx, on, reason, source) {
  const keys = relayKeys(ctx);
  let logged = false;
  const action = actionName(ctx, source, !!on);
  keys.forEach(k => {
    if (!logged) {
      send(k, on ? 'ON' : 'OFF', reason, { action });
      logged = true;
    } else {
      send(k, on ? 'ON' : 'OFF', reason, { skipLog: true });
    }
  });
}

function isTruthyState(v) {
  return v === 'ON' || v === '1' || v === 'true' || v === 1 || v === true;
}

function broadcastState(ctx, extra) {
  try {
    const on = relayKeys(ctx).some(k => ctx.isOn(k));
    ctx.broadcastState?.(Object.assign({
      source: null,
      output_on: !!on,
      status: on ? 'on' : 'off',
      motion_active: false,
      manual_active: false,
      timer_remaining_s: 0,
      switches: 0,
      last_reason: null,
    }, extra || {}));
  } catch {}
}

function staircaseHandler(ctx, send) {
  const instId = ctx.instance.id;
  const now = Date.now();
  const timerMs = Math.max(1, Number(ctx.setting('timer_off_s', 60))) * 1000;

  const swMap = switchSeen.get(instId) || {};
  const switchKeys = ['switch_di','switch_di_2','switch_di_3','switch_di_4'];
  let switchTriggered = false;
  let triggerSource = '';

  const lastActivity = lastSwitchActivity.get(instId) || 0;

  for (const key of switchKeys) {
    if (!ctx.io(key)) continue;
    const cur = ctx.state(key);
    const prev = swMap[key];
    swMap[key] = cur;
    const curOn = isTruthyState(cur);
    const prevOn = isTruthyState(prev);
    // Rising edge only — prevOn !== undefined prevents false trigger on first init / reconnect
    if (curOn && prevOn !== undefined && !prevOn) {
      switchTriggered = true;
      triggerSource = key;
    }
  }
  switchSeen.set(instId, swMap);
  if (switchTriggered) {
    lastSwitchActivity.set(instId, now);
  }

  const pirState = ctx.io('pir_sensor') ? ctx.state('pir_sensor') : null;
  const prevPir = pirSeen.get(instId);
  pirSeen.set(instId, pirState);
  const pirOn = isTruthyState(pirState);
  const prevPirOn = isTruthyState(prevPir);
  const pirTriggered = pirOn && prevPirOn !== undefined && !prevPirOn;

  const manual = manualState.get(instId);
  if (manual) {
    setRelays(send, ctx, !!manual.on, manual.on ? 'Manual ON' : 'Manual OFF', 'Manual');
    broadcastState(ctx, { source: 'manual', manual_active: true, timer_remaining_s: 0, last_reason: manual.on ? 'Manual ON' : 'Manual OFF', output_on: !!manual.on, status: manual.on ? 'on' : 'off' });
    return;
  }

  if (switchTriggered) {
    holdUntil.set(instId, now + timerMs);
    const label = ctx.io(triggerSource)?.name || triggerSource;
    setRelays(send, ctx, true, `Switch trigger: ${label} (${Math.round(timerMs/1000)}s timer)`, 'Switch');
    broadcastState(ctx, { source: 'switch', switches: switchKeys.filter(k => !!ctx.io(k)).length, timer_remaining_s: Math.round(timerMs/1000), last_reason: `Switch trigger: ${label}`, output_on: true, status: 'on' });
    return;
  }

  if (pirTriggered) {
    holdUntil.set(instId, now + timerMs);
    setRelays(send, ctx, true, `PIR trigger (${Math.round(timerMs/1000)}s timer)`, 'PIR');
    broadcastState(ctx, { source: 'pir', motion_active: true, timer_remaining_s: Math.round(timerMs/1000), last_reason: 'PIR trigger', output_on: true, status: 'on' });
    return;
  }

  const until = holdUntil.get(instId) || 0;
  const remainingMs = until - now;
  if (remainingMs > 0) {
    const bucket = Math.floor(remainingMs / 5000);
    if (holdLastBroadcast.get(instId) !== bucket) {
      holdLastBroadcast.set(instId, bucket);
      broadcastState(ctx, { source: 'timer', timer_remaining_s: Math.ceil(remainingMs/1000), motion_active: !!pirOn, last_reason: `Timer hold ${Math.ceil(remainingMs/1000)}s left`, output_on: true, status: 'on' });
    }
    return;
  }

  holdUntil.delete(instId);
  holdLastBroadcast.delete(instId);

  holdUntil.delete(instId);
  holdLastBroadcast.delete(instId);
  setRelays(send, ctx, false, 'Timer expired', 'Timer');
  broadcastState(ctx, { source: 'timer', timer_remaining_s: 0, motion_active: !!pirOn, last_reason: 'Timer expired', output_on: false, status: 'off' });
}

function setManual(instId, on) {
  manualState.set(instId, { on: !!on, ts: Date.now() });
}

function clearManual(instId) {
  manualState.delete(instId);
}

const STAIRCASE_MODULE = {
  id: 'staircase',
  name: 'Staircase',
  icon: '💡',
  description: 'Multiple button inputs and optional PIR with common OFF timer for staircase/common-area lighting.',
  color: '#f5c842',
  category: 'lighting',
  inputs: [
    { key: 'light_relay', label: 'Light Relay (DO)', type: 'relay', required: true, description: 'Primary staircase light output.' },
    { key: 'light_relay_2', label: 'Light Relay 2 (DO)', type: 'relay', required: false, description: 'Second relay output controlled together.' },
    { key: 'light_relay_3', label: 'Light Relay 3 (DO)', type: 'relay', required: false, description: 'Third relay output controlled together.' },
    { key: 'light_relay_4', label: 'Light Relay 4 (DO)', type: 'relay', required: false, description: 'Fourth relay output controlled together.' },
    { key: 'switch_di', label: 'Button Switch 1 (DI)', type: 'sensor', required: false, description: 'Momentary push button input.' },
    { key: 'switch_di_2', label: 'Button Switch 2 (DI)', type: 'sensor', required: false, description: 'Second momentary push button input.' },
    { key: 'switch_di_3', label: 'Button Switch 3 (DI)', type: 'sensor', required: false, description: 'Third momentary push button input.' },
    { key: 'switch_di_4', label: 'Button Switch 4 (DI)', type: 'sensor', required: false, description: 'Fourth momentary push button input.' },
    { key: 'pir_sensor', label: 'PIR Motion (DI)', type: 'sensor', required: false, description: 'Optional PIR trigger using the same timer.' },
  ],
  setpoints: [
    { group: 'Timer', key: 'timer_off_s', label: 'OFF timer', type: 'number', unit: 'sec', step: 1, default: 60, help: 'How many seconds the light stays ON after any switch or PIR trigger.' },
    { key: 'test_mode', label: 'Test mode (dry run)', type: 'select', options: ['0','1'], default: '0', help: 'When ON, decisions run but outputs are not really switched.' },
  ],
};

module.exports = { staircaseHandler, STAIRCASE_MODULE, setManual, clearManual };
