import { authSession } from '../authSession.js';
import { customerKey, validateOrder } from '../checkout/checkoutFlow.js';

export class OrderError extends Error {
  constructor(message, code = 'INVALID_RESPONSE', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const id = (n) => Number.isSafeInteger(n) && n > 0;
const money = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
const text = (s) => typeof s === 'string' && s.trim().length > 0;
const date = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const statuses = [
  'CREATED',
  'PAID',
  'WAITING',
  'COOKING',
  'COMPLETED',
  'CANCELED',
  'FAILED',
];
const invalid = () => {
  throw new OrderError('주문 응답을 확인할 수 없어요. 다시 조회해 주세요.');
};
export function validateList(data, page, size) {
  if (
    !data ||
    data.page !== page ||
    data.size !== size ||
    !Number.isSafeInteger(data.totalElements) ||
    data.totalElements < 0 ||
    !Array.isArray(data.items) ||
    data.items.length > size ||
    data.items.length > data.totalElements
  )
    invalid();
  const seen = new Set();
  for (const row of data.items) {
    if (
      !row ||
      !id(row.orderId) ||
      seen.has(row.orderId) ||
      (row.status === 'CANCELED' && row.orderNo == null
        ? false
        : !text(row.orderNo)) ||
      !statuses.includes(row.status) ||
      ['CREATED', 'FAILED'].includes(row.status) ||
      !money(row.totalAmount) ||
      !date(row.orderedAt) ||
      !id(row.itemCount) ||
      !text(row.representativeMenuName)
    )
      invalid();
    seen.add(row.orderId);
  }
  return structuredClone(data);
}
export function validateDetail(data, orderId) {
  if (
    !data ||
    !Array.isArray(data.items) ||
    !data.items.length ||
    data.items.length > 20 ||
    !date(data.orderedAt)
  )
    invalid();
  const items = data.items.map((row) => {
    if (
      !id(row?.menuId) ||
      !Number.isInteger(row.quantity) ||
      row.quantity < 1 ||
      row.quantity > 99 ||
      !Array.isArray(row.options) ||
      row.options.length > 20
    )
      invalid();
    const optionIds = row.options.map((o) => o?.optionId).sort((a, b) => a - b);
    if (!optionIds.every(id) || new Set(optionIds).size !== optionIds.length)
      invalid();
    return { menuId: row.menuId, quantity: row.quantity, optionIds };
  });
  let order;
  try {
    order = validateOrder(data, { items }, orderId);
  } catch {
    invalid();
  }
  for (const name of ['paidAt', 'canceledAt', 'completedAt'])
    if (order[name] != null && !date(order[name])) invalid();
  if (['PAID', 'WAITING', 'COOKING', 'COMPLETED'].includes(order.status)) {
    const c = order.cooking;
    if (!c || !['OK', 'PENDING', 'UNAVAILABLE'].includes(c.lookup))
      order.cooking = { lookup: 'UNAVAILABLE' };
    else if (
      c.lookup === 'OK' &&
      (!['WAITING', 'COOKING', 'DONE', 'CANCELED'].includes(c.status) ||
        ![c.expectedWaitSec, c.expectedReadySec].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        c.expectedReadySec < c.expectedWaitSec ||
        (c.startedAt != null && !date(c.startedAt)))
    )
      order.cooking = { lookup: 'UNAVAILABLE' };
  } else delete order.cooking;
  return order;
}
const messages = {
  UNAUTHORIZED: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  FORBIDDEN: '이 계정으로 주문 내역을 확인할 수 없어요.',
  ORDER_NOT_FOUND: '주문을 찾을 수 없어요. 본인의 주문인지 확인해 주세요.',
  ORDER_NOT_CANCELABLE: '현재 취소할 수 없는 주문이에요.',
  ORDER_PAYMENT_PENDING:
    '결제 결과 확인이 필요해요. 취소 결과를 확정할 수 없어요.',
  ORDER_PAY_IN_PROGRESS:
    '결제 또는 취소 처리가 진행 중이에요. 잠시 후 다시 조회해 주세요.',
  COOKING_ALREADY_STARTED: '조리가 시작되어 취소할 수 없어요.',
  COOKING_ALREADY_DONE: '조리가 완료되어 취소할 수 없어요.',
  COOKING_ORDER_PENDING: '조리 접수 처리 중이에요. 잠시 후 다시 조회해 주세요.',
  COOKING_SERVICE_UNAVAILABLE:
    '취소 요청 결과를 확인하지 못했어요. 처리가 계속될 수 있으니 주문 상태를 다시 확인해 주세요.',
};
export function createOrderApi({
  sessionSource = authSession,
  timeoutMs = 15000,
} = {}) {
  async function call(path, method, signal) {
    const owner = customerKey(sessionSource.getSnapshot());
    if (!owner)
      throw new OrderError(messages.UNAUTHORIZED, 'UNAUTHORIZED', 401);
    const current = () => {
      if (signal?.aborted || owner !== customerKey(sessionSource.getSnapshot()))
        throw new OrderError(
          '이전 세션의 주문 응답은 적용하지 않았어요.',
          'CANCELLED',
        );
    };
    let response, body;
    try {
      response = await sessionSource.request(path, {
        method,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        retryOn401: method === 'GET',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      current();
      if (response.status === 401 || response.status === 403) {
        const code = response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
        throw new OrderError(messages[code], code, response.status);
      }
      body = await response.json();
      current();
    } catch (error) {
      current();
      if (error instanceof OrderError) throw error;
      throw new OrderError(
        method === 'POST'
          ? '취소 요청 결과를 확인하지 못했어요. 주문 상태를 다시 조회해 주세요.'
          : '주문 정보를 불러오지 못했어요. 다시 시도해 주세요.',
        'NETWORK_ERROR',
      );
    }
    if (!response.ok) {
      const code =
        body?.success === false && typeof body.errorCode === 'string'
          ? body.errorCode
          : 'HTTP_ERROR';
      throw new OrderError(
        messages[code] ??
          '주문 요청을 완료하지 못했어요. 최신 상태를 다시 조회해 주세요.',
        code,
        response.status,
      );
    }
    if (response.status !== 200 || body?.success !== true || !body.data)
      invalid();
    return body.data;
  }
  const checkedId = (n) => {
    if (!id(n))
      throw new OrderError('주문 주소를 확인해 주세요.', 'INVALID_REQUEST');
    return n;
  };
  return {
    async list(page = 0, { signal } = {}) {
      if (!Number.isSafeInteger(page) || page < 0 || page > 2147483647)
        throw new OrderError('페이지 주소를 확인해 주세요.', 'INVALID_REQUEST');
      return validateList(
        await call(`/api/v1/orders?page=${page}&size=20`, 'GET', signal),
        page,
        20,
      );
    },
    async detail(n, { signal } = {}) {
      return validateDetail(
        await call(`/api/v1/orders/${checkedId(n)}`, 'GET', signal),
        n,
      );
    },
    async cancel(n, { signal } = {}) {
      const result = validateDetail(
        await call(`/api/v1/orders/${checkedId(n)}/cancel`, 'POST', signal),
        n,
      );
      if (result.status !== 'CANCELED') invalid();
      return result;
    },
  };
}
export function canCancel(order) {
  return (
    order?.status === 'CREATED' ||
    (['PAID', 'WAITING'].includes(order?.status) &&
      order.cooking?.lookup === 'OK' &&
      order.cooking.status === 'WAITING')
  );
}
export function orderStatus(order) {
  const fixed = {
    CREATED: '결제 확인 전',
    CANCELED: '취소됨',
    FAILED: '주문 실패',
    COMPLETED: '완료',
  };
  if (fixed[order.status]) return fixed[order.status];
  const c = order.cooking;
  if (c?.lookup === 'PENDING') return '조리 접수 대기';
  if (c?.lookup === 'UNAVAILABLE') return '조리 상태 확인 필요';
  if (c?.lookup === 'OK')
    return {
      WAITING: '조리 대기',
      COOKING: '조리 중',
      DONE: '픽업 대기',
      CANCELED: '취소 처리 중',
    }[c.status];
  return (
    { PAID: '결제 완료', WAITING: '조리 대기', COOKING: '조리 중' }[
      order.status
    ] ?? '상태 확인 필요'
  );
}
