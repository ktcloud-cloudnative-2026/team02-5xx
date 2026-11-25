import { cartView } from '../cart.js';

export class CheckoutError extends Error {
  constructor(code, message, { definitive = false } = {}) {
    super(message);
    this.code = code;
    this.definitive = definitive;
  }
}
export function customerKey(session) {
  const user = session?.user;
  if (
    session?.authenticated !== true ||
    user?.role !== 'CUSTOMER' ||
    !(
      (typeof user.id === 'number' &&
        Number.isSafeInteger(user.id) &&
        user.id > 0) ||
      (typeof user.id === 'string' && user.id.trim().length > 0)
    )
  )
    return null;
  return `${typeof user.id}:${user.id}`;
}
export function prepareCheckout(items, resolveMenu) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new CheckoutError(
      'INVALID_REQUEST',
      '주문할 메뉴를 1~20개 선택해 주세요.',
    );
  }
  const view = cartView(items, resolveMenu);
  if (!Number.isSafeInteger(view.total) || view.total > 2147483647)
    throw new CheckoutError(
      'INVALID_REQUEST',
      '주문 가능한 금액 범위를 초과했어요.',
    );
  return {
    ...view,
    items: view.rows.map(({ menuId, optionIds, quantity }) => ({
      menuId,
      optionIds: [...optionIds],
      quantity,
    })),
  };
}
const money = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
export function validateEstimate(value) {
  if (
    !value ||
    ![value.expectedWaitSec, value.cookSec, value.expectedReadySec].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    value.expectedReadySec !== value.expectedWaitSec + value.cookSec
  )
    throw new CheckoutError(
      'UPSTREAM_INVALID_RESPONSE',
      '예상시간 응답을 확인할 수 없어요. 다시 조회해 주세요.',
    );
  return {
    expectedWaitSec: value.expectedWaitSec,
    cookSec: value.cookSec,
    expectedReadySec: value.expectedReadySec,
  };
}
export function validateOrder(order, input, expectedId) {
  if (
    !order ||
    !Number.isSafeInteger(order.orderId) ||
    order.orderId < 1 ||
    (expectedId && order.orderId !== expectedId) ||
    !money(order.totalAmount) ||
    !Array.isArray(order.items) ||
    order.items.length !== input.items.length
  )
    throw new CheckoutError(
      'INVALID_RESPONSE',
      '주문 응답이 올바르지 않아 결과 확인이 필요해요.',
    );
  let sum = 0;
  order.items.forEach((row, i) => {
    const request = input.items[i];
    const options = Array.isArray(row.options) ? row.options : [];
    const ids = options.map((o) => o?.optionId).sort((a, b) => a - b);
    const unitWithOptions =
      row.unitPrice + options.reduce((sum, o) => sum + o?.extraPrice, 0);
    if (
      row.menuId !== request.menuId ||
      row.quantity !== request.quantity ||
      !row.menuName?.trim() ||
      !money(row.unitPrice) ||
      !money(row.lineAmount) ||
      !Array.isArray(row.options) ||
      !money(unitWithOptions) ||
      row.lineAmount !== unitWithOptions * row.quantity ||
      JSON.stringify(ids) !== JSON.stringify(request.optionIds) ||
      options.some((o) => !o?.optionName?.trim() || !money(o.extraPrice))
    )
      throw new CheckoutError(
        'INVALID_RESPONSE',
        '주문 항목을 확인할 수 없어요.',
      );
    sum += row.lineAmount;
  });
  if (
    sum !== order.totalAmount ||
    ![
      'CREATED',
      'PAID',
      'WAITING',
      'COOKING',
      'COMPLETED',
      'FAILED',
      'CANCELED',
    ].includes(order.status) ||
    (order.status === 'CREATED' &&
      (order.orderNo != null ||
        !Number.isFinite(Date.parse(order.holdExpiresAt)))) ||
    (['PAID', 'WAITING', 'COOKING', 'COMPLETED'].includes(order.status) &&
      (typeof order.orderNo !== 'string' || !order.orderNo.trim()))
  )
    throw new CheckoutError(
      'INVALID_RESPONSE',
      '주문 상태 또는 금액을 확인할 수 없어요.',
    );
  return structuredClone(order);
}

