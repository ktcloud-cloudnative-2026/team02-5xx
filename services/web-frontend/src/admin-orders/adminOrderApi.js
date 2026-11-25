export const ORDER_STATUSES = Object.freeze({
  CREATED: '임시 주문',
  PAID: '결제 완료',
  WAITING: '조리 대기',
  COOKING: '조리 중',
  COMPLETED: '완료',
  CANCELED: '취소',
  FAILED: '실패',
});
export class AdminOrderError extends Error {
  constructor(message, { status = 0, code = '', kind = 'http' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}
const invalid = () => {
  throw new AdminOrderError(
    '주문 서버 응답을 확인할 수 없어요. 다시 조회해 주세요.',
    { kind: 'protocol' },
  );
};
const inputError = (message) => {
  throw new AdminOrderError(message, { kind: 'input' });
};
const id = (v) => Number.isSafeInteger(v) && v > 0;
const integer = (v) => Number.isInteger(v) && v >= 0 && v <= 2147483647;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const optionalText = (v) => v == null || typeof v === 'string';
const timestamp = (v) =>
  typeof v === 'string' &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const optionalTime = (v) => v == null || timestamp(v);
export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : NaN;
}
export function defaultSearch(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    from: new Date(dateValue(today) - 30 * 86400000).toISOString().slice(0, 10),
    to: today,
    orderNo: '',
    status: '',
    manualReviewRequired: false,
    page: 0,
    size: 20,
  };
}
export function adminSearchParams(query = {}) {
  const {
    from = '',
    to = '',
    orderNo = '',
    status = '',
    manualReviewRequired = false,
    page = 0,
    size = 20,
  } = query;
  if (typeof orderNo !== 'string' || typeof manualReviewRequired !== 'boolean')
    inputError('검색 조건을 확인해 주세요.');
  for (const value of [from, to])
    if (value !== '' && !Number.isFinite(dateValue(value)))
      inputError('검색 날짜를 올바르게 입력해 주세요.');
  if (
    from &&
    to &&
    (dateValue(from) > dateValue(to) ||
      (dateValue(to) - dateValue(from)) / 86400000 > 30)
  )
    inputError('검색 기간은 시작일과 종료일을 포함해 최대 31일이에요.');
  if (status && !Object.hasOwn(ORDER_STATUSES, status))
    inputError('주문 상태를 확인해 주세요.');
  if (!integer(page) || !Number.isInteger(size) || size < 1 || size > 100)
    inputError('페이지와 조회 건수를 확인해 주세요.');
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (orderNo.trim()) params.set('orderNo', orderNo.trim());
  if (status) params.set('status', status);
  if (manualReviewRequired) params.set('manualReviewRequired', 'true');
  params.set('page', String(page));
  params.set('size', String(size));
  return params;
}
function common(value) {
  if (
    !value ||
    !id(value.orderId) ||
    !id(value.userId) ||
    !Object.hasOwn(ORDER_STATUSES, value.status) ||
    !integer(value.totalAmount) ||
    !timestamp(value.orderedAt) ||
    !optionalText(value.orderNo) ||
    !optionalTime(value.canceledAt) ||
    typeof value.manualReviewRequired !== 'boolean'
  )
    invalid();
  return {
    orderId: value.orderId,
    orderNo: value.orderNo,
    userId: value.userId,
    status: value.status,
    totalAmount: value.totalAmount,
    orderedAt: value.orderedAt,
    canceledAt: value.canceledAt,
    manualReviewRequired: value.manualReviewRequired,
  };
}
function summary(value) {
  const result = common(value);
  if (!integer(value.itemCount) || !optionalText(value.representativeMenuName))
    invalid();
  return Object.freeze({
    ...result,
    itemCount: value.itemCount,
    representativeMenuName: value.representativeMenuName,
  });
}
export function validateAdminDetail(value, expectedId) {
  const result = common(value);
  if (
    result.orderId !== expectedId ||
    !integer(value.cancelFollowUpAttempts) ||
    !Array.isArray(value.items) ||
    (value.paymentId != null && !id(value.paymentId))
  )
    invalid();
  const optional = {};
  for (const key of [
    'paidAt',
    'completedAt',
    'cancelRequestedAt',
    'stockRestoredAt',
    'refundedAt',
  ]) {
    if (!optionalTime(value[key])) invalid();
    optional[key] = value[key];
  }
  for (const key of ['cancelReason', 'failReason', 'manualReviewReason']) {
    if (!optionalText(value[key])) invalid();
    optional[key] = value[key];
  }
  const items = value.items.map((item) => {
    if (
      !item ||
      !id(item.menuId) ||
      !text(item.menuName) ||
      !integer(item.unitPrice) ||
      !integer(item.quantity) ||
      item.quantity < 1 ||
      !integer(item.lineAmount) ||
      !Array.isArray(item.options)
    )
      invalid();
    const options = item.options.map((option) => {
      if (
        !option ||
        !id(option.optionId) ||
        !text(option.optionName) ||
        !integer(option.extraPrice)
      )
        invalid();
      return Object.freeze({
        optionId: option.optionId,
        optionName: option.optionName,
        extraPrice: option.extraPrice,
      });
    });
    if (
      new Set(options.map((option) => option.optionId)).size !==
        options.length ||
      (item.unitPrice +
        options.reduce((sum, option) => sum + option.extraPrice, 0)) *
        item.quantity !==
        item.lineAmount
    )
      invalid();
    return Object.freeze({
      menuId: item.menuId,
      menuName: item.menuName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineAmount: item.lineAmount,
      options: Object.freeze(options),
    });
  });
  if (
    items.reduce((sum, item) => sum + item.lineAmount, 0) !== result.totalAmount
  )
    invalid();
  return Object.freeze({
    ...result,
    ...optional,
    paymentId: value.paymentId,
    cancelFollowUpAttempts: value.cancelFollowUpAttempts,
    items: Object.freeze(items),
  });
}
function httpError(status, code = '') {
  const message =
    status === 401
      ? '인증이 필요하거나 만료됐어요. 관리자 인증 상태를 확인해 주세요.'
      : status === 403
        ? '관리자 주문을 조회할 권한이 없어요.'
        : status === 404 && code === 'ORDER_NOT_FOUND'
          ? '주문을 찾을 수 없어요. 목록에서 다시 확인해 주세요.'
          : status === 404
            ? '관리자 주문 조회 API가 비활성화되어 있거나 경로를 사용할 수 없어요.'
            : status === 400
              ? '검색 조건을 처리할 수 없어요. 날짜·상태·페이지를 확인해 주세요.'
              : '주문을 조회하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return new AdminOrderError(message, { status, code });
}
export function createAdminOrderApi({
  request = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  async function get(path, signal) {
    let response;
    try {
      response = await request(path, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AdminOrderError(
        '서버에 연결하지 못했어요. 연결을 확인하고 다시 조회해 주세요.',
        { kind: 'network' },
      );
    }
    signal?.throwIfAborted();
    if (response.status === 401 || response.status === 403)
      throw httpError(
        response.status,
        response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
      );
    let body;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) throw httpError(response.status);
      invalid();
    }
    signal?.throwIfAborted();
    if (!response.ok) throw httpError(response.status, body?.errorCode);
    if (body?.success !== true || body.data == null) invalid();
    return body.data;
  }
  return Object.freeze({
    async list(query, { signal } = {}) {
      const params = adminSearchParams(query);
      const data = await get(`/api/v1/admin/orders?${params}`, signal);
      if (
        !Array.isArray(data.items) ||
        !integer(data.page) ||
        !integer(data.size) ||
        data.size < 1 ||
        data.size > 100 ||
        !Number.isSafeInteger(data.totalElements) ||
        data.totalElements < 0 ||
        data.items.length > data.size ||
        data.page !== Number(params.get('page')) ||
        data.size !== Number(params.get('size')) ||
        data.items.length > data.totalElements
      )
        invalid();
      const items = data.items.map(summary);
      if (new Set(items.map((item) => item.orderId)).size !== items.length)
        invalid();
      return Object.freeze({
        page: data.page,
        size: data.size,
        totalElements: data.totalElements,
        items: Object.freeze(items),
      });
    },
    async detail(orderId, { signal } = {}) {
      if (!id(orderId)) inputError('주문 ID를 확인해 주세요.');
      return validateAdminDetail(
        await get(`/api/v1/admin/orders/${orderId}`, signal),
        orderId,
      );
    },
  });
}
