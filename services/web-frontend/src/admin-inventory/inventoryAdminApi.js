const ROOT = '/api/v1/admin/inventory/items';
export const MAX_STOCK = 2147483647;
export class InventoryAdminError extends Error {
  constructor(
    message,
    { status = 0, code = '', kind = 'http', uncertain = false } = {},
  ) {
    super(message);
    Object.assign(this, { status, code, kind, uncertain });
  }
}
const input = (message) => {
  throw new InventoryAdminError(message, { kind: 'input' });
};
const id = (value) => Number.isSafeInteger(value) && value > 0;
const quantity = (value) =>
  Number.isInteger(value) && value >= 0 && value <= MAX_STOCK;
export function parseInventoryNumber(
  value,
  { positive = false, menuId = false } = {},
) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()))
    input('정수를 입력해 주세요. 소수·음수·지수 표기는 사용할 수 없어요.');
  const number = Number(value.trim());
  if (
    !Number.isSafeInteger(number) ||
    number < (positive || menuId ? 1 : 0) ||
    (!menuId && number > MAX_STOCK)
  )
    input(
      menuId
        ? '메뉴 ID는 정확히 처리할 수 있는 양의 안전한 정수로 입력해 주세요.'
        : `${positive ? '1' : '0'}~${MAX_STOCK.toLocaleString('ko-KR')} 사이의 정수를 입력해 주세요.`,
    );
  return number;
}
export function validateStockItem(row, expectedId) {
  if (
    !row ||
    !id(row.stockItemId) ||
    (expectedId !== undefined && row.stockItemId !== expectedId) ||
    !(row.menuId === null || id(row.menuId)) ||
    ![
      row.stockQty,
      row.reservedQty,
      row.availableQty,
      row.lowStockThreshold,
    ].every(quantity) ||
    row.reservedQty > row.stockQty ||
    row.availableQty !== row.stockQty - row.reservedQty ||
    typeof row.lowStock !== 'boolean'
  )
    throw new InventoryAdminError(
      '재고 서버 응답을 확인할 수 없어요. 현재 목록을 다시 조회해 주세요.',
      { kind: 'protocol' },
    );
  // lowStock is an authoritative server flag; do not replace it with a local guess.
  return Object.freeze({
    stockItemId: row.stockItemId,
    menuId: row.menuId,
    stockQty: row.stockQty,
    reservedQty: row.reservedQty,
    availableQty: row.availableQty,
    lowStockThreshold: row.lowStockThreshold,
    lowStock: row.lowStock,
  });
}
function httpFailure(status, code, write) {
  const messages = {
    STOCK_ITEM_IN_USE:
      '진행 중이거나 복원 대상인 주문이 있어 변경할 수 없어요. 기존 재고와 연결을 유지했어요.',
    MENU_ALREADY_LINKED:
      '이미 다른 재고에 연결된 메뉴예요. 다른 메뉴 ID를 확인해 주세요.',
    MENU_NOT_LINKABLE:
      'HIDDEN 메뉴는 연결할 수 없어요. 판매 중 또는 판매 중지 메뉴를 선택해 주세요.',
    MENU_SERVICE_UNAVAILABLE:
      '메뉴 서버에 연결하지 못했어요. 기존 메뉴 연결은 유지됩니다. 잠시 후 다시 시도해 주세요.',
    MENU_NOT_FOUND:
      '입력한 메뉴를 찾을 수 없어요. 메뉴 ID를 다시 확인해 주세요.',
    INVENTORY_NOT_FOUND:
      '재고가 없거나 이미 삭제됐어요. 현재 목록을 다시 확인해 주세요.',
  };
  const message =
    status === 401
      ? '관리자 인증이 필요하거나 만료됐어요.'
      : status === 403
        ? '관리자 재고 관리 권한이 없어요.'
        : (messages[code] ??
          (status === 400
            ? '입력값을 처리할 수 없어요. 수량과 메뉴 ID를 확인해 주세요.'
            : status === 404
              ? '관리자 재고 API가 비활성화되어 있거나 경로를 사용할 수 없어요.'
              : '재고 요청을 처리하지 못했어요. 잠시 후 다시 확인해 주세요.'));
  return new InventoryAdminError(message, {
    status,
    code,
    uncertain: write && status >= 500 && code !== 'MENU_SERVICE_UNAVAILABLE',
  });
}
export function createInventoryAdminApi({
  request = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  async function call(
    path = '',
    { method = 'GET', body, status = 200, signal, expectedId } = {},
  ) {
    const write = method !== 'GET';
    let response;
    try {
      response = await request(`${ROOT}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new InventoryAdminError(
        write
          ? '연결을 확인하지 못했어요. 변경이 반영됐을 수 있어 현재 재고를 먼저 확인해 주세요.'
          : '재고 서버에 연결하지 못했어요. 다시 조회해 주세요.',
        { kind: 'network', uncertain: write },
      );
    }
    signal?.throwIfAborted();
    if (response.status === 401 || response.status === 403)
      throw httpFailure(
        response.status,
        response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        write,
      );
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      if (!response.ok) throw httpFailure(response.status, '', write);
      throw new InventoryAdminError(
        '재고 응답을 읽지 못했어요. 현재 재고를 다시 확인해 주세요.',
        { kind: 'protocol', uncertain: write },
      );
    }
    signal?.throwIfAborted();
    if (!response.ok)
      throw httpFailure(response.status, envelope?.errorCode, write);
    try {
      if (
        response.status !== status ||
        envelope?.success !== true ||
        envelope.data == null ||
        typeof envelope.message !== 'string'
      )
        throw new Error();
      if (!write) {
        if (!Array.isArray(envelope.data)) throw new Error();
        const items = envelope.data.map((row) => validateStockItem(row));
        if (
          new Set(items.map((row) => row.stockItemId)).size !== items.length ||
          items.some(
            (row, index) =>
              index > 0 && row.stockItemId < items[index - 1].stockItemId,
          )
        )
          throw new Error();
        return Object.freeze(items);
      }
      return validateStockItem(envelope.data, expectedId);
    } catch {
      throw new InventoryAdminError(
        '재고 서버 응답이 계약과 달라요. 현재 재고를 다시 확인해 주세요.',
        { kind: 'protocol', uncertain: write },
      );
    }
  }
  function stockId(value) {
    if (!id(value)) input('재고 ID를 확인해 주세요.');
  }
  return Object.freeze({
    list(lowStockOnly = false, { signal } = {}) {
      if (typeof lowStockOnly !== 'boolean')
        input('부족 재고 필터를 확인해 주세요.');
      return call(`?lowStockOnly=${lowStockOnly}`, { signal });
    },
    async create({ stockQty, lowStockThreshold } = {}) {
      if (!quantity(stockQty) || !quantity(lowStockThreshold))
        input('실제 재고와 부족 기준은 0 이상 정수로 입력해 주세요.');
      const item = await call('', {
        method: 'POST',
        status: 201,
        body: { stockQty, lowStockThreshold },
      });
      if (item.menuId !== null || item.reservedQty !== 0)
        throw new InventoryAdminError(
          '신규 재고 응답을 확인할 수 없어요. 전체 목록을 확인해 주세요.',
          { kind: 'protocol', uncertain: true },
        );
      return item;
    },
    restock(stockItemId, { quantity: count } = {}) {
      stockId(stockItemId);
      if (!quantity(count) || count < 1)
        input('입고 수량은 1 이상 정수로 입력해 주세요.');
      return call(`/${stockItemId}/adjustments`, {
        method: 'POST',
        body: { quantity: count },
        expectedId: stockItemId,
      });
    },
    async link(stockItemId, { menuId } = {}) {
      stockId(stockItemId);
      if (!(menuId === null || id(menuId)))
        input('메뉴 ID는 양의 안전한 정수로 입력해 주세요.');
      const item = await call(`/${stockItemId}/menu-link`, {
        method: 'PUT',
        body: { menuId },
        expectedId: stockItemId,
      });
      if (item.menuId !== menuId)
        throw new InventoryAdminError(
          '메뉴 연결 응답을 확인할 수 없어요. 현재 목록을 확인해 주세요.',
          { kind: 'protocol', uncertain: true },
        );
      return item;
    },
    async remove(stockItemId) {
      stockId(stockItemId);
      const item = await call(`/${stockItemId}`, {
        method: 'DELETE',
        expectedId: stockItemId,
      });
      if (item.menuId !== null)
        throw new InventoryAdminError(
          '삭제 응답을 확인할 수 없어요. 전체 목록을 확인해 주세요.',
          { kind: 'protocol', uncertain: true },
        );
      return item;
    },
  });
}
