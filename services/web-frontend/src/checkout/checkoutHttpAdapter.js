import {
  CheckoutError,
  customerKey,
  validateEstimate,
  validateOrder,
} from './checkoutFlow.js';
import { authSession } from '../authSession.js';

const messages = {
  INVALID_REQUEST:
    '품목은 1~20개, 수량은 1~99개, 옵션은 20개 이하로 확인해 주세요. 옵션 이름을 이어 붙인 길이(구분자 포함)가 255자를 넘으면 다른 옵션을 선택해 주세요.',
  STORE_NOT_ACCEPTING_ORDERS: '현재 매장이 주문을 받지 않고 있어요.',
  MENU_NOT_AVAILABLE: '판매 중지되었거나 선택할 수 없는 메뉴·옵션이 있어요.',
  OUT_OF_STOCK: '재고가 부족하여 주문을 만들지 못했어요.',
  HOLD_EXPIRED: '재고 확보 시간이 지났어요. 새 임시 주문부터 확인해 주세요.',
  PAYMENT_FAILED: '모의 결제가 거절됐어요. 새 임시 주문부터 확인해 주세요.',
  STOCK_CONFIRM_FAILED: '재고를 확정하지 못해 주문이 종료됐어요.',
  ORDER_NOT_PAYABLE: '이 주문은 결제할 수 없어요. 주문 상태를 확인해 주세요.',
  ORDER_PAY_IN_PROGRESS:
    '결제를 처리하고 있어요. 다시 결제하지 말고 상태를 확인해 주세요.',
  COOKING_UNAVAILABLE:
    '조리 서비스 문제로 지금은 주문·결제를 진행할 수 없어요.',
  MENU_SERVICE_UNAVAILABLE:
    '메뉴 정보를 확인하지 못했어요. 잠시 후 다시 조회해 주세요.',
  INVENTORY_SERVICE_UNAVAILABLE:
    '재고 확보를 확인하지 못해 주문을 준비하지 못했어요. 잠시 후 새 임시 주문으로 확인해 주세요.',
  UNAUTHORIZED: '고객 인증이 만료됐어요. 다시 로그인해 주세요.',
  FORBIDDEN: '요청 권한 또는 요청 출처가 허용되지 않았어요.',
};
const terminalCreate = {
  INVALID_REQUEST: 400,
  STORE_NOT_ACCEPTING_ORDERS: 409,
  MENU_NOT_AVAILABLE: 409,
  OUT_OF_STOCK: 409,
  COOKING_UNAVAILABLE: 503,
  MENU_SERVICE_UNAVAILABLE: 503,
  INVENTORY_SERVICE_UNAVAILABLE: 503,
};
const terminalPay = {
  PAYMENT_FAILED: 402,
  HOLD_EXPIRED: 409,
  STOCK_CONFIRM_FAILED: 409,
  ORDER_NOT_PAYABLE: 409,
  MENU_NOT_AVAILABLE: 409,
};
function requestItems(items) {
  const id = (n) => Number.isSafeInteger(n) && n > 0;
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 20 ||
    items.some(
      (row) =>
        !row ||
        !id(row.menuId) ||
        !Number.isInteger(row.quantity) ||
        row.quantity < 1 ||
        row.quantity > 99 ||
        !Array.isArray(row.optionIds) ||
        row.optionIds.length > 20 ||
        !row.optionIds.every(id) ||
        new Set(row.optionIds).size !== row.optionIds.length,
    )
  )
    throw new CheckoutError('INVALID_REQUEST', messages.INVALID_REQUEST, {
      definitive: true,
    });
  return items.map(({ menuId, quantity, optionIds }) => ({
    menuId,
    optionIds: [...optionIds].sort((a, b) => a - b),
    quantity,
  }));
}
export function createCheckoutHttpAdapter({
  sessionSource = authSession,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const inputs = new Map();
  async function call(
    path,
    {
      method,
      body,
      signal,
      operation,
      expectedStatus = 200,
      protectedRequest = true,
    },
  ) {
    if (protectedRequest && !customerKey(sessionSource.getSnapshot()))
      throw new CheckoutError('UNAUTHORIZED', messages.UNAUTHORIZED);
    const timeout = AbortSignal.timeout(timeoutMs);
    const options = {
      method,
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          }
        : { headers: { Accept: 'application/json' } }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    };
    let response;
    try {
      response = protectedRequest
        ? await sessionSource.request(path, {
            ...options,
            retryOn401: method === 'GET',
          })
        : await fetchImpl(path, options);
    } catch {
      throw new CheckoutError(
        signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR',
        '통신 결과를 확인하지 못했어요. 먼저 주문 상태를 확인해 주세요.',
      );
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new CheckoutError(
        'UPSTREAM_INVALID_RESPONSE',
        '서버 응답을 확인할 수 없어요.',
      );
    }
    if (!response.ok) {
      const code =
        envelope?.success === false && typeof envelope.errorCode === 'string'
          ? envelope.errorCode
          : 'HTTP_ERROR';
      // Only explicit, documented terminal errors qualify. 401/403, generic
      // 409, transport errors and 5xx payment responses never imply unpaid.
      const definitive =
        envelope?.success === false &&
        ((operation === 'create' &&
          Object.hasOwn(terminalCreate, code) &&
          terminalCreate[code] === response.status) ||
          (operation === 'pay' &&
            Object.hasOwn(terminalPay, code) &&
            terminalPay[code] === response.status));
      const error = new CheckoutError(
        code,
        messages[code] ??
          '처리 결과를 확인하지 못했어요. 주문 상태를 확인해 주세요.',
        { definitive },
      );
      error.status = response.status;
      throw error;
    }
    if (
      response.status !== expectedStatus ||
      envelope?.success !== true ||
      envelope.data == null
    )
      throw new CheckoutError(
        'UPSTREAM_INVALID_RESPONSE',
        '서버 응답 형식을 확인할 수 없어요.',
      );
    return envelope.data;
  }
  function checked(order, items, expectedId) {
    try {
      const expected =
        items ??
        requestItems(
          order?.items?.map((row) => ({
            menuId: row.menuId,
            quantity: row.quantity,
            optionIds: row.options?.map((o) => o.optionId),
          })),
        );
      return validateOrder(order, { items: expected }, expectedId);
    } catch {
      throw new CheckoutError(
        'UPSTREAM_INVALID_RESPONSE',
        '주문 응답의 항목·금액·상태를 확인할 수 없어요.',
      );
    }
  }
  function orderId(id) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new CheckoutError('INVALID_REQUEST', messages.INVALID_REQUEST, {
        definitive: true,
      });
    return id;
  }
  return {
    mode: 'http',
    async estimate({ items }, { signal } = {}) {
      return validateEstimate(
        await call('/api/v1/cooking/estimates', {
          method: 'POST',
          body: { items: requestItems(items) },
          signal,
          operation: 'estimate',
          protectedRequest: false,
        }),
      );
    },
    async create({ items }, { signal } = {}) {
      items = requestItems(items);
      const order = checked(
        await call('/api/v1/orders', {
          method: 'POST',
          body: { items },
          signal,
          operation: 'create',
          expectedStatus: 201,
        }),
        items,
      );
      if (order.status !== 'CREATED')
        throw new CheckoutError(
          'UPSTREAM_INVALID_RESPONSE',
          '임시 주문 상태를 확인할 수 없어요.',
        );
      inputs.set(order.orderId, items);
      return order;
    },
    async pay(id, { signal } = {}) {
      orderId(id);
      return checked(
        await call(`/api/v1/orders/${id}/pay`, {
          method: 'POST',
          signal,
          operation: 'pay',
        }),
        inputs.get(id),
        id,
      );
    },
    async get(id, { signal } = {}) {
      orderId(id);
      return checked(
        await call(`/api/v1/orders/${id}`, {
          method: 'GET',
          signal,
          operation: 'get',
        }),
        inputs.get(id),
        id,
      );
    },
  };
}
