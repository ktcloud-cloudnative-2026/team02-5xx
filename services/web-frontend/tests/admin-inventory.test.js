import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import {
  createInventoryAdminApi,
  parseInventoryNumber,
  validateStockItem,
  InventoryAdminError,
} from '../src/admin-inventory/inventoryAdminApi.js';
import { createInventoryAdminStore } from '../src/admin-inventory/inventoryAdminStore.js';
import { startInventoryFixture, stockRow } from './admin-inventory-fixture.mjs';
const row = stockRow(1, 10, 2, 3, 5);
const response = (data, status = 200, extra = {}) =>
  new Response(
    JSON.stringify({ success: true, data, message: 'ok', ...extra }),
    { status },
  );
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
for (const value of [
  '',
  '-1',
  '1.5',
  '1e3',
  '+2',
  'Infinity',
  '2147483648',
  '9007199254740993',
])
  test(`numeric input rejects ${JSON.stringify(value)}`, () =>
    assert.throws(() => parseInventoryNumber(value), { kind: 'input' }));
test('numeric boundaries and ID precision', () => {
  assert.equal(parseInventoryNumber(' 0 '), 0);
  assert.equal(parseInventoryNumber('2147483647'), 2147483647);
  assert.equal(
    parseInventoryNumber('9007199254740991', { menuId: true }),
    Number.MAX_SAFE_INTEGER,
  );
  assert.throws(() => parseInventoryNumber('0', { positive: true }));
  assert.throws(() => parseInventoryNumber('0', { menuId: true }));
});
for (const patch of [
  { stockItemId: 0 },
  { stockItemId: 9007199254740992 },
  { menuId: undefined },
  { menuId: 0 },
  { stockQty: -1 },
  { reservedQty: 11 },
  { availableQty: 9 },
  { lowStockThreshold: 1.2 },
  { lowStock: 'false' },
  { reservedQty: null },
])
  test(`DTO rejects ${JSON.stringify(patch)}`, () =>
    assert.throws(() => validateStockItem({ ...row, ...patch }), {
      kind: 'protocol',
    }));
test('DTO nullable link and server lowStock flag preserved', () => {
  assert.equal(
    validateStockItem({ ...row, menuId: null, lowStock: true }).lowStock,
    true,
  );
  assert.deepEqual(
    Object.keys(validateStockItem({ ...row, secret: 'never copied' })),
    Object.keys(row),
  );
});
for (const data of [
  {},
  [row, row],
  [row, { ...row, stockItemId: 0 }],
  [{ ...row, stockItemId: 2 }, row],
])
  test(`invalid list rejects ${JSON.stringify(data)}`, async () => {
    await assert.rejects(
      createInventoryAdminApi({ request: async () => response(data) }).list(),
      { kind: 'protocol' },
    );
  });
