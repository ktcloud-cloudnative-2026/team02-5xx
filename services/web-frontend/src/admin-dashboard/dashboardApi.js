import { createMenuApi } from '../data/menuApi.js';

export const DASHBOARD_PATHS = Object.freeze({
  operations: '/api/v1/admin/store/operations',
  congestion: '/api/v1/cooking/congestion',
  overview: '/api/v1/admin/cooking/overview',
  queue: '/api/v1/admin/cooking/queue',
  stock: '/api/v1/admin/inventory/items?lowStockOnly=true',
});
export const DASHBOARD_RESOURCES = Object.freeze([
  ...Object.keys(DASHBOARD_PATHS),
  'menus',
]);
export class DashboardError extends Error {
  constructor(
    message,
    { status = 0, kind = 'http', code = '', uncertain = false } = {},
  ) {
    super(message);
    Object.assign(this, { status, kind, code, uncertain });
  }
}
const whole = (value) => Number.isSafeInteger(value) && value >= 0;
const positive = (value) => whole(value) && value > 0;
const int = (value) => whole(value) && value <= 2147483647;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
export function dashboardTime(value) {
  if (typeof value !== 'string') return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    zone,
    offsetHour,
    offsetMinute,
  ] = parts;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    (zone === 'Z' ||
      (Number(offsetHour) <= 18 &&
        Number(offsetMinute) < 60 &&
        (Number(offsetHour) < 18 || Number(offsetMinute) === 0)))
  );
}
function invalid() {
  throw new DashboardError(
    '서버 응답이 계약과 달라요. 해당 영역을 다시 조회해 주세요.',
    { kind: 'protocol' },
  );
}
export function validateDashboard(resource, data) {
  if (resource === 'stock') {
    if (!Array.isArray(data)) invalid();
    const seen = new Set();
    return Object.freeze(
      data.map((item, index) => {
        if (
          !item ||
          !positive(item.stockItemId) ||
          seen.has(item.stockItemId) ||
          (index && data[index - 1].stockItemId >= item.stockItemId) ||
          !(item.menuId === null || positive(item.menuId)) ||
          ![
            item.stockQty,
            item.reservedQty,
            item.availableQty,
            item.lowStockThreshold,
          ].every(int) ||
          item.reservedQty > item.stockQty ||
          item.availableQty !== item.stockQty - item.reservedQty ||
          item.availableQty > item.lowStockThreshold ||
          item.lowStock !== true
        )
          invalid();
        seen.add(item.stockItemId);
        return Object.freeze({
          stockItemId: item.stockItemId,
          menuId: item.menuId,
          stockQty: item.stockQty,
          reservedQty: item.reservedQty,
          availableQty: item.availableQty,
          lowStockThreshold: item.lowStockThreshold,
          lowStock: item.lowStock,
        });
      }),
    );
  }
  if (!data || typeof data !== 'object') invalid();
  if (resource === 'operations') {
    if (
      typeof data.isOpen !== 'boolean' ||
      typeof data.acceptingOrders !== 'boolean' ||
      !(data.updatedAt === null || dashboardTime(data.updatedAt))
    )
      invalid();
    return Object.freeze({
      isOpen: data.isOpen,
      acceptingOrders: data.acceptingOrders,
      updatedAt: data.updatedAt,
    });
  }
  if (resource === 'congestion') {
    if (
      !['NORMAL', 'CROWDED'].includes(data.level) ||
      ![data.waitingCount, data.cookingCount, data.expectedWaitSec].every(whole)
    )
      invalid();
    return Object.freeze({
      level: data.level,
      waitingCount: data.waitingCount,
      cookingCount: data.cookingCount,
      expectedWaitSec: data.expectedWaitSec,
    });
  }
  if (resource === 'overview') {
    if (
      ![
        data.waitingCount,
        data.cookingCount,
        data.completedToday,
        data.canceledToday,
        data.expectedWaitSec,
      ].every(whole) ||
      !(data.cookingOrderNo == null || text(data.cookingOrderNo))
    )
      invalid();
    return Object.freeze({
      waitingCount: data.waitingCount,
      cookingCount: data.cookingCount,
      completedToday: data.completedToday,
      canceledToday: data.canceledToday,
      expectedWaitSec: data.expectedWaitSec,
      cookingOrderNo: data.cookingOrderNo ?? null,
    });
  }
  if (resource === 'queue') {
    if (
      !int(data.count) ||
      !Array.isArray(data.items) ||
      data.count !== data.items.length
    )
      invalid();
    const ids = new Set(),
      numbers = new Set();
    const items = data.items.map((item, index) => {
      if (
        !item ||
        item.position !== index + 1 ||
        !positive(item.orderId) ||
        ids.has(item.orderId) ||
        !text(item.orderNo) ||
        numbers.has(item.orderNo) ||
        !dashboardTime(item.queuedAt) ||
        !int(item.estimatedCookSec) ||
        (index &&
          Date.parse(data.items[index - 1].queuedAt) >
            Date.parse(item.queuedAt))
      )
        invalid();
      ids.add(item.orderId);
      numbers.add(item.orderNo);
      return Object.freeze({
        position: item.position,
        orderId: item.orderId,
        orderNo: item.orderNo,
        queuedAt: item.queuedAt,
        estimatedCookSec: item.estimatedCookSec,
      });
    });
    return Object.freeze({ count: data.count, items: Object.freeze(items) });
  }
  invalid();
}
const statusMessage = (status) =>
  status === 400
    ? '변경 요청을 처리할 수 없어요. 상태를 다시 확인해 주세요.'
    : status === 401
      ? '관리자 인증이 필요하거나 만료됐어요.'
      : status === 403
        ? 'STORE_ADMIN 권한이 필요해요.'
        : status === 404
          ? '관리자 API가 비활성화되어 있거나 경로를 사용할 수 없어요.'
          : status === 503
            ? '서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 조회해 주세요.'
            : '서비스 요청에 실패했어요. 해당 영역을 다시 조회해 주세요.';
