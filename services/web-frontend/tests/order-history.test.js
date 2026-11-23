import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createOrderApi,
  validateDetail,
  validateList,
  canCancel,
  orderStatus,
  OrderError,
} from '../src/orders/orderApi.js';
import { createOrderHistoryStore } from '../src/orders/orderHistoryStore.js';
import { parseOrdersRoute } from '../src/orders/ordersRoute.js';

const detail = (orderId = 1) => ({
  orderId,
  orderNo: `TEST-${orderId}`,
  status: 'PAID',
  totalAmount: 18000,
  orderedAt: '2026-11-23T01:00:00+09:00',
  paidAt: '2026-11-23T01:01:00+09:00',
  items: [
    {
      menuId: 1,
      menuName: '버거',
      unitPrice: 6500,
      quantity: 2,
      lineAmount: 18000,
      options: [{ optionId: 2, optionName: '세트', extraPrice: 2500 }],
    },
  ],
  cooking: {
    lookup: 'OK',
    status: 'WAITING',
    expectedWaitSec: 120,
    expectedReadySec: 300,
  },
});
const list = (page = 0) => ({
  page,
  size: 20,
  totalElements: 1,
  items: [
    {
      orderId: 1,
      orderNo: 'TEST-1',
      status: 'PAID',
      totalAmount: 18000,
      orderedAt: '2026-11-23T01:00:00Z',
      itemCount: 1,
      representativeMenuName: '버거',
    },
  ],
});
function session() {
  let value = { authenticated: true, user: { id: 1, role: 'CUSTOMER' } };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    publish(next) {
      value = next;
      listeners.forEach((fn) => fn());
    },
  };
}
const response = (data, status = 200, code) =>
  new Response(
    JSON.stringify({
      success: status === 200,
      data,
      ...(code ? { errorCode: code } : {}),
    }),
    { status },
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));

test('OR-03/04/05 exact paths, safe GET retry and bodyless POST without identity or payment keys', async () => {
  const source = session(),
    requests = [];
  source.request = async (path, options) => {
    requests.push({ path, ...options });
    return response(
      path.includes('/cancel')
        ? { ...detail(), status: 'CANCELED', cooking: undefined }
        : path.includes('?')
          ? list()
          : detail(),
    );
  };
  const api = createOrderApi({ sessionSource: source });
  await api.list();
  await api.detail(1);
  await api.cancel(1);
  assert.deepEqual(
    requests.map((r) => [r.path, r.method, r.retryOn401]),
    [
      ['/api/v1/orders?page=0&size=20', 'GET', true],
      ['/api/v1/orders/1', 'GET', true],
      ['/api/v1/orders/1/cancel', 'POST', false],
    ],
  );
  assert.ok(
    requests.every(
      (r) =>
        !r.body &&
        !new Headers(r.headers).has('X-User-Id') &&
        !new Headers(r.headers).has('Idempotency-Key'),
    ),
  );
});
for (const value of [
  null,
  { authenticated: true, user: { id: 2, role: 'STORE_ADMIN' } },
])
  test(`order API blocks ${value ? 'admin' : 'anonymous'} before HTTP`, async () => {
    const source = session();
    source.publish(value);
    source.request = () => assert.fail('No HTTP');
    const api = createOrderApi({ sessionSource: source });
    await assert.rejects(api.list(), (e) => e.status === 401);
    await assert.rejects(api.cancel(1));
  });
