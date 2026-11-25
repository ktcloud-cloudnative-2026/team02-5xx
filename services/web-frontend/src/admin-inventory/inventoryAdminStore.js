import { InventoryAdminError } from './inventoryAdminApi.js';
const initial = () =>
  Object.freeze({
    lowStockOnly: false,
    rows: [],
    list: { phase: 'idle' },
    panel: null,
    mutation: { phase: 'idle' },
    busy: false,
    notice: '',
  });
export function createInventoryAdminStore(api) {
  let state = initial(),
    active = true,
    life = 0,
    authority = 0,
    readEpoch = 0,
    panelSerial = 0,
    flight = null,
    reader = null;
  const listeners = new Set();
  const publish = (patch) => {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((listener) => listener());
  };
  const stopRead = () => {
    readEpoch++;
    reader?.abort();
  };
  async function load({ review = false } = {}) {
    if (!active) return;
    stopRead();
    const epoch = readEpoch,
      owner = life;
    const controller = new AbortController();
    reader = controller;
    const filter = state.lowStockOnly;
    const panelKey = state.panel?.key;
    publish({ list: { phase: 'loading' } });
    try {
      const rows = await api.list(review ? false : filter, {
        signal: controller.signal,
      });
      if (
        !active ||
        life !== owner ||
        epoch !== readEpoch ||
        controller.signal.aborted
      )
        return;
      const visible = filter ? rows.filter((row) => row.lowStock) : rows;
      const patch = { rows: visible, list: { phase: 'ready' } };
      if (
        review &&
        state.panel?.key === panelKey &&
        state.mutation.phase === 'uncertain'
      )
        patch.mutation = {
          ...state.mutation,
          reviewed: true,
          reviewedRows: state.panel.kind === 'create' ? rows : undefined,
          currentItem:
            rows.find(
              (row) => row.stockItemId === state.panel.item?.stockItemId,
            ) ?? null,
        };
      publish(patch);
    } catch (error) {
      if (
        !active ||
        life !== owner ||
        epoch !== readEpoch ||
        controller.signal.aborted
      )
        return;
      if ([401, 403].includes(error.status)) authority++;
      publish({
        list: { phase: 'error', error },
        ...([401, 403].includes(error.status) ? { rows: [] } : {}),
      });
    }
  }
  const store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    activate() {
      active = true;
      publish({ busy: !!flight });
    },
    load,
    filter(lowStockOnly) {
      if (state.lowStockOnly === lowStockOnly) return;
      publish({ lowStockOnly, rows: [], notice: '' });
      void load();
    },
    open(kind, stockItemId) {
      if (flight || state.list.phase !== 'ready') return;
      if (!['create', 'restock', 'link', 'delete'].includes(kind)) return;
      const item = state.rows.find((row) => row.stockItemId === stockItemId);
      if (kind !== 'create' && !item) return;
      publish({
        panel: { key: ++panelSerial, kind, item },
        mutation: { phase: 'idle' },
        notice: '',
      });
    },
    close() {
      if (flight) return;
      publish({ panel: null, mutation: { phase: 'idle' } });
    },
    async submit(body) {
      const panel = state.panel;
      if (!panel || flight)
        throw new InventoryAdminError(
          '진행 중인 변경 요청이 끝난 뒤 다시 시도해 주세요.',
          { kind: 'busy' },
        );
      if (state.mutation.phase === 'uncertain' && !state.mutation.reviewed)
        throw new InventoryAdminError(
          '현재 재고를 먼저 조회하고 반영 여부를 확인해 주세요.',
          { kind: 'review' },
        );
      if (
        state.mutation.phase === 'uncertain' &&
        state.mutation.reviewed &&
        panel.kind !== 'create' &&
        !state.mutation.currentItem
      )
        throw new InventoryAdminError(
          '현재 전체 목록에 이 재고가 없어요. 패널을 닫고 목록을 확인해 주세요.',
          { kind: 'review' },
        );
      if ([401, 403].includes(state.list.error?.status))
        throw new InventoryAdminError(
          '관리자 인증·권한을 먼저 확인해 주세요.',
          { kind: 'permission' },
        );
      const selectedMenu =
        panel.kind === 'create' ? (body?.menuId ?? null) : null;
      if (
        selectedMenu !== null &&
        (!Number.isSafeInteger(selectedMenu) || selectedMenu < 1)
      )
        throw new InventoryAdminError('연결할 메뉴를 확인해 주세요.', {
          kind: 'input',
        });
      const ticket = {},
        owner = life,
        permission = authority;
      flight = ticket;
      publish({ busy: true, mutation: { phase: 'pending' }, notice: '' });
      let created;
      try {
        let item;
        if (panel.kind === 'create') {
          created = await api.create(body);
          if (!active || owner !== life || permission !== authority) return;
          if (selectedMenu !== null) {
            stopRead();
            const createdRows = state.rows.filter(
              (row) => row.stockItemId !== created.stockItemId,
            );
            if (!state.lowStockOnly || created.lowStock)
              createdRows.push(created);
            publish({
              rows: createdRows.sort((a, b) => a.stockItemId - b.stockItemId),
              list: { phase: 'ready' },
              notice: `재고 #${created.stockItemId} 생성 완료 · 메뉴 연결 중이에요.`,
            });
            item = await api.link(created.stockItemId, {
              menuId: selectedMenu,
            });
          } else item = created;
        } else
          item =
            panel.kind === 'restock'
              ? await api.restock(panel.item.stockItemId, body)
              : panel.kind === 'link'
                ? await api.link(panel.item.stockItemId, body)
                : await api.remove(panel.item.stockItemId);
        if (!active || owner !== life || permission !== authority) return;
        stopRead();
        const rows = state.rows.filter(
          (row) => row.stockItemId !== item.stockItemId,
        );
        if (panel.kind !== 'delete' && (!state.lowStockOnly || item.lowStock))
          rows.push(item);
        rows.sort((a, b) => a.stockItemId - b.stockItemId);
        const samePanel = state.panel?.key === panel.key;
        publish({
          rows,
          list: { phase: 'ready' },
          ...(samePanel ? { panel: null, mutation: { phase: 'idle' } } : {}),
          notice: `재고 #${item.stockItemId} ${panel.kind === 'create' ? '등록' : panel.kind === 'restock' ? '입고' : panel.kind === 'link' ? '메뉴 연결 변경' : '논리 삭제'}을 완료했어요.`,
        });
        void load();
        return item;
      } catch (error) {
        if (!active || owner !== life || permission !== authority) return;
        const patch = {};
        if ([401, 403].includes(error.status)) {
          authority++;
          stopRead();
          patch.rows = [];
          patch.list = { phase: 'error', error };
        }
        if (
          created &&
          selectedMenu !== null &&
          state.panel?.key === panel.key
        ) {
          patch.panel = {
            key: ++panelSerial,
            kind: 'link',
            item: created,
            partialCreate: true,
            suggestedMenuId: selectedMenu,
          };
          patch.notice = `재고 #${created.stockItemId} 생성은 완료됐어요. 메뉴 연결 ${error.uncertain ? '결과를 확인해 주세요' : '실패로 미연결 상태예요'}. 다시 등록하지 않고 연결을 재시도할 수 있어요.`;
          patch.mutation = {
            phase: error.uncertain ? 'uncertain' : 'error',
            error,
            reviewed: false,
          };
        } else if (state.panel?.key === panel.key)
          patch.mutation = {
            phase: error.uncertain ? 'uncertain' : 'error',
            error,
            reviewed: false,
          };
        else
          patch.notice = error.uncertain
            ? '닫은 변경 요청의 반영 여부를 확인하지 못했어요. 전체 목록을 다시 확인해 주세요.'
            : error.message;
        publish(patch);
      } finally {
        if (flight === ticket) {
          flight = null;
          if (active) publish({ busy: false });
        }
      }
    },
    async review() {
      await load({ review: true });
    },
    dispose() {
      active = false;
      life++;
      stopRead();
      listeners.clear();
      state = initial();
    },
  };
  return Object.freeze(store);
}