export function createDashboardApi({
  request = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  const menuApi = createMenuApi({
    fetchImpl: (path, options) =>
      request(path, {
        ...options,
        credentials: 'same-origin',
        redirect: 'error',
      }),
  });
  async function call(resource, { signal, body } = {}) {
    const write = body !== undefined;
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      if (resource === 'menus') {
        const data = await menuApi.list({}, { signal: combined });
        signal?.throwIfAborted();
        return Object.freeze(
          data.menus.map(({ id, name, status }) =>
            Object.freeze({ id, name, status }),
          ),
        );
      }
      const response = await request(DASHBOARD_PATHS[resource], {
        method: write ? 'PATCH' : 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: combined,
        headers: {
          Accept: 'application/json',
          ...(write ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(write ? { body: JSON.stringify(body) } : {}),
      });
      signal?.throwIfAborted();
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        if (!response.ok)
          throw new DashboardError(statusMessage(response.status), {
            status: response.status,
            uncertain: write && response.status >= 500,
          });
        invalid();
      }
      signal?.throwIfAborted();
      if (!response.ok)
        throw new DashboardError(statusMessage(response.status), {
          status: response.status,
          code:
            typeof envelope?.errorCode === 'string' ? envelope.errorCode : '',
          uncertain: write && response.status >= 500,
        });
      if (
        response.status !== 200 ||
        envelope?.success !== true ||
        typeof envelope.message !== 'string'
      )
        invalid();
      const data = validateDashboard(resource, envelope.data);
      if (
        write &&
        Object.entries(body).some(([key, value]) => data[key] !== value)
      )
        invalid();
      return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (deadline.aborted)
        throw new DashboardError(
          '응답 시간이 초과됐어요. 다시 조회해 주세요.',
          { kind: 'timeout', uncertain: write },
        );
      if (error instanceof DashboardError) {
        if (write && error.kind === 'protocol') error.uncertain = true;
        throw error;
      }
      if (resource === 'menus' && error.status)
        throw new DashboardError(statusMessage(error.status), {
          status: error.status,
        });
      throw new DashboardError(
        resource === 'menus'
          ? '메뉴 이름을 조회하지 못했어요. 재고 수량은 별도로 확인할 수 있어요.'
          : '네트워크 연결을 확인하지 못했어요. 다시 조회해 주세요.',
        { kind: 'network', uncertain: write },
      );
    }
  }
  return Object.freeze({
    read(resource, { signal } = {}) {
      if (!DASHBOARD_RESOURCES.includes(resource))
        throw new DashboardError('조회 영역을 확인해 주세요.', {
          kind: 'input',
        });
      return call(resource, { signal });
    },
    update(field, value) {
      if (
        !['isOpen', 'acceptingOrders'].includes(field) ||
        typeof value !== 'boolean'
      )
        throw new DashboardError('변경할 상태는 명확한 불린 값이어야 해요.', {
          kind: 'input',
        });
      // Only this field is sent. A dispatched mutation is never retried or aborted by navigation.
      return call('operations', { body: { [field]: value } });
    },
  });
}
