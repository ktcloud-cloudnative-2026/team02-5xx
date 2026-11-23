import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createCheckoutHttpAdapter } from '../src/checkout/checkoutHttpAdapter.js';
import { createAuthSession } from '../src/authSession.js';
import { createAuthApi } from '../src/authApi.js';
import { createCheckoutFlow } from '../src/checkout/checkoutFlow.js';

const items = [{ menuId: 1, optionIds: [2], quantity: 2 }];
const order = {
  orderId: 11,
  status: 'CREATED',
  totalAmount: 18000,
  holdExpiresAt: new Date(Date.now() + 300000).toISOString(),
  items: [
    {
      menuId: 1,
      menuName: '계약 메뉴',
      quantity: 2,
      unitPrice: 6500,
      lineAmount: 18000,
      options: [{ optionId: 2, optionName: '세트', extraPrice: 2500 }],
    },
  ],
};
async function fixture(run) {
  const requests = [];
  let handler;
  const user = {
    id: 1,
    email: 'customer@example.test',
    role: 'CUSTOMER',
    nickname: null,
  };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({
      method: req.method,
      path: req.url,
      headers: req.headers,
      raw,
    });
    const send = (status, data, errorCode) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: status < 300,
          data,
          message: 'contract fixture',
          ...(errorCode ? { errorCode } : {}),
        }),
      );
    };
    if (req.url.startsWith('/api/v1/auth/')) {
      if (req.url.endsWith('/me')) send(200, user);
      else
        send(200, {
          accessToken: 'contract-only-token',
          tokenType: 'Bearer',
          expiresIn: 900,
          user,
        });
    } else if (handler) await handler(req, res, send);
    else if (req.url === '/api/v1/cooking/estimates')
      send(200, { expectedWaitSec: 420, cookSec: 480, expectedReadySec: 900 });
    else if (req.method === 'POST' && req.url === '/api/v1/orders')
      send(201, order);
    else
      send(200, {
        ...order,
        status: 'PAID',
        orderNo: 'CONTRACT-ONLY-001',
        holdExpiresAt: undefined,
      });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const fetchImpl = (path, options) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  const session = createAuthSession({ api: createAuthApi({ fetchImpl }) });
  await session.login({
    email: user.email,
    password: 'fixture-only',
    rememberMe: false,
  });
  const adapter = createCheckoutHttpAdapter({
    sessionSource: session,
    fetchImpl,
  });
  try {
    await run({
      adapter,
      session,
      requests,
      setHandler: (next) => {
        handler = next;
      },
    });
  } finally {
    await new Promise((done) => server.close(done));
  }
}
test('real HTTP transport uses exact CO-02/OR-01/02/04 paths, DTOs, Bearer and no fake identity/payment fields', () =>
  fixture(async ({ adapter, requests }) => {
    await adapter.estimate({ items });
    await adapter.create({
      items: [{ ...items[0], unitPrice: 1, paymentMethod: 'card' }],
    });
    await adapter.pay(11);
    await adapter.get(11);
    const calls = requests.filter((r) => !r.path.includes('/auth/'));
    assert.deepEqual(
      calls.map((r) => [r.method, r.path]),
      [
        ['POST', '/api/v1/cooking/estimates'],
        ['POST', '/api/v1/orders'],
        ['POST', '/api/v1/orders/11/pay'],
        ['GET', '/api/v1/orders/11'],
      ],
    );
    assert.deepEqual(JSON.parse(calls[0].raw), { items });
    assert.deepEqual(JSON.parse(calls[1].raw), { items });
    assert.equal(calls[2].raw, '');
    for (const request of calls) {
      assert.equal(request.headers['x-user-id'], undefined);
      assert.equal(request.headers['idempotency-key'], undefined);
      assert.ok(!request.path.includes('/internal/'));
    }
    for (const request of calls.slice(1))
      assert.equal(request.headers.authorization, 'Bearer contract-only-token');
  }));
