import { CheckoutError, prepareCheckout } from './checkoutFlow.js';

// Deliberate in-browser preview adapter. No HTTP, persistence, stock writes or
// real payment. Test-only HTTP servers/fixtures are never imported here.
export function createMockCheckoutAdapter({
  resolveMenu,
  scenario = 'success',
  estimateScenario = 'success',
  delay = 450,
  clock = Date.now,
} = {}) {
  const orders = new Map();
  const interrupted = new Set();
  let sequence = 0;
  const pause = (signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const done = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(done, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  const read = (id) => {
    if (!orders.has(id))
      throw new CheckoutError('ORDER_NOT_FOUND', 'Mock 주문을 찾을 수 없어요.');
    return structuredClone(orders.get(id));
  };
  return {
    mode: 'mock',
    async estimate({ items }, { signal } = {}) {
      await pause(signal);
      prepareCheckout(items, resolveMenu);
      if (estimateScenario === 'unavailable')
        throw new CheckoutError(
          'MENU_NOT_AVAILABLE',
          '선택 메뉴는 현재 판매할 수 없어요.',
        );
      if (estimateScenario === 'outage')
        throw new CheckoutError(
          'MENU_SERVICE_UNAVAILABLE',
          '예상시간 서비스를 이용할 수 없어요. 다시 시도해 주세요.',
        );
      if (estimateScenario === 'invalid') return { expectedWaitSec: -1 };
      if (estimateScenario === 'timeout')
        throw new CheckoutError('TIMEOUT', '예상시간 조회 시간이 초과됐어요.');
      return { expectedWaitSec: 420, cookSec: 480, expectedReadySec: 900 };
    },
    async create({ items }, { signal } = {}) {
      await pause(signal);
      if (scenario === 'create-failed')
        throw new CheckoutError(
          'OUT_OF_STOCK',
          'Mock 재고가 부족하여 임시 주문을 만들지 못했어요.',
          { definitive: true },
        );
      const input = prepareCheckout(items, resolveMenu);
      const order = {
        orderId: ++sequence,
        status: 'CREATED',
        totalAmount: input.total,
        orderedAt: new Date(clock()).toISOString(),
        holdExpiresAt: new Date(clock() + 300000).toISOString(),
        items: input.rows.map((row) => ({
          menuId: row.menuId,
          menuName: row.name,
          unitPrice: resolveMenu(row.menuId).basePrice,
          quantity: row.quantity,
          lineAmount: row.total,
          options: row.optionIds.map((id, i) => ({
            optionId: id,
            optionName: row.optionNames[i],
            extraPrice: resolveMenu(row.menuId).options.find((o) => o.id === id)
              .extraPrice,
          })),
        })),
      };
      orders.set(order.orderId, order);
      return read(order.orderId);
    },
    async pay(id, { signal } = {}) {
      await pause(signal);
      const order = read(id);
      if (order.status === 'PAID') return order;
      if (order.status !== 'CREATED')
        throw new CheckoutError(
          'ORDER_NOT_PAYABLE',
          '종료된 Mock 주문이에요.',
          { definitive: true },
        );
      if (scenario === 'declined') {
        orders.set(id, {
          ...order,
          status: 'FAILED',
          holdExpiresAt: undefined,
        });
        throw new CheckoutError(
          'PAYMENT_FAILED',
          'Mock 결제가 거절됐어요. 새 임시 주문부터 다시 확인해 주세요.',
          { definitive: true },
        );
      }
      if (
        scenario === 'unknown' ||
        (scenario === 'recoverable' && !interrupted.has(id))
      ) {
        interrupted.add(id);
        if (scenario === 'recoverable')
          orders.set(id, {
            ...order,
            holdExpiresAt: new Date(clock() - 1).toISOString(),
          });
        throw new CheckoutError(
          'PAYMENT_SERVICE_UNAVAILABLE',
          'Mock 결제 결과 불명',
        );
      }
      const paid = {
        ...order,
        status: 'PAID',
        orderNo: `MOCK-${String(id).padStart(4, '0')}`,
        holdExpiresAt: undefined,
        paidAt: new Date(clock()).toISOString(),
        cooking: { lookup: 'PENDING' },
      };
      orders.set(id, paid);
      if (scenario === 'unknown-paid')
        throw new CheckoutError('TIMEOUT', 'Mock 결제 응답 유실');
      return read(id);
    },
    async get(id, { signal } = {}) {
      await pause(signal);
      return read(id);
    },
  };
}
