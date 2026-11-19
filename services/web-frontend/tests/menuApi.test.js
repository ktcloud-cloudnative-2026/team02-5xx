import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createMenuApi } from '../src/data/menuApi.js';
import { startMenuApiDouble } from './menu-api-server.mjs';
import { readPendingCart, validateCartCatalog } from '../src/cartCatalog.js';
import { cartView, saveCart } from '../src/cart.js';

let server;
let api;
before(async () => {
  server = await startMenuApiDouble();
  api = createMenuApi({ baseUrl: server.url });
});
after(async () => server?.close());

test('ME-01 uses HTTP, omits all category, encodes query and sends a single sort', async () => {
  const paths = [];
  const client = createMenuApi({
    baseUrl: server.url,
    fetchImpl: (url, options) => {
      paths.push(new URL(url));
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Accept, 'application/json');
      return fetch(url, options);
    },
  });
  await client.list({
    categoryId: 'all',
    query: '  버거 %_  ',
    sort: 'priceAsc',
  });
  assert.equal(paths[0].searchParams.has('categoryId'), false);
  assert.equal(paths[0].searchParams.get('query'), '버거 %_');
  assert.deepEqual(paths[0].searchParams.getAll('sort'), ['priceAsc']);
});

test('HTTP list preserves all categories, filters/searches and sorts prices', async () => {
  const all = await api.list();
  assert.equal(all.categories.length, 5);
  assert.ok(all.menus.some((menu) => menu.status === 'PAUSED'));
  assert.ok(all.menus.every((menu) => menu.status !== 'HIDDEN'));
  const filtered = await api.list({
    categoryId: 1,
    query: '버거',
    sort: 'priceDesc',
  });
  assert.equal(filtered.categories.length, 5);
  assert.ok(
    filtered.menus.every(
      (menu) => menu.categoryId === 1 && menu.name.includes('버거'),
    ),
  );
  const prices = filtered.menus.map((menu) => menu.basePrice);
  assert.deepEqual(
    prices,
    [...prices].sort((a, b) => b - a),
  );
  assert.deepEqual((await api.list({ query: '없는 메뉴' })).menus, []);
});

test('HTTP detail retains inactive/default options and null fields, without invented nutrition', async () => {
  const menu = await api.detail(1);
  assert.equal(menu.description, null);
  assert.equal(menu.imageUrl, null);
  assert.ok(menu.options.some((option) => !option.active));
  assert.equal('nutrition' in menu, false);
  assert.equal('ingredients' in menu, false);
  assert.equal((await api.detail(4)).status, 'PAUSED');
  await assert.rejects(api.detail(99999), (error) => error.status === 404);
});

test('aborted requests are propagated rather than displayed as deleted menus', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api.detail(1, { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});

for (const [label, response] of [
  ['bad JSON', () => new Response('<html>proxy error</html>', { status: 502 })],
  [
    'proxy 404',
    () => Response.json({ message: 'missing route' }, { status: 404 }),
  ],
  [
    'business failure',
    () =>
      Response.json(
        {
          success: false,
          errorCode: 'INTERNAL_ERROR',
          message: 'private SQL text',
        },
        { status: 500 },
      ),
  ],
  [
    'unsafe price',
    () =>
      Response.json({
        success: true,
        data: {
          id: 1,
          categoryId: 1,
          name: 'x',
          imageUrl: null,
          basePrice: Number.MAX_SAFE_INTEGER + 1,
          status: 'ON_SALE',
          description: null,
          options: [],
        },
      }),
  ],
  [
    'invalid options',
    () =>
      Response.json({
        success: true,
        data: {
          id: 1,
          categoryId: 1,
          name: 'x',
          imageUrl: null,
          basePrice: 1,
          status: 'ON_SALE',
          description: null,
          options: [null],
        },
      }),
  ],
])
  test(`invalid response fails safely: ${label}`, async () => {
    const client = createMenuApi({ fetchImpl: async () => response() });
    await assert.rejects(
      client.detail(1),
      (error) => error.status !== 404 && !error.message.includes('private SQL'),
    );
  });

test('bad local IDs and sort are rejected before a request', async () => {
  const client = createMenuApi({
    fetchImpl: () => assert.fail('unexpected fetch'),
  });
  for (const value of [0, -1, '1', 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(client.detail(value));
  await assert.rejects(client.list({ categoryId: 0 }));
  await assert.rejects(client.list({ sort: 'wrong' }));
});

test('stored identity survives until every detail is validated; only fresh server prices are used', async () => {
  const raw = JSON.stringify({
    version: 1,
    items: [{ menuId: 1, optionIds: [2], quantity: 2, price: 1 }],
  });
  let writes = 0;
  const storage = () => ({ getItem: () => raw, setItem: () => writes++ });
  const pending = readPendingCart(storage);
  assert.deepEqual(pending.items, [{ menuId: 1, optionIds: [2], quantity: 2 }]);
  assert.equal(writes, 0);
  const checked = await validateCartCatalog(pending.items, api);
  assert.equal(cartView(checked.items, checked.getMenu).total, 18000);
  assert.equal(writes, 0);
  assert.equal(saveCart(checked.items, storage, checked.getMenu), '');
  assert.equal(writes, 1);
});

test('temporary failures never become confirmed deletion or mutate storage/entries', async () => {
  const items = [
    { menuId: 1, optionIds: [1], quantity: 2 },
    { menuId: 2, optionIds: [1], quantity: 1 },
  ];
  const original = structuredClone(items);
  await assert.rejects(
    validateCartCatalog(items, {
      detail: async (menuId) => {
        if (menuId === 2) throw new Error('offline');
        return api.detail(menuId);
      },
    }),
  );
  assert.deepEqual(items, original);
  const retried = await validateCartCatalog(items, api);
  assert.equal(retried.items.length, 2);
});

test('only confirmed 404, PAUSED and inactive options are excluded after full validation', async () => {
  const items = [
    { menuId: 1, optionIds: [1], quantity: 1 },
    { menuId: 99999, optionIds: [], quantity: 1 },
    { menuId: 4, optionIds: [1], quantity: 1 },
    { menuId: 1, optionIds: [3], quantity: 1 },
  ];
  const checked = await validateCartCatalog(items, api);
  assert.deepEqual(checked.items, [items[0]]);
  assert.ok(checked.warning);
  assert.equal(items.length, 4);
});

test('pending restore rejects malformed identity but ignores untrusted stored amounts', () => {
  const raw = {
    version: 1,
    items: [
      null,
      { menuId: 1, optionIds: [1], quantity: 100 },
      { menuId: 1, optionIds: [1], quantity: 2, amount: 0 },
    ],
  };
  const result = readPendingCart(() => ({
    getItem: () => JSON.stringify(raw),
  }));
  assert.equal(result.items.length, 1);
  assert.equal('amount' in result.items[0], false);
  assert.ok(result.warning);
});