for (const [status, code] of [
  [409, 'OUT_OF_STOCK'],
  [409, 'STORE_NOT_ACCEPTING_ORDERS'],
  [409, 'MENU_NOT_AVAILABLE'],
  [400, 'INVALID_REQUEST'],
])
  test(`create maps explicit ${code} without retry`, () =>
    fixture(async ({ adapter, requests, setHandler }) => {
      setHandler((req, res, send) => send(status, null, code));
      await assert.rejects(
        adapter.create({ items }),
        (e) => e.code === code && e.definitive === true,
      );
      assert.equal(
        requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
    }));
for (const [status, code, definitive] of [
  [402, 'PAYMENT_FAILED', true],
  [409, 'HOLD_EXPIRED', true],
  [409, 'STOCK_CONFIRM_FAILED', true],
  [409, 'ORDER_PAY_IN_PROGRESS', false],
  [503, 'PAYMENT_SERVICE_UNAVAILABLE', false],
  [502, 'UPSTREAM_INVALID_RESPONSE', false],
  [403, 'FORBIDDEN', false],
])
  test(`pay classifies ${code} and never retries writes`, () =>
    fixture(async ({ adapter, requests, setHandler }) => {
      await adapter.create({ items });
      setHandler((req, res, send) => send(status, null, code));
      await assert.rejects(
        adapter.pay(11),
        (e) => e.code === code && e.definitive === definitive,
      );
      assert.equal(requests.filter((r) => r.path.endsWith('/pay')).length, 1);
      assert.equal(
        requests.filter((r) => r.path.endsWith('/refresh')).length,
        0,
      );
    }));
test('write 401 invalidates session without rotating or repeating payment', () =>
  fixture(async ({ adapter, session, requests, setHandler }) => {
    await adapter.create({ items });
    setHandler((req, res, send) => send(401, null, 'UNAUTHORIZED'));
    await assert.rejects(adapter.pay(11));
    assert.equal(session.getSnapshot().authenticated, false);
    assert.equal(requests.filter((r) => r.path.endsWith('/refresh')).length, 0);
  }));
test('safe GET 401 rotates once, malformed responses and wrong order identity are rejected', () =>
  fixture(async ({ adapter, requests, setHandler }) => {
    await adapter.create({ items });
    let count = 0;
    setHandler((req, res, send) =>
      ++count === 1
        ? send(401, null, 'UNAUTHORIZED')
        : send(200, {
            ...order,
            status: 'PAID',
            orderNo: 'CONTRACT-ONLY-001',
            holdExpiresAt: undefined,
          }),
    );
    await adapter.get(11);
    assert.equal(requests.filter((r) => r.path.endsWith('/refresh')).length, 1);
    setHandler((req, res, send) => send(200, { ...order, orderId: 99 }));
    await assert.rejects(adapter.get(11));
    setHandler((req, res, send) =>
      send(200, { expectedWaitSec: -1, cookSec: 10, expectedReadySec: 9 }),
    );
    await assert.rejects(adapter.estimate({ items }));
    setHandler((req, res) => {
      res.writeHead(201);
      res.end('{');
    });
    await assert.rejects(adapter.create({ items }), (e) => !e.definitive);
  }));
test('item limit and invalid IDs fail locally before any Order HTTP request', () =>
  fixture(async ({ adapter, requests }) => {
    for (const bad of [
      [],
      Array(21).fill(items[0]),
      [{ ...items[0], quantity: 100 }],
      [{ ...items[0], optionIds: [2, 2] }],
    ])
      await assert.rejects(adapter.create({ items: bad }));
    await assert.rejects(adapter.pay('../1'));
    assert.equal(
      requests.filter((r) => r.path.startsWith('/api/v1/orders')).length,
      0,
    );
  }));
test('malformed success and mismatched error/status never imply a definitive payment failure', () =>
  fixture(async ({ adapter, setHandler }) => {
    await adapter.create({ items });
    for (const invalid of [
      { ...order, totalAmount: -1 },
      { ...order, items: [] },
      { ...order, status: 'PAID', orderNo: null },
      { ...order, orderId: 99 },
    ]) {
      setHandler((req, res, send) => send(200, invalid));
      await assert.rejects(adapter.pay(11), (error) => !error.definitive);
    }
    setHandler((req, res, send) => send(503, null, 'PAYMENT_FAILED'));
    await assert.rejects(adapter.pay(11), (error) => !error.definitive);
    setHandler((req, res, send) => send(200, order));
    await assert.rejects(
      adapter.create({ items }),
      (error) => !error.definitive,
    );
  }));
test('transport failure and cancellation never retry a write or classify it as unpaid', () =>
  fixture(async ({ adapter, setHandler, requests }) => {
    setHandler((req, res) => res.destroy());
    await assert.rejects(
      adapter.create({ items }),
      (error) => !error.definitive,
    );
    assert.equal(requests.filter((r) => r.path === '/api/v1/orders').length, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      adapter.create({ items }, { signal: controller.signal }),
      (error) => !error.definitive,
    );
  }));

test('Order DTO uses base unitPrice plus every option before multiplying quantity', () =>
  fixture(async ({ adapter, setHandler }) => {
    for (const options of [
      [],
      order.items[0].options,
      [
        ...order.items[0].options,
        { optionId: 3, optionName: '추가', extraPrice: 500 },
      ],
    ]) {
      const total =
        (6500 + options.reduce((sum, o) => sum + o.extraPrice, 0)) * 2;
      const response = {
        ...order,
        totalAmount: total,
        items: [{ ...order.items[0], options, lineAmount: total }],
      };
      setHandler((req, res, send) => send(201, response));
      const result = await adapter.create({
        items: [{ ...items[0], optionIds: options.map((o) => o.optionId) }],
      });
      assert.equal(result.items[0].unitPrice, 6500);
      assert.equal(result.totalAmount, total);
    }
  }));

test('double-counted options, invalid extras and int overflow are rejected as uncertain responses', () =>
  fixture(async ({ adapter, setHandler }) => {
    for (const row of [
      { ...order.items[0], unitPrice: 9000 },
      {
        ...order.items[0],
        options: [{ ...order.items[0].options[0], extraPrice: -1 }],
      },
      {
        ...order.items[0],
        options: [{ ...order.items[0].options[0], extraPrice: 0.5 }],
      },
      { ...order.items[0], unitPrice: 2147483647 },
      { ...order.items[0], options: null },
    ]) {
      setHandler((req, res, send) => send(201, { ...order, items: [row] }));
      await assert.rejects(
        adapter.create({ items }),
        (error) =>
          error.code === 'UPSTREAM_INVALID_RESPONSE' && !error.definitive,
      );
    }
  }));

test('HTTP recovery posts once to the same id after CREATED GET, with empty body and server-owned payment key', () =>
  fixture(async ({ adapter, session, requests, setHandler }) => {
    let pays = 0,
      completions = 0;
    setHandler((req, res, send) => {
      if (req.url === '/api/v1/cooking/estimates')
        send(200, { expectedWaitSec: 0, cookSec: 1, expectedReadySec: 1 });
      else if (req.url === '/api/v1/orders') send(201, order);
      else if (req.method === 'GET')
        send(200, { ...order, holdExpiresAt: '2020-01-01T00:00:00Z' });
      else if (++pays === 1) send(503, null, 'PAYMENT_SERVICE_UNAVAILABLE');
      else
        send(200, {
          ...order,
          status: 'PAID',
          orderNo: 'RECOVERED-11',
          holdExpiresAt: undefined,
        });
    });
    const flow = createCheckoutFlow({
      input: { items },
      adapter,
      sessionSource: session,
      onPaid: () => completions++,
    });
    await flow.estimate();
    await flow.create();
    await flow.pay();
    await flow.recover();
    assert.equal(pays, 1);
    await flow.check();
    const recovery = flow.recover();
    await flow.recover();
    await recovery;
    await flow.check();
    assert.equal(flow.getSnapshot().stage, 'paid');
    assert.equal(completions, 1);
    assert.equal(requests.filter((r) => r.path === '/api/v1/orders').length, 1);
    const payRequests = requests.filter((r) => r.path.endsWith('/pay'));
    assert.equal(payRequests.length, 2);
    assert.ok(
      payRequests.every(
        (r) =>
          r.path === '/api/v1/orders/11/pay' &&
          r.raw === '' &&
          !r.headers['idempotency-key'] &&
          !r.headers['x-user-id'],
      ),
    );
    flow.dispose();
  }));
