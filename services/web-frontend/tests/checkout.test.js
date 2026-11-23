import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCheckoutFlow,
  prepareCheckout,
  customerKey,
  validateEstimate,
  CheckoutError,
} from '../src/checkout/checkoutFlow.js';
import { createMockCheckoutAdapter } from '../src/checkout/mockCheckoutAdapter.js';
import { getMenu } from '../src/data/menuRepository.js';

const items = [{ menuId: 1, optionIds: [2], quantity: 2 }];
function source() {
  let value = { authenticated: true, user: { id: 1, role: 'CUSTOMER' } };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    publish: (next) => {
      value = next;
      listeners.forEach((fn) => fn());
    },
  };
}
function setup(overrides = {}, options = {}) {
  const sessionSource = source();
  const input = prepareCheckout(items, getMenu);
  const adapter = options.adapter ?? {
    ...createMockCheckoutAdapter({ resolveMenu: getMenu, delay: 0 }),
    ...overrides,
  };
  const flow = createCheckoutFlow({
    input,
    adapter,
    sessionSource,
    ...options,
  });
  return { flow, adapter, sessionSource, input };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

for (const scenario of ['success', 'unknown-paid'])
  test(`paid completion runs exactly once after confirmed result: ${scenario}`, async () => {
    const completed = [];
    const { flow } = setup(
      {},
      {
        adapter: createMockCheckoutAdapter({
          resolveMenu: getMenu,
          delay: 0,
          scenario,
        }),
        onPaid: (result) => completed.push(result),
      },
    );
    await flow.estimate();
    await flow.create();
    await flow.pay();
    if (scenario === 'unknown-paid') {
      assert.equal(completed.length, 0);
      const one = flow.check();
      await flow.check();
      await one;
    }
    await flow.pay();
    await flow.check();
    assert.equal(completed.length, 1);
    assert.deepEqual(completed[0].items, items);
    assert.equal(completed[0].order.status, 'PAID');
    flow.dispose();
  });
for (const scenario of ['declined', 'create-failed', 'unknown'])
  test(`non-confirmed outcome never runs completion: ${scenario}`, async () => {
    let count = 0;
    const { flow } = setup(
      {},
      {
        adapter: createMockCheckoutAdapter({
          resolveMenu: getMenu,
          delay: 0,
          scenario,
        }),
        onPaid: () => {
          count++;
        },
      },
    );
    await flow.estimate();
    await flow.create();
    await flow.pay();
    await flow.check();
    assert.equal(count, 0);
    flow.dispose();
  });
test('completion exception is a paid warning, never a payment failure or a retry', async () => {
  let count = 0;
  const { flow } = setup(
    {},
    {
      onPaid: () => {
        count++;
        throw new Error('storage');
      },
    },
  );
  await flow.estimate();
  await flow.create();
  await flow.pay();
  await flow.check();
  assert.equal(flow.getSnapshot().stage, 'paid');
  assert.ok(flow.getSnapshot().completionWarning);
  assert.equal(count, 1);
  flow.dispose();
});
for (const action of ['logout', 'switch', 'dispose'])
  test(`late paid response does not run completion after ${action}`, async () => {
    let count = 0;
    const wait = deferred();
    const { flow, adapter, sessionSource } = setup(
      {},
      {
        onPaid: () => {
          count++;
        },
      },
    );
    await flow.estimate();
    await flow.create();
    adapter.pay = () => wait.promise;
    const response = {
      ...flow.getSnapshot().order,
      status: 'PAID',
      orderNo: 'MOCK-LATE',
      holdExpiresAt: undefined,
    };
    const pending = flow.pay();
    await Promise.resolve();
    if (action === 'dispose') flow.dispose();
    else
      sessionSource.publish(
        action === 'logout'
          ? null
          : { authenticated: true, user: { id: 2, role: 'CUSTOMER' } },
      );
    wait.resolve(response);
    await pending;
    assert.equal(count, 0);
    flow.dispose();
  });

test('checkout input ignores persisted names/prices and validates catalog, options, quantities and limits', () => {
  const input = prepareCheckout(
    [{ ...items[0], unitPrice: 1, name: 'forged' }],
    getMenu,
  );
  assert.equal(input.total, 18000);
  assert.equal(input.rows[0].name, '클래식 버거');
  assert.deepEqual(Object.keys(input.items[0]).sort(), [
    'menuId',
    'optionIds',
    'quantity',
  ]);
  for (const bad of [
    [],
    Array(21).fill(items[0]),
    [{ ...items[0], quantity: 0 }],
    [{ ...items[0], optionIds: [999] }],
    [{ ...items[0], menuId: 4 }],
  ])
    assert.throws(() => prepareCheckout(bad, getMenu));
  assert.throws(() =>
    prepareCheckout(items, (id) => ({ ...getMenu(id), basePrice: undefined })),
  );
});
test('checkout requires authenticated CUSTOMER and stable identity; roles alone never grant access', () => {
  for (const session of [
    null,
    { role: 'CUSTOMER' },
    { authenticated: true },
    { authenticated: true, user: { id: 1, role: 'STORE_ADMIN' } },
  ])
    assert.equal(customerKey(session), null);
  assert.equal(customerKey(source().getSnapshot()), 'number:1');
});
test('estimate seconds distinguish wait, cooking, ready and reject malformed responses', () => {
  assert.deepEqual(
    validateEstimate({ expectedWaitSec: 0, cookSec: 60, expectedReadySec: 60 }),
    { expectedWaitSec: 0, cookSec: 60, expectedReadySec: 60 },
  );
  for (const data of [
    null,
    {},
    { expectedWaitSec: -1, cookSec: 60, expectedReadySec: 59 },
    { expectedWaitSec: 60, cookSec: 60, expectedReadySec: 60 },
  ])
    assert.throws(() => validateEstimate(data));
});
test('estimate errors can retry; no order created until estimate succeeds', async () => {
  let count = 0;
  const { flow } = setup({
    estimate: async () => {
      if (++count === 1) throw new Error('temporary');
      return { expectedWaitSec: 0, cookSec: 1, expectedReadySec: 1 };
    },
  });
  await flow.create();
  assert.equal(flow.getSnapshot().stage, 'review');
  await flow.estimate();
  assert.equal(flow.getSnapshot().estimatePhase, 'error');
  await flow.estimate();
  assert.equal(flow.getSnapshot().estimatePhase, 'ready');
  flow.dispose();
});
test('Mock happy path creates temporary ID first, then numbered PAID without modifying input/cart', async () => {
  const { flow, input } = setup();
  const original = JSON.stringify(input);
  await flow.estimate();
  await flow.create();
  assert.equal(flow.getSnapshot().stage, 'ready');
  assert.equal(flow.getSnapshot().order.orderNo, undefined);
  assert.ok(flow.getSnapshot().order.holdExpiresAt);
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'paid');
  assert.match(flow.getSnapshot().order.orderNo, /^MOCK-/);
  assert.equal(JSON.stringify(input), original);
  flow.dispose();
});
test('clear payment failure cannot reuse old temporary order; explicit restart creates a new one', async () => {
  const { flow } = setup(
    {},
    {
      adapter: createMockCheckoutAdapter({
        resolveMenu: getMenu,
        delay: 0,
        scenario: 'declined',
      }),
    },
  );
  await flow.estimate();
  await flow.create();
  const id = flow.getSnapshot().order.orderId;
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'failed');
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'failed');
  flow.restart();
  await flow.estimate();
  await flow.create();
  assert.notEqual(flow.getSnapshot().order.orderId, id);
  flow.dispose();
});
test('unknown payment blocks further pay/create; status lookup alone can confirm paid', async () => {
  let pays = 0;
  const { flow, adapter } = setup(
    {},
    {
      adapter: createMockCheckoutAdapter({
        resolveMenu: getMenu,
        delay: 0,
        scenario: 'unknown-paid',
      }),
    },
  );
  const pay = adapter.pay;
  adapter.pay = (...args) => {
    pays++;
    return pay(...args);
  };
  await flow.estimate();
  await flow.create();
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'unknown');
  await flow.pay();
  await flow.create();
  flow.restart();
  assert.equal(pays, 1);
  await flow.check();
  assert.equal(flow.getSnapshot().stage, 'paid');
  flow.dispose();
});
test('CREATED lookup stays unknown and only permits explicit same-order recovery', async () => {
  const { flow } = setup(
    {},
    {
      adapter: createMockCheckoutAdapter({
        resolveMenu: getMenu,
        delay: 0,
        scenario: 'unknown',
      }),
    },
  );
  await flow.estimate();
  await flow.create();
  await flow.pay();
  await flow.check();
  assert.equal(flow.getSnapshot().stage, 'unknown');
  assert.equal(flow.getSnapshot().recoverable, true);
  flow.dispose();
});
test('create transport error or malformed write response stays unknown without automatic retry', async () => {
  for (const create of [
    async () => {
      throw new Error('network');
    },
    async () => ({ status: 'PAID' }),
  ]) {
    const { flow } = setup({ create });
    await flow.estimate();
    await flow.create();
    assert.equal(flow.getSnapshot().stage, 'unknown');
    assert.equal(flow.getSnapshot().order, null);
    flow.restart();
    await flow.create();
    assert.equal(flow.getSnapshot().stage, 'unknown');
    flow.dispose();
  }
});
test('duplicate create/pay clicks start exactly one operation', async () => {
  const { flow, adapter } = setup();
  for (const method of ['create', 'pay']) {
    const wait = deferred();
    const original = adapter[method];
    let count = 0;
    adapter[method] = async (...args) => {
      count++;
      await wait.promise;
      return original(...args);
    };
    if (method === 'create') await flow.estimate();
    const first = flow[method]();
    await flow[method]();
    assert.equal(count, 1);
    wait.resolve();
    await first;
  }
  assert.equal(flow.getSnapshot().stage, 'paid');
  flow.dispose();
});
for (const next of [
  null,
  { authenticated: true, user: { id: 2, role: 'CUSTOMER' } },
  { authenticated: true, user: { id: 1, role: 'STORE_ADMIN' } },
]) {
  test(`session change fences pending response and no previous action resumes: ${JSON.stringify(next)}`, async () => {
    const wait = deferred();
    const { flow, sessionSource } = setup({ estimate: () => wait.promise });
    const pending = flow.estimate();
    sessionSource.publish(next);
    wait.resolve({ expectedWaitSec: 0, cookSec: 1, expectedReadySec: 1 });
    await pending;
    assert.equal(flow.getSnapshot().stage, 'session-ended');
    sessionSource.publish({
      authenticated: true,
      user: { id: 1, role: 'CUSTOMER' },
    });
    await flow.create();
    assert.equal(flow.getSnapshot().stage, 'session-ended');
    flow.dispose();
  });
}
test('dispose blocks late response and estimate timeout is retryable', async () => {
  const wait = deferred();
  const { flow } = setup({ estimate: () => wait.promise }, { timeoutMs: 5 });
  await flow.estimate();
  assert.equal(flow.getSnapshot().estimatePhase, 'error');
  flow.dispose();
  wait.resolve({ expectedWaitSec: 0, cookSec: 1, expectedReadySec: 1 });
  assert.equal(flow.getSnapshot().estimatePhase, 'error');
});
test('hold expiry blocks payment locally and Mock never invents a real order number', async () => {
  let time = Date.now();
  const { flow } = setup({}, { clock: () => time });
  await flow.estimate();
  await flow.create();
  time += 600000;
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'failed');
  assert.equal(flow.getSnapshot().errorCode, 'HOLD_EXPIRED');
  flow.dispose();
});
test('server recalculation is used after create and payment method is never sent', async () => {
  const { flow, adapter } = setup();
  const original = adapter.create;
  let request;
  adapter.create = async (...args) => {
    request = args[0];
    const result = await original(...args);
    result.totalAmount = 20000;
    result.items[0].unitPrice = 7500;
    result.items[0].lineAmount = 20000;
    return result;
  };
  await flow.estimate();
  await flow.create();
  assert.equal(flow.getSnapshot().order.totalAmount, 20000);
  assert.deepEqual(request, { items });
  assert.equal('paymentMethod' in request, false);
  flow.dispose();
});
for (const method of ['create', 'pay', 'get'])
  test(`late ${method} response is fenced after account switch`, async () => {
    const { flow, adapter, sessionSource } = setup(
      {},
      {
        adapter: createMockCheckoutAdapter({
          resolveMenu: getMenu,
          delay: 0,
          scenario: 'unknown-paid',
        }),
      },
    );
    await flow.estimate();
    if (method !== 'create') await flow.create();
    if (method === 'get') await flow.pay();
    const result =
      method === 'create'
        ? await adapter.create({ items })
        : {
            ...flow.getSnapshot().order,
            status: 'PAID',
            orderNo: 'MOCK-LATE',
            holdExpiresAt: undefined,
          };
    const wait = deferred();
    adapter[method] = () => wait.promise;
    const pending = flow[method === 'get' ? 'check' : method]();
    await Promise.resolve();
    sessionSource.publish({
      authenticated: true,
      user: { id: 2, role: 'CUSTOMER' },
    });
    wait.resolve(result);
    await pending;
    assert.equal(flow.getSnapshot().stage, 'session-ended');
    assert.equal(flow.getSnapshot().order, null);
    flow.dispose();
  });
