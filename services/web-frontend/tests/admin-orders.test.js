import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'vite';
import {
  createAdminOrderApi,
  adminSearchParams,
  defaultSearch,
  validateAdminDetail,
  AdminOrderError,
} from '../src/admin-orders/adminOrderApi.js';
import {
  parseAdminRoute,
  adminHref,
} from '../src/admin-orders/adminOrderRoute.js';
import { createAdminOrderStore } from '../src/admin-orders/adminOrderStore.js';
import {
  startAdminOrdersFixture,
  makeAdminOrders,
} from './admin-orders-fixture.mjs';
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const records = makeAdminOrders(new Date('2026-11-24T03:00:00Z'));
const summary = (id = 47) => {
  const order = records.get(id);
  return {
    ...order,
    itemCount: order.items.length,
    representativeMenuName: order.items[0].menuName,
  };
};
const listData = (items = [summary()]) => ({
  page: 0,
  size: 20,
  totalElements: items.length,
  items,
});
const envelope = (data) =>
  Response.json({ success: true, data, message: 'Fixture only' });
test('KST date default, inclusive 31 day boundary and exact number search omit date keys entirely', () => {
  assert.deepEqual(defaultSearch(new Date('2026-11-23T16:00:00Z')), {
    from: '2026-10-25',
    to: '2026-11-24',
    orderNo: '',
    status: '',
    manualReviewRequired: false,
    page: 0,
    size: 20,
  });
  assert.equal(
    adminSearchParams({ from: '2026-02-01', to: '2026-03-03' }).get('to'),
    '2026-03-03',
  );
  assert.throws(
    () => adminSearchParams({ from: '2026-02-01', to: '2026-03-04' }),
    /31일/,
  );
  const params = adminSearchParams({
    orderNo: ' PO-20200101-0001 ',
    status: 'FAILED',
    manualReviewRequired: false,
  });
  assert.equal(params.get('orderNo'), 'PO-20200101-0001');
  assert.equal(params.has('from'), false);
  assert.equal(params.has('to'), false);
  assert.equal(params.has('manualReviewRequired'), false);
  assert.equal(
    adminSearchParams({ manualReviewRequired: true }).get(
      'manualReviewRequired',
    ),
    'true',
  );
  assert.equal(adminSearchParams({ from: '2026-11-01' }).has('to'), false);
});
for (const query of [
  { from: '2026-02-29' },
  { to: '2026-13-01' },
  { from: '2026-12-01', to: '2026-11-01' },
  { page: -1 },
  { page: 1.5 },
  { page: 2147483648 },
  { size: 0 },
  { size: 101 },
  { status: 'DONE' },
  { status: 'toString' },
  { manualReviewRequired: 'true' },
])
  test(`invalid query rejected before transport: ${JSON.stringify(query)}`, async () => {
    const api = createAdminOrderApi({
      request: () => assert.fail('unexpected request'),
    });
    await assert.rejects(api.list(query), (e) => e.kind === 'input');
  });
