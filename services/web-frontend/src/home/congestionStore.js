// One public request at a time. Errors stop polling until explicit retry or re-entry.
export function createCongestionStore({
  api,
  intervalMs = 30000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  clock = Date.now,
} = {}) {
  let state = { phase: 'idle', data: null, updatedAt: null, stale: false },
    active = false,
    epoch = 0,
    abort,
    timer,
    busy = false;
  const listeners = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  function stop() {
    epoch++;
    clearTimer(timer);
    abort?.abort();
    busy = false;
  }
  async function refresh() {
    if (!active || busy) return;
    clearTimer(timer);
    busy = true;
    abort = new AbortController();
    const request = ++epoch;
    emit({ phase: 'loading', error: null });
    try {
      const data = await api.get({ signal: abort.signal });
      if (!active || epoch !== request) return;
      emit({ phase: 'ready', data, stale: false, updatedAt: clock() });
      timer = setTimer(() => void refresh(), intervalMs);
    } catch (error) {
      if (active && epoch === request)
        emit({ phase: 'error', error, stale: Boolean(state.data) });
    } finally {
      if (epoch === request) busy = false;
    }
  }
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    refresh,
    setActive(next) {
      if (active === next) return;
      active = next;
      stop();
      if (next) void refresh();
      else emit({ phase: 'idle', stale: Boolean(state.data) });
    },
    dispose() {
      active = false;
      stop();
    },
  };
}