test('malformed pay response and wrong status lookup ID never display success', async () => {
  const { flow, adapter } = setup();
  await flow.estimate();
  await flow.create();
  adapter.pay = async () => ({
    orderId: 1,
    status: 'PAID',
    orderNo: 'forged',
    totalAmount: -1,
    items: [],
  });
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'unknown');
  adapter.get = async () => ({ orderId: 999, status: 'PAID' });
  await flow.check();
  assert.equal(flow.getSnapshot().stage, 'unknown');
  flow.dispose();
});
test('estimate disposal and abort-ignoring late result cannot resurrect a closed flow', async () => {
  const wait = deferred();
  const { flow } = setup({ estimate: () => wait.promise });
  const pending = flow.estimate();
  await Promise.resolve();
  flow.dispose();
  const before = flow.getSnapshot();
  wait.resolve({ expectedWaitSec: 0, cookSec: 1, expectedReadySec: 1 });
  await pending;
  assert.equal(flow.getSnapshot(), before);
});

test('explicit recovery of CREATED uses the same expired order once and completes once', async () => {
  const adapter = createMockCheckoutAdapter({
    resolveMenu: getMenu,
    delay: 0,
    scenario: 'recoverable',
  });
  const ids = [];
  const originalPay = adapter.pay;
  adapter.pay = (...args) => {
    ids.push(args[0]);
    return originalPay(...args);
  };
  let completed = 0;
  const { flow } = setup({}, { adapter, onPaid: () => completed++ });
  await flow.estimate();
  await flow.create();
  const id = flow.getSnapshot().order.orderId;
  await flow.recover();
  assert.deepEqual(ids, []);
  await flow.pay();
  await flow.recover();
  assert.deepEqual(ids, [id]);
  await flow.check();
  assert.equal(flow.getSnapshot().recoverable, true);
  assert.ok(Date.parse(flow.getSnapshot().order.holdExpiresAt) < Date.now());
  const pending = flow.recover();
  await flow.recover();
  await flow.check();
  await flow.create();
  await pending;
  await flow.recover();
  await flow.check();
  assert.deepEqual(ids, [id, id]);
  assert.equal(flow.getSnapshot().stage, 'paid');
  assert.equal(completed, 1);
  flow.dispose();
});