test('route roundtrip preserves filters, page and selected detail; malformed URLs are rejected', () => {
  const query = {
    ...defaultSearch(new Date('2026-11-24T03:00:00Z')),
    page: 2,
    status: 'CANCELED',
    manualReviewRequired: true,
  };
  assert.deepEqual(parseAdminRoute(adminHref(query, 45)), {
    query,
    selectedId: 45,
  });
  for (const hash of [
    '#other',
    '#admin-orders?page=-1',
    '#admin-orders?orderId=0',
    '#admin-orders?orderId=9007199254740992',
    '#admin-orders?page=1&page=2',
    '#admin-orders?manualReviewRequired=bad',
    '#admin-orders?from=bad',
  ])
    assert.ok(parseAdminRoute(hash).error);
});
test('OR-08 and OR-09 exact GET paths, safe transport, no fabricated identity and distinct DTO fields', async () => {
  const calls = [];
  const api = createAdminOrderApi({
    request: async (path, options) => {
      calls.push({ path, options });
      return envelope(
        path.includes('?') ? listData([summary(46)]) : records.get(46),
      );
    },
  });
  const list = await api.list({});
  const detail = await api.detail(46);
  assert.equal(list.items[0].failReason, undefined);
  assert.equal(list.items[0].items, undefined);
  assert.equal(detail.itemCount, undefined);
  assert.equal(detail.failReason, 'STOCK_CONFIRM_FAILED_REFUND_NEEDED');
  assert.equal(detail.manualReviewRequired, false);
  assert.equal(calls[0].path, '/api/v1/admin/orders?page=0&size=20');
  assert.equal(calls[1].path, '/api/v1/admin/orders/46');
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined);
  }
});
for (const [status, code, text] of [
  [400, 'INVALID_REQUEST', '검색 조건'],
  [401, 'UNAUTHORIZED', '인증'],
  [403, 'FORBIDDEN', '권한'],
  [404, 'ORDER_NOT_FOUND', '주문을 찾을 수'],
  [404, 'NOT_FOUND', '비활성화'],
  [500, 'INTERNAL_ERROR', '조회하지 못'],
])
  test(`HTTP ${status}/${code} has a safe distinct message and no automatic replay`, async () => {
    let calls = 0;
    const api = createAdminOrderApi({
      request: async () => {
        calls++;
        return Response.json(
          { success: false, errorCode: code, message: 'private SQL error' },
          { status },
        );
      },
    });
    await assert.rejects(
      api.detail(47),
      (e) =>
        e.status === status &&
        e.message.includes(text) &&
        !e.message.includes('SQL'),
    );
    assert.equal(calls, 1);
  });
