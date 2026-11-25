export function stockStatus(menu, stock, quantity = 1) {
  if (menu?.status === 'PAUSED') return { blocked: true, label: '판매 중지' };
  if (stock.loading) return { blocked: true, label: '재고 확인 중' };
  const value = stock.data?.get(menu?.id);
  if (stock.error || !value) return { blocked: true, label: '재고 확인 불가' };
  if (!value.orderable || value.availableQty === 0)
    return { blocked: true, label: '품절' };
  if (quantity > value.availableQty)
    return {
      blocked: true,
      label: `재고 부족 · 가용 ${value.availableQty}개 / 선택 합계 ${quantity}개`,
    };
  return { blocked: false, label: '', availableQty: value.availableQty };
}
export function cartStock(items, getMenu, stock) {
  const totals = new Map();
  for (const item of items)
    totals.set(item.menuId, (totals.get(item.menuId) ?? 0) + item.quantity);
  const states = new Map(
    [...totals].map(([id, quantity]) => [
      id,
      stockStatus(getMenu(id), stock, quantity),
    ]),
  );
  return {
    states,
    blocked: [...states.values()].some((state) => state.blocked),
  };
}

// Each explicit checkout attempt owns one lookup. Even transports ignoring abort
// cannot apply a response after cancel, navigation or a newer attempt.
export function createStockGate(api) {
  let generation = 0,
    controller = null;
  return {
    cancel() {
      generation++;
      controller?.abort();
      controller = null;
    },
    async check(ids) {
      this.cancel();
      const epoch = generation;
      const request = new AbortController();
      controller = request;
      const data = await api.availability(ids, { signal: request.signal });
      if (generation !== epoch || request.signal.aborted)
        throw new DOMException('Cancelled', 'AbortError');
      return data;
    },
  };
}