test('409 payment in progress remains unknown; each recovery requires a fresh CREATED lookup', async () => {
  const { flow, adapter } = setup();
  let calls = 0;
  adapter.pay = async () => {
    calls++;
    const error = new CheckoutError('ORDER_PAY_IN_PROGRESS', 'in progress');
    error.status = 409;
    throw error;
  };
  await flow.estimate();
  await flow.create();
  await flow.pay();
  assert.equal(flow.getSnapshot().stage, 'unknown');
  assert.match(flow.getSnapshot().error, /진행 중/);
  await flow.recover();
  assert.equal(calls, 1);
  await flow.check();
  await flow.recover();
  await flow.recover();
  await flow.pay();
  await flow.create();
  flow.restart();
  assert.equal(calls, 2);
  assert.equal(flow.getSnapshot().stage, 'unknown');
  assert.equal(flow.getSnapshot().recoverable, false);
  await flow.check();
  await flow.recover();
  assert.equal(calls, 3);
  flow.dispose();
});

for (const action of ['switch', 'logout', 'dispose'])
  test(`late recovery after ${action} cannot complete or mutate the cart`, async () => {
    const adapter = createMockCheckoutAdapter({
      resolveMenu: getMenu,
      delay: 0,
      scenario: 'recoverable',
    });
    let completed = 0;
    const { flow, sessionSource } = setup(
      {},
      { adapter, onPaid: () => completed++ },
    );
    await flow.estimate();
    await flow.create();
    await flow.pay();
    await flow.check();
    const originalPay = adapter.pay;
    const wait = deferred();
    adapter.pay = () => wait.promise;
    const pending = flow.recover();
    await Promise.resolve();
    if (action === 'dispose') flow.dispose();
    else
      sessionSource.publish(
        action === 'logout'
          ? null
          : { authenticated: true, user: { id: 2, role: 'CUSTOMER' } },
      );
    const before = flow.getSnapshot();
    wait.resolve(await originalPay(before.order?.orderId ?? 1));
    await pending;
    assert.equal(completed, 0);
    assert.equal(flow.getSnapshot(), before);
    flow.dispose();
  });

test('failed or malformed lookup revokes recovery permission without posting', async () => {
  const { flow, adapter } = setup(
    {},
    {
      adapter: createMockCheckoutAdapter({
        resolveMenu: getMenu,
        delay: 0,
        scenario: 'unknown',
      }),
    },
  );
  await flow.estimate();
  await flow.create();
  await flow.pay();
  await flow.check();
  assert.equal(flow.getSnapshot().recoverable, true);
  adapter.get = async () => {
    throw new Error('network');
  };
  adapter.pay = async () => assert.fail('no payment without validated CREATED');
  await flow.check();
  await flow.recover();
  assert.equal(flow.getSnapshot().recoverable, false);
  adapter.get = async () => ({ orderId: 999, status: 'CREATED' });
  await flow.check();
  await flow.recover();
  assert.equal(flow.getSnapshot().recoverable, false);
  flow.dispose();
});
