// src/automation/helpers/light_common.js
// Shared helpers for all switch-based lighting modules.

const lastSwitchChange = new Map(); // Debounce tracker

function isTruthyState(v) {
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    return u === 'ON' || u === '1' || u === 'TRUE';
  }
  return v === 1 || v === true;
}

function slugifyActionPart(input, fallback = 'Light') {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const slug = raw
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function actionName(ctx, source, on, fallback = 'Light') {
  const keys = ['light_relay', 'light_relay_2', 'light_relay_3', 'light_relay_4'];
  const mapped = keys.filter(k => !!ctx?.io?.(k));
  const primaryName = ctx?.io?.('light_relay')?.name || '';
  const base = mapped.length <= 1 && primaryName
    ? slugifyActionPart(primaryName, fallback)
    : slugifyActionPart(ctx?.instance?.name || fallback, fallback);
  const src = slugifyActionPart(source || 'Auto', 'Auto');
  return `${base}_${src}_Calling_${on ? 'ON' : 'OFF'}`;
}

function relayKeys(ctx) {
  return ['light_relay', 'light_relay_2', 'light_relay_3', 'light_relay_4']
    .filter(k => !!ctx.io(k));
}

function setRelays(send, ctx, on, reason, source, fallback = 'Light') {
  const keys = relayKeys(ctx);
  const action = actionName(ctx, source, !!on, fallback);
  let logged = false;
  keys.forEach(k => {
    if (!logged) {
      send(k, on ? 'ON' : 'OFF', reason, { action });
      logged = true;
    } else {
      send(k, on ? 'ON' : 'OFF', reason, { skipLog: true });
    }
  });
}

function broadcastState(ctx, extra) {
  try {
    const on = relayKeys(ctx).some(k => ctx.isOn(k));
    ctx.broadcastState?.(Object.assign({
      source: null,
      output_on: !!on,
      status: on ? 'on' : 'off',
      manual_active: false,
      last_reason: null,
    }, extra || {}));
  } catch {}
}

/**
 * Handle wall switch follow/toggle logic for any switch-based lighting module.
 * @param {object} ctx - Engine context
 * @param {function} send - Engine send function
 * @param {number} instId - Instance ID
 * @param {object} opts - { switchState: Map, manualState: Map, fallback: string }
 * @returns {{ handled: boolean, manualActive: boolean }}
 */
function handleSwitch(ctx, send, instId, opts) {
  const { switchState, manualState, fallback = 'Light' } = opts;
  if (!ctx.io('switch_di')) return { handled: false, manualActive: false };

  const sw = ctx.state('switch_di');
  const prev = switchState.get(instId);

  // If switch state is unknown (null/undefined), don't make decisions
  if (sw === null || sw === undefined) {
    return { handled: false, manualActive: !!manualState.get(instId) };
  }

  // If we have no previous state, initialize from current state without triggering
  // This prevents unintended toggles after cache rebuild / ESPHome reconnection
  if (prev === undefined || prev === null) {
    switchState.set(instId, sw);
    return { handled: false, manualActive: !!manualState.get(instId) };
  }

  // Check if switch state is from an override (bypass debounce for intentional overrides)
  const switchIO = ctx.io('switch_di');
  const isSwitchOverridden = switchIO && ctx._engine && ctx._engine.getActiveIOOverride(switchIO.id)?.active;

  // Debounce: Ignore rapid state changes (switch bounce + reconnect transients)
  const now = Date.now();
  const last = lastSwitchChange.get(instId) || 0;

  const switchType = ctx.settingStr('switch_type', 'toggle');
  const isToggle = switchType === 'toggle' || switchType === '1';

  if (now - last < 400) {
    switchState.set(instId, sw);
    return { handled: false, manualActive: !!manualState.get(instId) };
  }
  lastSwitchChange.set(instId, now);

  switchState.set(instId, sw);

  const swOn = isTruthyState(sw);
  const prevOn = isTruthyState(prev);

  if (isToggle) {
    const prevWasExplicitlyOff = !isTruthyState(prev);
    if (swOn && prevWasExplicitlyOff) {
      const relayStates = relayKeys(ctx).map(k => ctx.isOn(k));
      const anyUnknown = relayStates.some(v => v === null || v === undefined);
      if (anyUnknown) {
        // Relay state unknown (likely after reconnect) — don't toggle, wait for state to stabilize
        return { handled: false, manualActive: !!manualState.get(instId) };
      }
      const isOn = relayStates.some(v => v);
      const targetOn = !isOn;
      const reason = targetOn ? 'Manual ON' : 'Manual OFF';
      manualState.set(instId, { on: targetOn, ts: Date.now() });
      setRelays(send, ctx, targetOn, reason, 'Switch', fallback);
      broadcastState(ctx, { manual_active: true, source: 'manual', last_reason: reason, status: targetOn ? 'on' : 'off', output_on: targetOn });
      return { handled: true, manualActive: true };
    }
  } else {
    // Follow mode: react to any state change — normalize to boolean to avoid
    // false triggers from case differences ('ON' vs 'on') or type coercion
    const swOn = isTruthyState(sw);
    const prevOn = isTruthyState(prev);
    if (swOn !== prevOn) {
      const relayStates = relayKeys(ctx).map(k => ctx.isOn(k));
      const anyUnknown = relayStates.some(v => v === null || v === undefined);
      if (anyUnknown) {
        // Relay state unknown (likely after reconnect) — don't toggle, wait for state to stabilize
        return { handled: true, manualActive: !!manualState.get(instId) };
      }
      const isOn = relayStates.some(v => v);
      if (isOn !== swOn) {
        const reason = swOn ? 'Manual ON' : 'Manual OFF';
        manualState.set(instId, { on: swOn, ts: Date.now() });
        setRelays(send, ctx, swOn, reason, 'Switch', fallback);
        broadcastState(ctx, { manual_active: true, source: 'manual', last_reason: reason, status: swOn ? 'on' : 'off', output_on: swOn });
      }
      return { handled: true, manualActive: true };
    }
  }

  return { handled: false, manualActive: !!manualState.get(instId) };
}

module.exports = {
  isTruthyState,
  slugifyActionPart,
  actionName,
  relayKeys,
  setRelays,
  broadcastState,
  handleSwitch,
};
