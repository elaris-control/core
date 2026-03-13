/**
 * Simple in-memory runtime store per instance.
 * Used for control state (PI integrators, min on/off timers, etc).
 * NOTE: state resets on server restart (OK for MVP).
 */
const store = new Map();

function key(instanceId, bucket) { return `${instanceId}:${bucket}`; }

function getOrCreate(instanceId, bucket, factory) {
  const k = key(instanceId, bucket);
  if (!store.has(k)) store.set(k, factory());
  return store.get(k);
}

function clear(instanceId, bucket) {
  store.delete(key(instanceId, bucket));
}

module.exports = { getOrCreate, clear };