test('non-JSON 401/403/disabled 404 preserve HTTP status; network and protocol failures stay distinct', async () => {
  for (const status of [401, 403, 404]) {
    const api = createAdminOrderApi({
      request: async () => new Response('proxy response', { status }),
    });
    await assert.rejects(api.list({}), (e) => e.status === status);
  }
  await assert.rejects(
    createAdminOrderApi({
      request: async () => {
        throw new Error('offline');
      },
    }).list({}),
    (e) => e.kind === 'network',
  );
  await assert.rejects(
    createAdminOrderApi({ request: async () => new Response('<html>') }).list(
      {},
    ),
    (e) => e.kind === 'protocol',
  );
});
for (const [name, change] of [
  ['missing userId', (d) => delete d.items[0].userId],
  [
    'invalid status',
    (d) => {
      d.items[0].status = 'DONE';
    },
  ],
  [
    'duplicate ID',
    (d) => {
      d.items.push(d.items[0]);
      d.totalElements = 2;
    },
  ],
  [
    'invalid manual flag',
    (d) => {
      d.items[0].manualReviewRequired = 'true';
    },
  ],
  [
    'wrong page',
    (d) => {
      d.page = 1;
    },
  ],
  [
    'unsafe total',
    (d) => {
      d.totalElements = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'bad time',
    (d) => {
      d.items[0].orderedAt = 'yesterday';
    },
  ],
  [
    'negative money',
    (d) => {
      d.items[0].totalAmount = -1;
    },
  ],
])
  test(`malformed list rejected: ${name}`, async () => {
    const data = listData();
    change(data);
    await assert.rejects(
      createAdminOrderApi({ request: async () => envelope(data) }).list({}),
      (e) => e.kind === 'protocol',
    );
  });
test('detail safely accepts missing optional fields, and rejects wrong ID/amount/option/time', () => {
  const created = validateAdminDetail(records.get(47), 47);
  assert.equal(created.orderNo, undefined);
  assert.equal(created.paidAt, undefined);
  assert.equal(created.paymentId, undefined);
  for (const change of [
    (d) => {
      d.orderId = 99;
    },
    (d) => {
      d.totalAmount = 1;
    },
    (d) => {
      d.items[0].lineAmount++;
    },
    (d) => {
      d.items[0].options[0].extraPrice = '2';
    },
    (d) => {
      d.refundedAt = 'bad';
    },
  ]) {
    const data = structuredClone(records.get(45));
    change(data);
    assert.throws(
      () => validateAdminDetail(data, 45),
      (e) => e.kind === 'protocol',
    );
  }
  assert.equal(
    validateAdminDetail(records.get(45), 45).manualReviewRequired,
    true,
  );
  assert.equal(
    validateAdminDetail(records.get(46), 46).manualReviewRequired,
    false,
  );
});
test('store fences stale list/detail results even when the adapter ignores AbortSignal', async () => {
  const a = deferred(),
    b = deferred(),
    details = new Map([
      [45, deferred()],
      [46, deferred()],
    ]);
  const store = createAdminOrderStore({
    list: (query) => (query.page === 0 ? a.promise : b.promise),
    detail: (id) => details.get(id).promise,
  });
  store.setRoute({ page: 0 }, 45);
  await tick();
  store.setRoute({ page: 1 }, 46);
  await tick();
  b.resolve({ marker: 'current' });
  details.get(46).resolve({ orderId: 46 });
  await tick();
  a.resolve({ marker: 'old' });
  details.get(45).resolve({ orderId: 45 });
  await tick();
  assert.equal(store.getSnapshot().list.data.marker, 'current');
  assert.equal(store.getSnapshot().detail.data.orderId, 46);
  const old = deferred();
  const next = createAdminOrderStore({
    list: async () => ({}),
    detail: () => old.promise,
  });
  next.setRoute({}, 45);
  await tick();
  next.setRoute({}, null);
  old.resolve({ orderId: 45 });
  await tick();
  assert.equal(next.getSnapshot().detail.phase, 'idle');
  store.dispose();
  next.dispose();
});
test('401/403 clear both list and detail, including a late sibling request', async () => {
  for (const status of [401, 403]) {
    const pending = deferred();
    const store = createAdminOrderStore({
      list: () => pending.promise,
      detail: async () => {
        throw new AdminOrderError('permission', { status });
      },
    });
    store.setRoute({}, 45);
    await tick();
    pending.resolve(listData());
    await tick();
    assert.equal(store.getSnapshot().list.phase, 'error');
    assert.equal(store.getSnapshot().list.data, undefined);
    assert.equal(store.getSnapshot().detail.error.status, status);
    store.dispose();
  }
});
test('StrictMode-style dispose/reactivate cannot apply an old mount response and retries only explicitly', async () => {
  const pending = deferred();
  let calls = 0;
  const store = createAdminOrderStore({
    list: () => {
      calls++;
      return calls === 1 ? pending.promise : Promise.resolve(listData());
    },
  });
  store.setRoute({});
  await tick();
  store.dispose();
  store.activate();
  store.setRoute({});
  await tick();
  pending.resolve({ old: true });
  await tick();
  assert.equal(store.getSnapshot().list.data.old, undefined);
  store.setRoute({});
  await tick();
  assert.equal(calls, 2);
  store.retryList();
  await tick();
  assert.equal(calls, 3);
  store.dispose();
});
test('HTTP fixture implements exact number/period/status/manual/page and separate detail DTOs', async () => {
  const fixture = await startAdminOrdersFixture();
  const api = createAdminOrderApi({
    request: (path, options) => fetch(fixture.url + path, options),
  });
  try {
    const first = await api.list({});
    assert.equal(first.items[0].orderId, 47);
    assert.equal(first.items.length, 20);
    const second = await api.list({ page: 1 });
    assert.equal(second.items[0].orderId, 27);
    const old = await api.list({ orderNo: 'PO-20200101-0001' });
    assert.equal(old.items[0].orderId, 1);
    assert.equal(
      (await api.list({ status: 'COOKING' })).items.every(
        (o) => o.status === 'COOKING',
      ),
      true,
    );
    assert.equal(
      (await api.list({ manualReviewRequired: true })).items.every(
        (o) => o.manualReviewRequired,
      ),
      true,
    );
    assert.equal(
      (await api.detail(46)).failReason,
      'STOCK_CONFIRM_FAILED_REFUND_NEEDED',
    );
    await assert.rejects(api.detail(999), (e) => e.code === 'ORDER_NOT_FOUND');
    assert.equal(
      fixture.calls.every(
        (c) => !c.hasUserId && !c.hasUserRole && !c.hasBearer,
      ),
      true,
    );
  } finally {
    await fixture.close();
  }
});
test('customer production bundle excludes independent admin UI and fixture data', async () => {
  const bundle = await build({ logLevel: 'silent', build: { write: false } });
  const output = bundle.output
    .map((file) => file.code ?? file.source)
    .join('\n');
  for (const marker of [
    'HTTP FIXTURE PREVIEW',
    '/api/v1/admin/orders',
    'PO-20200101-0001',
    'STORE MANAGEMENT',
  ])
    assert.equal(output.includes(marker), false);
});
