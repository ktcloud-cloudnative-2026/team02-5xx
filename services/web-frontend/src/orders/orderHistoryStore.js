import { customerKey } from '../checkout/checkoutFlow.js';
import { canCancel } from './orderApi.js';

export function createOrderHistoryStore({ api, sessionSource }) {
  const owner = customerKey(sessionSource.getSnapshot());
  let active = false,
    listEpoch = 0,
    detailEpoch = 0,
    cancelEpoch = 0,
    listAbort,
    detailAbort,
    cancelAbort,
    unsubscribe;
  let state = {
    list: { phase: 'idle' },
    detail: { phase: 'idle' },
    page: 0,
    id: null,
    pending: false,
    review: false,
    notice: '',
  };
  const listeners = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const current = () =>
    active && owner && customerKey(sessionSource.getSnapshot()) === owner;
  const stop = () => {
    listEpoch++;
    detailEpoch++;
    cancelEpoch++;
    listAbort?.abort();
    detailAbort?.abort();
    cancelAbort?.abort();
  };
  async function list(page = state.page) {
    if (!current()) return;
    listAbort?.abort();
    listAbort = new AbortController();
    const epoch = ++listEpoch;
    const previous =
      state.list.data?.page === page ? state.list.data : undefined;
    emit({ page, list: { phase: 'loading', data: previous } });
    try {
      const data = await api.list(page, { signal: listAbort.signal });
      if (current() && epoch === listEpoch)
        emit({ list: { phase: 'ready', data } });
    } catch (error) {
      if (current() && epoch === listEpoch)
        emit({ list: { phase: 'error', error } });
    }
  }
  async function detail({ review = false } = {}) {
    if (!current() || !state.id || state.pending) return;
    detailAbort?.abort();
    detailAbort = new AbortController();
    const epoch = ++detailEpoch,
      id = state.id,
      previous = state.detail.data;
    emit({ detail: { phase: 'loading', data: previous } });
    try {
      const data = await api.detail(id, { signal: detailAbort.signal });
      if (current() && epoch === detailEpoch && id === state.id)
        emit({
          detail: { phase: 'ready', data },
          ...(review ? { review: false } : {}),
        });
    } catch (error) {
      if (current() && epoch === detailEpoch && id === state.id)
        emit({ detail: { phase: 'error', error, data: previous } });
    }
  }
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    start() {
      active = true;
      unsubscribe = sessionSource.subscribe(() => {
        if (!current()) {
          active = false;
          stop();
          emit({
            list: { phase: 'idle' },
            detail: { phase: 'idle' },
            pending: false,
            review: true,
            notice: '',
          });
        }
      });
    },
    dispose() {
      active = false;
      stop();
      unsubscribe?.();
    },
    navigate(page, id) {
      if (!current()) return;
      const reload =
        state.list.data?.page !== page ||
        (state.id && !id) ||
        state.list.phase === 'error';
      stop();
      emit({
        page,
        id,
        pending: false,
        review: false,
        notice: '',
        detail: { phase: 'idle' },
      });
      if (reload) void list(page);
      if (id) void detail();
    },
    list,
    detail,
    async cancel() {
      if (
        !current() ||
        state.pending ||
        state.review ||
        state.detail.phase !== 'ready' ||
        !canCancel(state.detail.data)
      )
        return;
      const id = state.id,
        epoch = ++cancelEpoch;
      detailEpoch++;
      detailAbort?.abort();
      cancelAbort = new AbortController();
      emit({ pending: true, notice: '' });
      try {
        const data = await api.cancel(id, { signal: cancelAbort.signal });
        if (!current() || epoch !== cancelEpoch || id !== state.id) return;
        emit({
          pending: false,
          review: false,
          detail: { phase: 'ready', data },
          notice:
            '서버에서 주문 취소를 확인했어요. 환불과 재고 복원은 별도로 처리될 수 있습니다.',
        });
        await Promise.all([list(), detail()]);
      } catch (error) {
        if (!current() || epoch !== cancelEpoch || id !== state.id) return;
        emit({ pending: false, review: true, notice: error.message });
        if (![401, 403].includes(error.status)) await detail();
      }
    },
  };
}
