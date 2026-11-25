import { validateCongestion } from '../home/congestionApi.js';

export const COOKING_ENDPOINTS = Object.freeze({
  congestion: '/api/v1/cooking/congestion',
  overview: '/api/v1/admin/cooking/overview',
  queue: '/api/v1/admin/cooking/queue',
});
export class CookingError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    Object.assign(this, { kind, status });
  }
}
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const positive = (value) => nonnegative(value) && value > 0;
const nonblank = (value) =>
  typeof value === 'string' && value.trim().length > 0;
function protocol() {
  throw new CookingError(
    'protocol',
    '응답 형식이 올바르지 않아요. 다시 조회해 주세요.',
  );
}
export function isCookingTime(value) {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, zone, zoneHour, zoneMinute] =
    match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return (
    date.getUTCFullYear() === +year &&
    date.getUTCMonth() + 1 === +month &&
    date.getUTCDate() === +day &&
    +hour < 24 &&
    +minute < 60 &&
    +second < 60 &&
    (zone === 'Z' ||
      (+zoneHour <= 18 &&
        +zoneMinute < 60 &&
        (+zoneHour < 18 || +zoneMinute === 0)))
  );
}
export function validateCooking(area, data) {
  if (area === 'congestion') {
    try {
      return Object.freeze(validateCongestion(data));
    } catch {
      protocol();
    }
  }
  if (!data || typeof data !== 'object') protocol();
  if (area === 'overview') {
    if (
      ![
        'waitingCount',
        'cookingCount',
        'completedToday',
        'canceledToday',
        'expectedWaitSec',
      ].every((key) => nonnegative(data[key])) ||
      !(data.cookingOrderNo == null || nonblank(data.cookingOrderNo))
    )
      protocol();
    return Object.freeze({
      waitingCount: data.waitingCount,
      cookingCount: data.cookingCount,
      completedToday: data.completedToday,
      canceledToday: data.canceledToday,
      expectedWaitSec: data.expectedWaitSec,
      cookingOrderNo: data.cookingOrderNo ?? null,
    });
  }
  if (
    area !== 'queue' ||
    !nonnegative(data.count) ||
    data.count > 2147483647 ||
    !Array.isArray(data.items) ||
    data.items.length !== data.count
  )
    protocol();
  const ids = new Set(),
    orderNos = new Set();
  const items = data.items.map((entry, index) => {
    if (
      !entry ||
      entry.position !== index + 1 ||
      !positive(entry.orderId) ||
      ids.has(entry.orderId) ||
      !nonblank(entry.orderNo) ||
      orderNos.has(entry.orderNo) ||
      !isCookingTime(entry.queuedAt) ||
      !nonnegative(entry.estimatedCookSec) ||
      entry.estimatedCookSec > 2147483647 ||
      (index > 0 &&
        Date.parse(data.items[index - 1].queuedAt) > Date.parse(entry.queuedAt))
    )
      protocol();
    ids.add(entry.orderId);
    orderNos.add(entry.orderNo);
    return Object.freeze({
      position: entry.position,
      orderId: entry.orderId,
      orderNo: entry.orderNo,
      queuedAt: entry.queuedAt,
      estimatedCookSec: entry.estimatedCookSec,
    });
  });
  return Object.freeze({ count: data.count, items: Object.freeze(items) });
}
function httpError(status) {
  const message =
    status === 401
      ? '관리자 인증이 필요하거나 만료됐어요.'
      : status === 403
        ? 'STORE_ADMIN 권한이 필요해요.'
        : status === 404
          ? 'API가 비활성화되어 있거나 경로를 사용할 수 없어요.'
          : status >= 500
            ? '조리 서비스가 응답하지 않아요. 잠시 후 다시 조회해 주세요.'
            : '조리 현황을 조회하지 못했어요. 다시 조회해 주세요.';
  return new CookingError('http', message, status);
}
export function createCookingApi({
  request = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  return Object.freeze({
    async get(area, { signal } = {}) {
      if (!Object.hasOwn(COOKING_ENDPOINTS, area))
        throw new CookingError('input', '조회 영역을 확인해 주세요.');
      const deadline = AbortSignal.timeout(timeoutMs);
      try {
        const response = await request(COOKING_ENDPOINTS[area], {
          method: 'GET',
          credentials: area === 'congestion' ? 'omit' : 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        });
        signal?.throwIfAborted();
        if (!response.ok) throw httpError(response.status);
        let body;
        try {
          body = await response.json();
        } catch (error) {
          if (error instanceof SyntaxError) protocol();
          throw error;
        }
        signal?.throwIfAborted();
        if (
          response.status !== 200 ||
          body?.success !== true ||
          typeof body.message !== 'string'
        )
          protocol();
        return validateCooking(area, body.data);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (deadline.aborted)
          throw new CookingError(
            'timeout',
            '조회 시간이 초과됐어요. 다시 조회해 주세요.',
          );
        if (error instanceof CookingError) throw error;
        throw new CookingError(
          'network',
          '네트워크 연결을 확인하지 못했어요. 다시 조회해 주세요.',
        );
      }
    },
  });
}
