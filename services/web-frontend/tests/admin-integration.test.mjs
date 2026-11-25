import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ROUTES,
  parseAdminLocation,
  adminAccess,
  adminRequest,
} from '../src/admin/adminRoute.js';
import { createAdminMenuApi } from '../src/data/admin/adminMenuApi.js';
import {
  adminMenuFixtures,
  adminCategories,
} from '../src/data/admin/adminMenuFixtures.js';
const admin = {
  authenticated: true,
  phase: 'authenticated',
  role: 'STORE_ADMIN',
  user: { id: 2, role: 'STORE_ADMIN' },
};
const json = (data, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), { status });
for (const route of ADMIN_ROUTES)
  test(`admin route ${route.href}`, () => {
    assert.equal(parseAdminLocation(route.href).id, route.id);
    assert.equal(parseAdminLocation(`${route.href}?page=1`).id, route.id);
  });
for (const hash of [
  '#home',
  '#menu-list',
  '#orders',
  '#orders/1',
  '#account',
  '#account/profile',
  '#cart',
  '#administrator',
  '#admin-orders',
])
  test(`customer/standalone route preserved: ${hash}`, () =>
    assert.equal(parseAdminLocation(hash), null));
test('unknown admin namespace stays behind the admin guard', () =>
  assert.equal(parseAdminLocation('#admin/unknown').id, 'not-found'));
test('guard denies restoration, anonymous, customer and inconsistent role', () => {
  assert.equal(adminAccess(admin, false), 'restoring');
  assert.equal(
    adminAccess({ ...admin, phase: 'restoring' }, true),
    'restoring',
  );
  assert.equal(adminAccess({ authenticated: false }, true), 'anonymous');
  assert.equal(adminAccess({ ...admin, role: 'CUSTOMER' }, true), 'forbidden');
  assert.equal(
    adminAccess({ ...admin, user: { role: 'CUSTOMER' } }, true),
    'forbidden',
  );
  assert.equal(adminAccess(admin, true), 'allowed');
});
test('admin request delegates recovery for GET only, does not forge identity', async () => {
  const calls = [],
    source = {
      getSnapshot: () => admin,
      request: async (...args) => {
        calls.push(args);
        return json({});
      },
    };
  const request = adminRequest(source);
  await request('/api/v1/admin/orders');
  await request('/api/v1/admin/menus', { method: 'POST', retryOn401: true });
  await request('/api/v1/admin/menus/1', { method: 'PATCH' });
  assert.deepEqual(
    calls.map(([, options]) => options.retryOn401),
    [true, false, false],
  );
  assert.ok(calls.every(([, options]) => !options.headers));
});
test('previous identity cannot dispatch requests or apply late responses', async () => {
  let snapshot = admin,
    resolve;
  const source = {
    getSnapshot: () => snapshot,
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const request = adminRequest(source),
    pending = request('/api/v1/admin/orders');
  snapshot = { ...admin, user: { id: 3, role: 'STORE_ADMIN' } };
  resolve(json({}));
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(request('/api/v1/admin/orders'), { name: 'AbortError' });
});
test('menu HTTP list, detail and ME05/06/07 use actual response keys and methods', async () => {
  const calls = [],
    menu = adminMenuFixtures[0];
  const api = createAdminMenuApi({
    request: async (path, options) => {
      calls.push({ path, options });
      if (options.method === 'GET')
        return json(
          path.includes('?')
            ? { categories: adminCategories, menus: [menu] }
            : menu,
        );
      return json({
        menuId: menu.id,
        ...(path.endsWith('/status') ? { status: 'HIDDEN' } : {}),
      });
    },
  });
  await api.list({
    query: 'a & b',
    status: 'HIDDEN',
    categoryId: 1,
    sort: 'priceDesc',
  });
  await api.detail(menu.id);
  await api.create({
    categoryId: 1,
    name: '새 메뉴',
    basePrice: 100,
    cookTimeSec: 0,
    status: 'PAUSED',
    options: [],
  });
  await api.update(menu.id, { name: '수정 메뉴' });
  await api.changeStatus(menu.id, 'HIDDEN');
  assert.ok(calls[0].path.includes('query=a+%26+b'));
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ['GET', 'GET', 'POST', 'PATCH', 'PATCH'],
  );
  assert.ok(
    calls.every(
      ({ options }) =>
        options.credentials === 'same-origin' && options.redirect === 'error',
    ),
  );
});
for (const status of [401, 403])
  test(`menu text/plain ${status} is classified before JSON`, async () => {
    const api = createAdminMenuApi({
      request: async () => new Response('denied', { status }),
    });
    await assert.rejects(
      api.list(),
      (error) => error.status === status && error.kind === 'http',
    );
  });
test('menu unknown write has one dispatch and never reports success', async () => {
  let calls = 0;
  const api = createAdminMenuApi({
    request: async () => {
      calls++;
      throw new TypeError('network');
    },
  });
  await assert.rejects(
    api.update(1, { name: '수정' }),
    (error) => error.uncertain === true,
  );
  assert.equal(calls, 1);
});
test('menu malformed data and wrong response IDs are not successful saves', async () => {
  const api = createAdminMenuApi({ request: async () => json({ menuId: 99 }) });
  await assert.rejects(api.list(), { kind: 'protocol' });
  await assert.rejects(
    api.update(1, { name: '수정' }),
    (error) => error.kind === 'protocol' && error.uncertain,
  );
});
test('menu GET abort cannot apply response', async () => {
  const controller = new AbortController();
  const api = createAdminMenuApi({
    request: async () => {
      controller.abort();
      return json({ categories: [], menus: [] });
    },
  });
  await assert.rejects(api.list({}, { signal: controller.signal }), {
    name: 'AbortError',
  });
});
