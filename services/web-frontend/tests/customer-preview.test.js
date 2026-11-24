import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
import { createCongestionApi } from '../src/home/congestionApi.js';
import { createOrderApi } from '../src/orders/orderApi.js';
let fixture, customer, admin, other;
async function login(email) {
  const response = await fetch(fixture.url + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'fixture-only-password',
      rememberMe: false,
    }),
  });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  return {
    token: data.accessToken,
    api: createOrderApi({
      sessionSource: {
        getSnapshot: () => ({ authenticated: true, user: data.user }),
        request: (path, options) =>
          fetch(fixture.url + path, {
            ...options,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${data.accessToken}`,
            },
          }),
      },
    }),
  };
}
before(async () => {
  fixture = await startCustomerHttpFixture({ preview: true });
  customer = await login('customer@example.test');
  admin = await login('admin@example.test');
  other = await login('other@example.test');
});
after(async () => fixture?.close());
const raw = (path, session) =>
  fetch(fixture.url + path, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
test('manual preview serves the actual App plus fixture-only controls and real fallback asset', async () => {
  const html = await (await raw('/')).text();
  assert.ok(html.includes('/__fixture/scenarios'));
  assert.ok(html.includes('fixture-only-password'));
  assert.ok(!html.includes('test-sign-in'));
  assert.ok(!html.includes('/@vite/client'));
  const asset = await raw('/images/defaults/menu-placeholder.svg');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /<svg/);
});
test('public CO-01 normal/crowded/zero/error and explicit recovery use the same preview server', async () => {
  const api = createCongestionApi({
    fetchImpl: (path, options) => fetch(fixture.url + path, options),
  });
  for (const [name, wait] of [
    ['normal', 120],
    ['crowded', 901],
    ['zero', 0],
  ]) {
    fixture.homeControls.congestion = name;
    assert.equal((await api.get()).expectedWaitSec, wait);
  }
  fixture.homeControls.congestion = 'error';
  await assert.rejects(api.get(), { status: 503 });
  fixture.homeControls.congestion = 'normal';
  assert.equal((await api.get()).waitingCount, 3);
});
test('preview form control validates origin/values and never creates login identity', async () => {
  const post = (origin, congestion) =>
    fetch(fixture.url + '/__fixture/scenarios', {
      method: 'POST',
      headers: { Origin: origin, Accept: 'application/json' },
      body: new URLSearchParams({ congestion, checkout: 'success' }),
    });
  assert.equal((await post('https://outside.invalid', 'crowded')).status, 403);
  assert.equal((await post(fixture.url, 'not-a-scenario')).status, 400);
  assert.equal((await post(fixture.url, 'crowded')).status, 204);
  assert.equal(fixture.homeControls.congestion, 'crowded');
  assert.equal((await raw('/api/v1/orders')).status, 401);
  fixture.homeControls.congestion = 'normal';
});
test('existing order samples satisfy OR-03 pagination/OR-04 pricing, options and Cooking DTOs', async () => {
  const list = await customer.api.list();
  assert.equal(list.totalElements, 21);
  assert.equal(list.items.length, 20);
  const second = await customer.api.list(1);
  assert.equal(second.items.length, 1);
  const detail = await customer.api.detail(list.items[0].orderId);
  assert.equal(detail.totalAmount, 18000);
  assert.equal(detail.items[0].unitPrice, 6500);
  assert.equal(detail.items[0].options[0].extraPrice, 2500);
  assert.equal(detail.items[0].quantity, 2);
  assert.equal(detail.cooking.expectedWaitSec, 120);
});
test('anonymous/admin/other customer cannot see another customer sample order', async () => {
  assert.equal((await raw('/api/v1/orders')).status, 401);
  assert.equal((await raw('/api/v1/orders', admin)).status, 403);
  assert.equal((await raw('/api/v1/orders/21', admin)).status, 403);
  assert.equal((await other.api.list()).totalElements, 0);
  await assert.rejects(other.api.detail(21), { code: 'ORDER_NOT_FOUND' });
});
test('existing create/pay stays usable, created orders become visible only after payment and stay owner-scoped', async () => {
  const before = (await customer.api.list()).totalElements;
  const post = (path, body) =>
    fetch(fixture.url + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const created = await post('/api/v1/orders', {
    items: [{ menuId: 1, quantity: 2, optionIds: [2] }],
  });
  assert.equal(created.status, 201);
  const order = (await created.json()).data;
  assert.equal((await customer.api.list()).totalElements, before);
  assert.equal(
    (await raw(`/api/v1/orders/${order.orderId}`, other)).status,
    404,
  );
  assert.equal((await post(`/api/v1/orders/${order.orderId}/pay`)).status, 200);
  const list = await customer.api.list();
  assert.equal(list.totalElements, before + 1);
  assert.equal(list.items[0].orderId, order.orderId);
  assert.equal((await customer.api.detail(order.orderId)).status, 'PAID');
});
test('preview cancellation refreshes authoritative data; cooking sample cannot be canceled', async () => {
  assert.equal((await customer.api.cancel(21)).status, 'CANCELED');
  assert.equal((await customer.api.detail(21)).status, 'CANCELED');
  await assert.rejects(customer.api.cancel(2), {
    code: 'ORDER_NOT_CANCELABLE',
  });
});