for (const status of [401, 403])
  test(`HTTP ${status} is distinct even for non-JSON responses`, async () => {
    const source = session();
    source.request = async () => new Response('proxy error', { status });
    await assert.rejects(
      createOrderApi({ sessionSource: source }).list(),
      (e) =>
        e.status === status &&
        e.code === (status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN'),
    );
  });
test('detail price formula, missing cooking data and terminal status priority follow Order DTO', () => {
  assert.equal(validateDetail(detail(), 1).items[0].unitPrice, 6500);
  assert.throws(() => validateDetail({ ...detail(), orderId: 2 }, 1));
  const bad = detail();
  bad.items[0].unitPrice = 9000;
  assert.throws(() => validateDetail(bad, 1));
  assert.equal(
    validateDetail({ ...detail(), cooking: undefined }, 1).cooking.lookup,
    'UNAVAILABLE',
  );
  assert.equal(orderStatus({ ...detail(), status: 'COMPLETED' }), '완료');
  assert.equal(
    orderStatus({ ...detail(), cooking: { lookup: 'OK', status: 'DONE' } }),
    '픽업 대기',
  );
  assert.equal(
    orderStatus({ ...detail(), cooking: { lookup: 'OK', status: 'CANCELED' } }),
    '취소 처리 중',
  );
});
test('list and route reject malformed pagination, hidden statuses and unsafe identifiers', async () => {
  assert.equal(validateList(list(), 0, 20).totalElements, 1);
  assert.doesNotThrow(() =>
    validateList(
      {
        ...list(),
        items: [{ ...list().items[0], status: 'CANCELED', orderNo: undefined }],
      },
      0,
      20,
    ),
  );
  assert.throws(
    () => validateList({ ...list(), items: [null] }, 0, 20),
    OrderError,
  );
  assert.throws(() => validateList({ ...list(), page: 2 }, 0, 20));
  assert.throws(() =>
    validateList(
      { ...list(), items: [{ ...list().items[0], status: 'CREATED' }] },
      0,
      20,
    ),
  );
  assert.deepEqual(parseOrdersRoute('#orders/2?page=3'), { page: 3, id: 2 });
  assert.equal(parseOrdersRoute('#orders?page=2147483647').page, 2147483647);
  assert.equal(parseOrdersRoute('#orders?page=2147483648').invalid, true);
  for (const hash of [
    '#orders/0',
    '#orders/../../3',
    '#orders?page=-1',
    '#orders/9007199254740992',
  ])
    assert.equal(parseOrdersRoute(hash).invalid, true);
  const source = session();
  source.request = () => assert.fail('Invalid input must not request');
  const api = createOrderApi({ sessionSource: source });
  await assert.rejects(api.detail(-1));
  await assert.rejects(api.list(-1));
});
test('cancellation only offered for CREATED or verified pre-cooking orders', () => {
  assert.equal(canCancel(detail()), true);
  for (const status of ['COMPLETED', 'FAILED', 'CANCELED', 'COOKING'])
    assert.equal(canCancel({ ...detail(), status }), false);
  for (const lookup of ['PENDING', 'UNAVAILABLE'])
    assert.equal(canCancel({ ...detail(), cooking: { lookup } }), false);
  assert.equal(
    canCancel({ ...detail(), cooking: { lookup: 'OK', status: 'COOKING' } }),
    false,
  );
});
test('cancel success must be CANCELED and uncertain errors never invent success', async () => {
  const source = session();
  source.request = async () => response(detail());
  const api = createOrderApi({ sessionSource: source });
  await assert.rejects(api.cancel(1));
  source.request = async () =>
    response(null, 503, 'COOKING_SERVICE_UNAVAILABLE');
  await assert.rejects(
    api.cancel(1),
    (e) => e.code === 'COOKING_SERVICE_UNAVAILABLE' && e.status === 503,
  );
});
test('account switch fences an abort-ignoring API response', async () => {
  const source = session(),
    wait = deferred();
  source.request = () => wait.promise;
  const pending = createOrderApi({ sessionSource: source }).detail(1);
  source.publish({ authenticated: true, user: { id: 3, role: 'CUSTOMER' } });
  wait.resolve(response(detail()));
  await assert.rejects(pending, (e) => e.code === 'CANCELLED');
});
function storeSetup(overrides = {}) {
  const source = session();
  const api = {
    list: async (p) => list(p),
    detail: async (id) => detail(id),
    cancel: async (id) => ({
      ...detail(id),
      status: 'CANCELED',
      cooking: undefined,
    }),
    ...overrides,
  };
  const store = createOrderHistoryStore({ api, sessionSource: source });
  store.start();
  return { store, source, api };
}
test('late previous-page and previous-detail responses cannot replace current route', async () => {
  const oldList = deferred(),
    oldDetail = deferred();
  const { store } = storeSetup({
    list: (p) => (p === 0 ? oldList.promise : Promise.resolve(list(p))),
    detail: (id) =>
      id === 1 ? oldDetail.promise : Promise.resolve(detail(id)),
  });
  store.navigate(0, 1);
  store.navigate(1, 2);
  await tick();
  oldList.resolve(list(0));
  oldDetail.resolve(detail(1));
  await tick();
  assert.equal(store.getSnapshot().list.data.page, 1);
  assert.equal(store.getSnapshot().detail.data.orderId, 2);
  store.dispose();
});
test('cancel duplicate clicks post once and refresh server list and detail', async () => {
  const wait = deferred();
  let calls = 0,
    gets = 0,
    lists = 0,
    canceled = false;
  const { store } = storeSetup({
    list: async (p) => {
      lists++;
      return list(p);
    },
    detail: async (id) => {
      gets++;
      return { ...detail(id), status: canceled ? 'CANCELED' : 'PAID' };
    },
    cancel: () => {
      calls++;
      return wait.promise;
    },
  });
  store.navigate(0, 1);
  await tick();
  const pending = store.cancel();
  await store.cancel();
  assert.equal(calls, 1);
  canceled = true;
  wait.resolve({ ...detail(), status: 'CANCELED' });
  await pending;
  assert.equal(store.getSnapshot().detail.data.status, 'CANCELED');
  assert.equal(gets, 2);
  assert.equal(lists, 2);
  store.dispose();
});
test('uncertain cancel locks POST until explicit successful review, without changing server state', async () => {
  let posts = 0;
  const { store } = storeSetup({
    cancel: async () => {
      posts++;
      throw new OrderError('결과 불명', 'COOKING_SERVICE_UNAVAILABLE', 503);
    },
  });
  store.navigate(0, 1);
  await tick();
  await store.cancel();
  await store.cancel();
  assert.equal(posts, 1);
  assert.equal(store.getSnapshot().detail.data.status, 'PAID');
  assert.equal(store.getSnapshot().review, true);
  await store.detail({ review: true });
  await store.cancel();
  assert.equal(posts, 2);
  store.dispose();
});
for (const action of ['logout', 'switch', 'close'])
  test(`late cancellation after ${action} cannot restore old order data`, async () => {
    const wait = deferred();
    const { store, source } = storeSetup({ cancel: () => wait.promise });
    store.navigate(0, 1);
    await tick();
    const pending = store.cancel();
    if (action === 'close') store.dispose();
    else
      source.publish(
        action === 'logout'
          ? null
          : { authenticated: true, user: { id: 3, role: 'CUSTOMER' } },
      );
    const snapshot = store.getSnapshot();
    wait.resolve({ ...detail(), status: 'CANCELED' });
    await pending;
    assert.equal(store.getSnapshot(), snapshot);
    if (action !== 'close') assert.equal(snapshot.detail.data, undefined);
    store.dispose();
  });
