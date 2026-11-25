import { DASHBOARD_RESOURCES, DashboardError } from './dashboardApi.js';
export const DASHBOARD_POLL_MS = 30000;
const emptyResource = () => ({
  phase: 'idle',
  data: null,
  stale: false,
  updatedAt: null,
  error: null,
});
const initial = () =>
  Object.freeze({
    resources: Object.fromEntries(
      DASHBOARD_RESOURCES.map((key) => [key, emptyResource()]),
    ),
    write: { phase: 'idle' },
    visible: true,
  });
export function createDashboardStore(
  api,
  {
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    intervalMs = DASHBOARD_POLL_MS,
  } = {},
) {
  let state = initial(),
    alive = false,
    life = 0,
    visible = true,
    mutation = null;
  const listeners = new Set();
  const slots = Object.fromEntries(
    DASHBOARD_RESOURCES.map((key) => [
      key,
      { epoch: 0, controller: null, flight: null, timer: null },
    ]),
  );
  const publish = (patch) => {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((listener) => listener());
  };
  const resource = (key, patch) =>
    publish({
      resources: {
        ...state.resources,
        [key]: { ...state.resources[key], ...patch },
      },
    });
  const cancel = (key) => {
    const slot = slots[key];
    slot.epoch++;
    slot.controller?.abort();
    slot.flight = null;
    clearTimer(slot.timer);
    slot.timer = null;
  };
  const schedule = (key) => {
    const slot = slots[key];
    clearTimer(slot.timer);
    if (
      alive &&
      visible &&
      !(key === 'operations' && (mutation || state.write.phase === 'uncertain'))
    )
      slot.timer = setTimer(() => {
        slot.timer = null;
        void refresh(key);
      }, intervalMs);
  };
  function refresh(key, { review = false } = {}) {
    if (!slots[key])
      return Promise.reject(
        new DashboardError('조회 영역을 확인해 주세요.', { kind: 'input' }),
      );
    if (
      !alive ||
      !visible ||
      (key === 'operations' &&
        (mutation || (state.write.phase === 'uncertain' && !review)))
    )
      return Promise.resolve(false);
    const slot = slots[key];
    if (slot.flight) return slot.flight;
    cancel(key);
    const epoch = slot.epoch,
      owner = life;
    const controller = new AbortController();
    slot.controller = controller;
    resource(key, { phase: 'loading', error: null });
    const flight = Promise.resolve().then(async () => {
      if (
        !alive ||
        life !== owner ||
        epoch !== slot.epoch ||
        controller.signal.aborted
      )
        return false;
      try {
        const data = await api.read(key, { signal: controller.signal });
        if (
          !alive ||
          life !== owner ||
          epoch !== slot.epoch ||
          controller.signal.aborted
        )
          return false;
        resource(key, {
          phase: 'ready',
          data,
          stale: false,
          error: null,
          updatedAt: now(),
        });
        if (review && key === 'operations' && state.write.phase === 'uncertain')
          publish({
            write: { ...state.write, phase: 'reviewed', error: null },
          });
        schedule(key);
        return true;
      } catch (error) {
        if (
          !alive ||
          life !== owner ||
          epoch !== slot.epoch ||
          controller.signal.aborted
        )
          return false;
        const denied = [401, 403].includes(error.status);
        resource(key, {
          phase: 'error',
          error,
          stale: !denied && !!state.resources[key].data,
          ...(denied ? { data: null } : {}),
        });
        return false; // Stop only this resource's polling until retry or visibility return.
      } finally {
        if (slot.flight === flight) slot.flight = null;
      }
    });
    slot.flight = flight;
    return flight;
  }
  const store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    start({ visible: next = true } = {}) {
      if (alive) return;
      alive = true;
      life++;
      visible = next;
      publish({ visible });
      if (visible) void store.refreshAll();
    },
    refresh,
    refreshAll() {
      return Promise.allSettled(DASHBOARD_RESOURCES.map((key) => refresh(key)));
    },
    setVisible(next) {
      if (!alive || visible === next) return;
      visible = next;
      if (!next)
        for (const key of DASHBOARD_RESOURCES) {
          cancel(key);
          resource(key, {
            phase: 'paused',
            stale: !!state.resources[key].data,
          });
        }
      publish({ visible });
      if (next) void store.refreshAll();
    },
    review() {
      return refresh('operations', { review: true });
    },
    async change(field, value) {
      if (
        !alive ||
        !visible ||
        mutation ||
        state.write.phase === 'uncertain' ||
        state.resources.operations.phase !== 'ready'
      )
        throw new DashboardError(
          '현재 서버 상태를 먼저 확인하고 다시 선택해 주세요.',
          { kind: 'busy' },
        );
      const owner = life,
        ticket = {};
      mutation = ticket;
      cancel('operations');
      publish({ write: { phase: 'pending', field, value } });
      try {
        const data = await api.update(field, value);
        if (!alive || life !== owner) return;
        resource('operations', {
          phase: 'ready',
          data,
          stale: false,
          error: null,
          updatedAt: now(),
        });
        publish({ write: { phase: 'success', field, value } });
      } catch (error) {
        if (!alive || life !== owner) return;
        publish({
          write: {
            phase: error.uncertain ? 'uncertain' : 'error',
            field,
            value,
            error,
          },
        });
        if ([401, 403].includes(error.status))
          resource('operations', {
            phase: 'error',
            data: null,
            error,
            stale: false,
          });
        else if (error.uncertain)
          resource('operations', { stale: !!state.resources.operations.data });
      } finally {
        if (mutation === ticket) {
          mutation = null;
          // A remounted consumer must read its own state, never adopt the old PATCH result.
          if (alive && life !== owner && visible) void refresh('operations');
          if (
            alive &&
            life === owner &&
            state.resources.operations.phase === 'ready' &&
            state.write.phase !== 'uncertain'
          )
            schedule('operations');
        }
      }
    },
    dispose() {
      alive = false;
      life++;
      for (const key of DASHBOARD_RESOURCES) cancel(key);
      listeners.clear();
      state = initial();
    },
  };
  return Object.freeze(store);
}
