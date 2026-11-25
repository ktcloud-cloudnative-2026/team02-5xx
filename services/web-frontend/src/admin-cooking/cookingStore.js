import { COOKING_ENDPOINTS } from './cookingApi.js';
export const COOKING_POLL_MS = 30000;
const names = Object.keys(COOKING_ENDPOINTS);
const empty = () =>
  Object.fromEntries(
    names.map((name) => [
      name,
      { phase: 'idle', data: null, error: null, updatedAt: null, stale: false },
    ]),
  );

/** Three independent read channels; no cross-service snapshot or mutation API. */
export function createCookingStore(
  api,
  {
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    intervalMs = COOKING_POLL_MS,
  } = {},
) {
  let snapshot = empty(),
    active = false;
  const subscriptions = new Set();
  const channels = new Map(
    names.map((name) => [
      name,
      { version: 0, timer: null, abort: null, promise: null },
    ]),
  );
  function emit(name, patch) {
    snapshot = { ...snapshot, [name]: { ...snapshot[name], ...patch } };
    for (const listener of subscriptions) listener();
  }
  function invalidate(channel) {
    channel.version++;
    clearTimer(channel.timer);
    channel.timer = null;
    channel.abort?.abort();
    channel.abort = null;
    channel.promise = null;
  }
  function refresh(name) {
    const channel = channels.get(name);
    if (!channel) return Promise.reject(new Error('Unknown cooking resource'));
    if (!active) return Promise.resolve(false);
    if (channel.promise) return channel.promise;
    invalidate(channel);
    const version = channel.version,
      abort = new AbortController();
    channel.abort = abort;
    emit(name, { phase: 'loading', error: null });
    const current = () =>
      active && channel.version === version && !abort.signal.aborted;
    const promise = Promise.resolve().then(async () => {
      // StrictMode cleanup can cancel before this deferred dispatch.
      if (!current()) return false;
      try {
        const data = await api.get(name, { signal: abort.signal });
        if (!current()) return false;
        emit(name, {
          phase: 'ready',
          data,
          error: null,
          stale: false,
          updatedAt: now(),
        });
        channel.timer = setTimer(() => {
          channel.timer = null;
          void refresh(name);
        }, intervalMs);
        return true;
      } catch (error) {
        if (!current()) return false;
        const denied = error.status === 401 || error.status === 403;
        emit(name, {
          phase: 'error',
          error,
          data: denied ? null : snapshot[name].data,
          stale: !denied && snapshot[name].data !== null,
        });
        return false; // Successful regions keep polling; failed region awaits an explicit retry/re-entry.
      } finally {
        if (channel.promise === promise) channel.promise = null;
      }
    });
    channel.promise = promise;
    return promise;
  }
  function setActive(next) {
    if (active === next) return;
    active = next;
    if (next) void refreshAll();
    else
      for (const name of names) {
        invalidate(channels.get(name));
        emit(name, { phase: 'paused', stale: snapshot[name].data !== null });
      }
  }
  function refreshAll() {
    return Promise.allSettled(names.map(refresh));
  }
  return Object.freeze({
    subscribe(listener) {
      subscriptions.add(listener);
      return () => subscriptions.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh,
    refreshAll,
    setActive,
    dispose() {
      setActive(false);
    },
  });
}