for (const [status, code] of [
  [400, 'INVALID_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'INVENTORY_NOT_FOUND'],
  [404, 'NOT_FOUND'],
  [404, 'MENU_NOT_FOUND'],
  [409, 'STOCK_ITEM_IN_USE'],
  [409, 'MENU_ALREADY_LINKED'],
  [409, 'MENU_NOT_LINKABLE'],
  [503, 'MENU_SERVICE_UNAVAILABLE'],
  [500, 'INTERNAL_ERROR'],
])
  test(`HTTP ${status} ${code} safe mapping and no automatic replay`, async () => {
    let count = 0;
    const api = createInventoryAdminApi({
      request: async () => {
        count++;
        return response(null, status, {
          success: false,
          errorCode: code,
          message: 'sensitive backend detail',
        });
      },
    });
    await assert.rejects(
      api.link(1, { menuId: 7 }),
      (error) =>
        error.status === status &&
        error.code === code &&
        !error.message.includes('sensitive') &&
        error.uncertain === (status === 500),
    );
    assert.equal(count, 1);
  });
test('bad successful write response is uncertain; DELETE 204 is not accepted', async () => {
  const api = createInventoryAdminApi({
    request: async () => new Response(null, { status: 204 }),
  });
  await assert.rejects(api.remove(1), { kind: 'protocol', uncertain: true });
});
test('network writes uncertain but reads retryable, never retried automatically', async () => {
  let count = 0;
  const api = createInventoryAdminApi({
    request: async () => {
      count++;
      throw new TypeError('failed');
    },
  });
  await assert.rejects(api.list(), { kind: 'network', uncertain: false });
  await assert.rejects(api.restock(1, { quantity: 1 }), {
    kind: 'network',
    uncertain: true,
  });
  assert.equal(count, 2);
});
test('wrong ID/menu and linked create/delete DTO rejected', async () => {
  const api = createInventoryAdminApi({ request: async () => response(row) });
  await assert.rejects(api.link(1, { menuId: 6 }), { uncertain: true });
  await assert.rejects(api.restock(2, { quantity: 2 }), { uncertain: true });
  await assert.rejects(api.remove(1), { uncertain: true });
  await assert.rejects(
    createInventoryAdminApi({ request: async () => response(row, 201) }).create(
      { stockQty: 10, lowStockThreshold: 3 },
    ),
    { uncertain: true },
  );
});
test('invalid writes never touch HTTP', async () => {
  let count = 0;
  const api = createInventoryAdminApi({
    request: async () => {
      count++;
    },
  });
  for (const action of [
    () => api.create({ stockQty: -1, lowStockThreshold: 0 }),
    () => api.restock(1, { quantity: 0 }),
    () => api.link(1, { menuId: '2' }),
    () => api.remove(0),
  ])
    await assert.rejects(async () => action(), { kind: 'input' });
  assert.equal(count, 0);
});
test('real HTTP create/restock/link/unlink/delete exact paths, bodies, statuses and no identity headers', async (t) => {
  const fixture = await startInventoryFixture();
  t.after(fixture.close);
  const api = createInventoryAdminApi({
    request: (path, init) => fetch(fixture.url + path, init),
  });
  assert.equal((await api.list()).length, 6);
  assert.equal((await api.list(true)).length, 3);
  const created = await api.create({
    stockQty: 0,
    lowStockThreshold: 1,
    ignored: true,
  });
  assert.equal(created.menuId, null);
  assert.equal(
    (await api.restock(created.stockItemId, { quantity: 5 })).availableQty,
    5,
  );
  assert.equal(
    (await api.link(created.stockItemId, { menuId: 77 })).menuId,
    77,
  );
  assert.equal(
    (await api.link(created.stockItemId, { menuId: null })).menuId,
    null,
  );
  assert.equal((await api.remove(created.stockItemId)).menuId, null);
  assert.equal((await api.list()).length, 6);
  assert.deepEqual(fixture.requests[2].body, {
    stockQty: 0,
    lowStockThreshold: 1,
  });
  assert.deepEqual(fixture.requests[3].body, { quantity: 5 });
  assert.deepEqual(fixture.requests[5].body, { menuId: null });
  assert.equal(fixture.requests[6].method, 'DELETE');
  assert.equal(fixture.requests[6].body, undefined);
  for (const request of fixture.requests)
    for (const header of ['authorization', 'x-user-id', 'x-user-role'])
      assert.equal(request.headers[header], undefined);
});
test('HTTP menu conflicts, unavailable dependency, active order with reserved 0 preserve rows', async (t) => {
  const fixture = await startInventoryFixture();
  t.after(fixture.close);
  const api = createInventoryAdminApi({
    request: (path, init) => fetch(fixture.url + path, init),
  });
  const before = fixture.rows();
  for (const [menuId, code] of [
    [1, 'MENU_ALREADY_LINKED'],
    [999, 'MENU_NOT_LINKABLE'],
    [998, 'MENU_SERVICE_UNAVAILABLE'],
    [997, 'MENU_NOT_FOUND'],
  ])
    await assert.rejects(api.link(105, { menuId }), { code });
  await assert.rejects(api.remove(104), { code: 'STOCK_ITEM_IN_USE' });
  await assert.rejects(api.link(104, { menuId: null }), {
    code: 'STOCK_ITEM_IN_USE',
  });
  assert.deepEqual(fixture.rows(), before);
});
test('state blocks duplicate writes and applies returned server quantities, not optimistic guesses', async () => {
  const pending = deferred();
  let writes = 0,
    current = row;
  const store = createInventoryAdminStore({
    list: async () => [current],
    restock: () => {
      writes++;
      return pending.promise;
    },
  });
  await store.load();
  store.open('restock', 1);
  const write = store.submit({ quantity: 4 });
  assert.equal(store.getSnapshot().rows[0].stockQty, 10);
  await assert.rejects(store.submit({ quantity: 4 }), { kind: 'busy' });
  current = stockRow(1, 14, 2, 3, 5);
  pending.resolve(current);
  await write;
  await tick();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().rows[0].stockQty, 14);
  assert.equal(store.getSnapshot().panel, null);
});
test('stale filter read cannot overwrite current filter', async () => {
  const old = deferred();
  let calls = 0;
  const store = createInventoryAdminStore({
    list: () => (++calls === 1 ? old.promise : Promise.resolve([])),
  });
  const first = store.load();
  store.filter(true);
  await tick();
  old.resolve([row]);
  await first;
  assert.equal(store.getSnapshot().lowStockOnly, true);
  assert.deepEqual(store.getSnapshot().rows, []);
});
test('write success fences stale list and closed panel stays closed', async () => {
  let calls = 0;
  const old = deferred(),
    pending = deferred();
  const changed = stockRow(1, 15, 2, 3, 5);
  const store = createInventoryAdminStore({
    list: () =>
      ++calls === 2
        ? old.promise
        : Promise.resolve([calls === 1 ? row : changed]),
    restock: () => pending.promise,
  });
  await store.load();
  store.open('restock', 1);
  const read = store.load();
  const write = store.submit({ quantity: 5 });
  store.close();
  pending.resolve(changed);
  await write;
  old.resolve([row]);
  await read;
  await tick();
  assert.equal(store.getSnapshot().panel, null);
  assert.equal(store.getSnapshot().rows[0].stockQty, 15);
});
test('failed writes preserve data and panel; uncertain outcome requires read before explicit retry', async () => {
  let writes = 0;
  const store = createInventoryAdminStore({
    list: async () => [row],
    restock: async () => {
      writes++;
      throw new InventoryAdminError('lost', { uncertain: true });
    },
  });
  await store.load();
  store.open('restock', 1);
  await store.submit({ quantity: 1 });
  assert.deepEqual(store.getSnapshot().rows, [row]);
  assert.equal(store.getSnapshot().panel.kind, 'restock');
  await assert.rejects(store.submit({ quantity: 1 }), { kind: 'review' });
  await store.review();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().mutation.reviewed, true);
  await store.submit({ quantity: 1 });
  assert.equal(writes, 2);
});
test('read failure preserves data, auth failure clears it', async () => {
  let failure;
  const store = createInventoryAdminStore({
    list: async () => {
      if (failure) throw failure;
      return [row];
    },
  });
  await store.load();
  failure = new InventoryAdminError('failed', { status: 503 });
  await store.load();
  assert.deepEqual(store.getSnapshot().rows, [row]);
  failure = new InventoryAdminError('forbidden', { status: 403 });
  await store.load();
  assert.deepEqual(store.getSnapshot().rows, []);
});
test('dispose/reactivate blocks prior lifecycle read/write responses', async () => {
  const pending = deferred();
  const store = createInventoryAdminStore({
    list: async () => [row],
    restock: () => pending.promise,
  });
  await store.load();
  store.open('restock', 1);
  const write = store.submit({ quantity: 9 });
  store.dispose();
  store.activate();
  await store.load();
  pending.resolve(stockRow(1, 19, 2, 3, 5));
  await write;
  assert.equal(store.getSnapshot().rows[0].stockQty, 10);
  assert.equal(store.getSnapshot().notice, '');
});