// Adapter methods return unwrapped API data. They never receive user IDs, tokens,
// payment method UI values, cart prices or inventory/cooking write requests.
export function createCheckoutFlow({
  input,
  adapter,
  sessionSource,
  clock = Date.now,
  timeoutMs = 10000,
  onPaid,
}) {
  const owner = customerKey(sessionSource.getSnapshot());
  if (!owner)
    throw new CheckoutError(
      'CUSTOMER_REQUIRED',
      '고객 계정으로 로그인한 후 주문해 주세요.',
    );
  input = structuredClone(input);
  let snapshot = {
    stage: 'review',
    estimatePhase: 'idle',
    estimate: null,
    order: null,
    error: '',
    errorCode: '',
  };
  let generation = 0,
    disposed = false,
    busy = false,
    activeAbort;
  let completed = false;
  const listeners = new Set();
  const emit = (update) => {
    snapshot = { ...snapshot, ...update };
    listeners.forEach((fn) => fn());
  };
  const current = () =>
    !disposed &&
    snapshot.stage !== 'session-ended' &&
    customerKey(sessionSource.getSnapshot()) === owner;
  const stop = () => {
    generation++;
    activeAbort?.abort();
  };
  const unsubscribe = sessionSource.subscribe(() => {
    if (customerKey(sessionSource.getSnapshot()) !== owner) {
      stop();
      emit({
        stage: 'session-ended',
        order: null,
        estimate: null,
        error:
          '로그인 상태가 변경되어 주문을 중단했어요. 결제 결과가 불명확하면 다시 결제하지 말고 주문 내역을 확인해 주세요.',
      });
    }
  });
  async function run(task, success, failure) {
    if (!current() || busy) return;
    busy = true;
    const version = ++generation;
    const abort = new AbortController();
    activeAbort = abort;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (!current() || version !== generation)
            throw new DOMException('Aborted', 'AbortError');
          return task(abort.signal);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new CheckoutError('TIMEOUT', '응답 시간이 초과됐어요.'));
          }, timeoutMs);
        }),
      ]);
      if (current() && version === generation) success(result);
    } catch (error) {
      if (current() && version === generation) failure(error);
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }
  const unknown = (error) =>
    emit({
      stage: 'unknown',
      recoverable: false,
      errorCode: error.code ?? 'UNKNOWN',
      error:
        error.code === 'ORDER_PAY_IN_PROGRESS' && error.status === 409
          ? '같은 주문의 결제 처리가 진행 중이에요. 잠시 후 주문 상태를 확인해 주세요.'
          : '처리 결과를 확인할 수 없어요. 새 주문을 만들지 말고 주문 상태를 확인해 주세요.',
    });
  function adopt(order, fromCheck = false) {
    if (['PAID', 'WAITING', 'COOKING', 'COMPLETED'].includes(order.status)) {
      let completionWarning = '';
      // Synchronous, once-only local completion after response validation and
      // the run() session/generation fence, never inside a React state updater.
      if (!completed && current()) {
        completed = true;
        try {
          const warning = onPaid?.({
            items: structuredClone(input.items),
            order: structuredClone(order),
          });
          completionWarning = typeof warning === 'string' ? warning : '';
        } catch {
          completionWarning =
            '결제 성공은 확인했지만 장바구니 정리를 완료하지 못했어요. 다시 주문하기 전에 확인해 주세요.';
        }
      }
      if (current())
        emit({
          stage: 'paid',
          order,
          error: '',
          errorCode: '',
          completionWarning,
        });
    } else if (['FAILED', 'CANCELED'].includes(order.status))
      emit({
        stage: 'failed',
        order,
        error:
          '이 주문은 종료됐어요. 주문 내용을 확인하고 새 주문을 진행해 주세요.',
      });
    else
      emit({
        stage: 'unknown',
        order,
        recoverable: fromCheck && order.status === 'CREATED',
        error:
          '아직 확정되지 않았어요. 미결제를 단정할 수 없으므로 같은 주문의 처리를 이어갈 수 있습니다.',
      });
  }
  const failCreate = (error, uncertain = false) =>
    emit({
      stage: 'failed',
      order: null,
      recoverable: false,
      errorCode: error?.code ?? 'UNKNOWN',
      error: uncertain
        ? '주문 준비 결과를 확인하지 못했어요. 결제 전이므로 주문 내용을 다시 확인해 주세요.'
        : error?.message || '주문을 준비하지 못했어요. 다시 확인해 주세요.',
    });
  async function submitPayment(recovery = false) {
    if (
      busy ||
      !current() ||
      (recovery
        ? snapshot.stage !== 'unknown' ||
          !snapshot.recoverable ||
          snapshot.order?.status !== 'CREATED'
        : snapshot.stage !== 'ready')
    )
      return;
    // After an uncertain payment, only the server knows whether payment exists.
    // Even an expired hold must be reconciled by the same OR-02 operation.
    if (!recovery && clock() >= Date.parse(snapshot.order.holdExpiresAt)) {
      emit({
        stage: 'failed',
        error: '결제 가능한 시간이 지났어요. 새 주문을 진행해 주세요.',
        errorCode: 'HOLD_EXPIRED',
      });
      return;
    }
    const id = snapshot.order.orderId;
    emit({ stage: 'paying', recoverable: false, error: '', errorCode: '' });
    await run(
      (signal) => adapter.pay(id, { signal }),
      (data) => {
        try {
          adopt(validateOrder(data, input, id));
        } catch (error) {
          unknown(error);
        }
      },
      (error) =>
        error.definitive === true
          ? emit({
              stage: 'failed',
              error: error.message,
              errorCode: error.code,
            })
          : unknown(error),
    );
  }
  return {
    mode: adapter.mode ?? 'mock',
    input,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    async estimate() {
      if (snapshot.stage !== 'review' || busy || !current()) return;
      emit({ estimatePhase: 'loading', error: '', errorCode: '' });
      await run(
        (signal) => adapter.estimate({ items: input.items }, { signal }),
        (data) => {
          try {
            emit({ estimate: validateEstimate(data), estimatePhase: 'ready' });
          } catch (error) {
            emit({
              estimatePhase: 'error',
              error: error.message,
              errorCode: error.code,
            });
          }
        },
        (error) =>
          emit({
            estimatePhase: 'error',
            estimate: null,
            error: error.message || '예상시간을 조회하지 못했어요.',
            errorCode: error.code ?? 'UNAVAILABLE',
          }),
      );
    },
    async create() {
      if (
        snapshot.stage !== 'review' ||
        snapshot.estimatePhase !== 'ready' ||
        busy ||
        !current()
      )
        return;
      emit({ stage: 'creating', error: '', errorCode: '' });
      await run(
        (signal) => adapter.create({ items: input.items }, { signal }),
        (data) => {
          try {
            const order = validateOrder(data, input);
            if (order.status !== 'CREATED')
              throw new CheckoutError(
                'INVALID_RESPONSE',
                '주문 상태를 다시 확인해 주세요.',
              );
            emit({ stage: 'ready', order });
          } catch (error) {
            failCreate(error, true);
          }
        },
        (error) => failCreate(error, error.definitive !== true),
      );
    },
    pay: () => submitPayment(),
    recover: () => submitPayment(true),
    async check() {
      if (snapshot.stage !== 'unknown' || !snapshot.order || busy || !current())
        return;
      emit({ checking: true, recoverable: false });
      await run(
        (signal) => adapter.get(snapshot.order.orderId, { signal }),
        (data) => {
          try {
            adopt(validateOrder(data, input, snapshot.order.orderId), true);
          } catch (error) {
            unknown(error);
          }
        },
        unknown,
      );
      if (current()) emit({ checking: false });
    },
    restart() {
      if (snapshot.stage !== 'failed' || busy || !current()) return;
      stop();
      emit({
        stage: 'review',
        order: null,
        estimate: null,
        estimatePhase: 'idle',
        error: '',
        errorCode: '',
      });
    },
    dispose() {
      disposed = true;
      stop();
      unsubscribe();
      listeners.clear();
    },
  };
}