test('newer authorization failure fences an older successful mutation', async () => {
  const pending = deferred();
  let denied = false;
  const store = createInventoryAdminStore({
    list: async () => {
      if (denied) throw new InventoryAdminError('forbidden', { status: 403 });
      return [row];
    },
    restock: () => pending.promise,
  });
  await store.load();
  store.open('restock', 1);
  const write = store.submit({ quantity: 1 });
  denied = true;
  await store.load();
  pending.resolve(stockRow(1, 11, 2, 3, 5));
  await write;
  assert.deepEqual(store.getSnapshot().rows, []);
  assert.equal(store.getSnapshot().list.error.status, 403);
  assert.equal(store.getSnapshot().notice, '');
  assert.equal(store.getSnapshot().busy, false);
});

test('successful mutation remains successful when subsequent read fails', async () => {
  let reads = 0;
  const changed = stockRow(1, 12, 2, 3, 5);
  const store = createInventoryAdminStore({
    list: async () => {
      if (++reads > 1) throw new InventoryAdminError('network');
      return [row];
    },
    restock: async () => changed,
  });
  await store.load();
  store.open('restock', 1);
  await store.submit({ quantity: 2 });
  await tick();
  assert.equal(store.getSnapshot().rows[0].stockQty, 12);
  assert.equal(store.getSnapshot().panel, null);
  assert.match(store.getSnapshot().notice, /완료/);
  assert.equal(store.getSnapshot().list.phase, 'error');
});

test('review uses complete list even from lowStockOnly; removed target blocks deletion replay', async () => {
  const filters = [];
  let absent = false;
  const store = createInventoryAdminStore({
    list: async (filter) => {
      filters.push(filter);
      return absent ? [] : [row];
    },
    remove: async () => {
      absent = true;
      throw new InventoryAdminError('lost', { uncertain: true });
    },
  });
  await store.load();
  store.open('delete', 1);
  await store.submit();
  store.filter(true);
  await tick();
  await store.review();
  assert.equal(filters.at(-1), false);
  assert.equal(store.getSnapshot().mutation.currentItem, null);
  assert.equal(store.getSnapshot().mutation.reviewed, true);
  await assert.rejects(store.submit(), { kind: 'review' });
});

test('malformed envelope and unsafe IDs do not create fabricated stock data', async () => {
  for (const body of [
    '{',
    JSON.stringify({ success: false, data: [row] }),
    JSON.stringify({ success: true }),
    JSON.stringify({
      success: true,
      data: [{ ...row, stockItemId: 9007199254740992 }],
    }),
  ]) {
    const api = createInventoryAdminApi({
      request: async () => new Response(body, { status: 200 }),
    });
    await assert.rejects(api.list(), { kind: 'protocol', uncertain: false });
  }
});

test('read AbortSignal and same-origin credentials do not allow caller mutation overrides', async () => {
  let init;
  const controller = new AbortController();
  const api = createInventoryAdminApi({
    request: async (_path, options) => {
      init = options;
      return response([row]);
    },
  });
  await api.list(false, {
    signal: controller.signal,
    method: 'DELETE',
    headers: { 'X-User-Id': '1' },
  });
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, { Accept: 'application/json' });
  controller.abort();
  await assert.rejects(api.list(false, { signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('customer production bundle excludes independent admin UI, admin HTTP path and fixture controls', async () => {
  const bundle = await build({ logLevel: 'error', build: { write: false } });
  const chunks = bundle.output.filter((file) => file.type === 'chunk');
  const modules = chunks.flatMap((file) => Object.keys(file.modules));
  assert.equal(
    modules.some((id) =>
      /admin-inventory|\/tests\//.test(id.replaceAll('\\', '/')),
    ),
    false,
  );
  const code = chunks.map((file) => file.code).join('\n');
  for (const marker of [
    '/api/v1/admin/inventory',
    '/__fixture',
    '시나리오 적용·초기화',
  ])
    assert.equal(code.includes(marker), false, marker);
});

test('selected-menu registration creates once then links; success uses linked DTO', async () => {
  const calls = [];
  const created = stockRow(2, 5, 0, 1);
  const store = createInventoryAdminStore({
    list: async () => [],
    create: async (body) => {
      calls.push(['create', body]);
      return created;
    },
    link: async (id, body) => {
      calls.push(['link', id, body]);
      return { ...created, menuId: body.menuId };
    },
  });
  await store.load();
  store.open('create');
  const item = await store.submit({
    stockQty: 5,
    lowStockThreshold: 1,
    menuId: 7,
  });
  assert.equal(item.menuId, 7);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['create', 'link'],
  );
  assert.deepEqual(calls[1], ['link', 2, { menuId: 7 }]);
});
test('partial creation keeps unlinked stock and retries only link, never compensating DELETE', async () => {
  let creates = 0,
    links = 0;
  const created = stockRow(2, 9, 0, 1);
  const store = createInventoryAdminStore({
    list: async () => [created],
    create: async () => {
      creates++;
      return created;
    },
    link: async () => {
      if (++links === 1)
        throw new InventoryAdminError('already linked', {
          status: 409,
          code: 'MENU_ALREADY_LINKED',
        });
      return { ...created, menuId: 7 };
    },
  });
  await store.load();
  store.open('create');
  await store.submit({ stockQty: 9, lowStockThreshold: 1, menuId: 7 });
  const state = store.getSnapshot();
  assert.equal(state.panel.kind, 'link');
  assert.equal(state.panel.partialCreate, true);
  assert.equal(state.rows[0].menuId, null);
  assert.match(state.notice, /미연결/);
  await store.submit({ menuId: 7 });
  assert.equal(creates, 1);
  assert.equal(links, 2);
});
test('unknown create result never automatically links or creates again', async () => {
  let creates = 0,
    links = 0;
  const store = createInventoryAdminStore({
    list: async () => [],
    create: async () => {
      creates++;
      throw new InventoryAdminError('lost', { uncertain: true });
    },
    link: async () => {
      links++;
    },
  });
  await store.load();
  store.open('create');
  await store.submit({ stockQty: 1, lowStockThreshold: 0, menuId: 7 });
  assert.equal(creates, 1);
  assert.equal(links, 0);
  assert.equal(store.getSnapshot().panel.kind, 'create');
  assert.equal(store.getSnapshot().mutation.phase, 'uncertain');
});
test('busy close is ignored and disposal between create/link prevents second write', async () => {
  const pending = deferred();
  let links = 0;
  const store = createInventoryAdminStore({
    list: async () => [],
    create: () => pending.promise,
    link: async () => {
      links++;
    },
  });
  await store.load();
  store.open('create');
  const write = store.submit({ stockQty: 1, lowStockThreshold: 0, menuId: 7 });
  store.close();
  assert.equal(store.getSnapshot().panel.kind, 'create');
  store.dispose();
  pending.resolve(stockRow(2, 1, 0, 0));
  await write;
  assert.equal(links, 0);
});
