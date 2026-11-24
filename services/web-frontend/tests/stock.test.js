import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInventoryApi } from '../src/data/inventoryApi.js';
import {
  stockStatus,
  cartStock,
  createStockGate,
} from '../src/stockAvailability.js';
import { validateCartCatalog } from '../src/cartCatalog.js';
import {
  cartView,
  changeQuantity,
  removeItem,
  saveCart,
  addItem,
} from '../src/cart.js';
import { startStockFixture } from './stock-fixture.mjs';
import { resolve } from 'node:path';
const menu = {
  id: 1,
  name: 'Fixture',
  status: 'ON_SALE',
  basePrice: 1000,
  options: [
    { id: 1, name: '단품', active: true, extraPrice: 0 },
    { id: 2, name: '세트', active: true, extraPrice: 500 },
  ],
};
const row = (menuId = 1, availableQty = 10) => ({
  menuId,
  availableQty,
  orderable: availableQty > 0,
});
const envelope = (data) =>
  Response.json({ success: true, data, message: 'Synthetic only' });
const item = (quantity = 1, optionId = 1) => ({
  menuId: 1,
  optionIds: [optionId],
  quantity,
});
test('IN-01 deduplicates input, splits at 100, preserves same-origin GET contract and validates every batch', async () => {
  const calls = [];
  const api = createInventoryApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return envelope(
        url
          .split('=')[1]
          .split(',')
          .map((id) => row(Number(id))),
      );
    },
  });
  const result = await api.availability([
    ...Array.from({ length: 205 }, (_, i) => i + 1),
    1,
  ]);
  assert.equal(result.size, 205);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((c) => c.url.split('=')[1].split(',').length),
    [100, 100, 5],
  );
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('/api/v1/inventory/availability?menuIds='));
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal((await api.availability([])).size, 0);
  assert.equal(calls.length, 3);
});
for (const bad of [
  null,
  ['1'],
  [0],
  [-1],
  [1.5],
  [Number.MAX_SAFE_INTEGER + 1],
])
  test(`invalid Inventory IDs ${JSON.stringify(bad)} rejected before HTTP`, async () => {
    const api = createInventoryApi({
      fetchImpl: () => assert.fail('unexpected request'),
    });
    await assert.rejects(api.availability(bad));
  });
for (const [name, data] of [
  ['missing menu', []],
  ['duplicate menu', [row(), row()]],
  ['unrequested menu', [row(2)]],
  ['string quantity', [{ ...row(), availableQty: '1' }]],
  ['fraction', [{ ...row(), availableQty: 1.2 }]],
  ['negative', [{ ...row(), availableQty: -1 }]],
  ['overflow', [row(1, 2147483648)]],
  ['string orderable', [{ ...row(), orderable: 'true' }]],
  ['inconsistent flag', [{ ...row(), orderable: false }]],
  ['object instead of list', {}],
  ['null', null],
])
  test(`malformed Inventory ${name} stays unknown rather than sold out`, async () => {
    const api = createInventoryApi({ fetchImpl: async () => envelope(data) });
    await assert.rejects(api.availability([1]), /재고 확인 불가/);
  });
for (const status of [400, 401, 403, 500, 503])
  test(`Inventory HTTP ${status}: no automatic retry or invented stock`, async () => {
    let calls = 0;
    const api = createInventoryApi({
      fetchImpl: async () => {
        calls++;
        return Response.json({ success: false, data: null }, { status });
      },
    });
    await assert.rejects(api.availability([1]), (e) => e.status === status);
    assert.equal(calls, 1);
  });
test('network/non-JSON errors and explicit retry', async () => {
  let attempt = 0;
  const api = createInventoryApi({
    fetchImpl: async () => {
      attempt++;
      if (attempt === 1) throw new Error('network');
      if (attempt === 2) return new Response('<html>proxy</html>');
      return envelope([row(1, 0)]);
    },
  });
  await assert.rejects(api.availability([1]), /재고 확인 불가/);
  await assert.rejects(api.availability([1]), /재고 확인 불가/);
  assert.equal((await api.availability([1])).get(1).orderable, false);
});
test('stock states distinguish sale pause, sold out, loading, unknown, insufficient and normal', () => {
  assert.equal(
    stockStatus(menu, { data: new Map([[1, row(1, 0)]]) }).label,
    '품절',
  );
  assert.equal(
    stockStatus({ ...menu, status: 'PAUSED' }, { error: new Error() }).label,
    '판매 중지',
  );
  assert.equal(stockStatus(menu, { loading: true }).label, '재고 확인 중');
  assert.equal(
    stockStatus(menu, { error: new Error() }).label,
    '재고 확인 불가',
  );
  assert.equal(
    stockStatus(menu, { data: new Map([[1, row()]]) }, 10).blocked,
    false,
  );
  assert.match(
    stockStatus(menu, { data: new Map([[1, row()]]) }, 11).label,
    /재고 부족/,
  );
});
test('cart compares all option lines against shared menu quantity without mutating entries', () => {
  const items = [item(2), item(2, 2)],
    before = structuredClone(items);
  const checked = cartStock(items, () => menu, {
    data: new Map([[1, row(1, 3)]]),
  });
  assert.equal(checked.blocked, true);
  assert.match(checked.states.get(1).label, /선택 합계 4개/);
  assert.deepEqual(items, before);
  assert.equal(
    cartStock(items, () => menu, { data: new Map([[1, row(1, 4)]]) }).blocked,
    false,
  );
});
test('paused cart entries can be displayed, edited, removed and saved without allowing a new paused selection', async () => {
  const paused = { ...menu, status: 'PAUSED' },
    items = [item(2), item(2, 2)];
  const checked = await validateCartCatalog(
    items,
    { detail: async () => paused },
    { allowPaused: true },
  );
  assert.deepEqual(checked.items, items);
  const view = cartView(checked.items, checked.getMenu, { allowPaused: true });
  assert.equal(view.rows.length, 2);
  const next = changeQuantity(
    checked.items,
    view.rows[0].key,
    1,
    checked.getMenu,
    { allowPaused: true },
  );
  let saved;
  assert.equal(
    saveCart(
      next,
      () => ({
        setItem: (_, raw) => {
          saved = JSON.parse(raw);
        },
      }),
      checked.getMenu,
      { allowPaused: true },
    ),
    '',
  );
  assert.deepEqual(saved.items, next);
  assert.equal(
    removeItem(next, view.rows[0].key, checked.getMenu, { allowPaused: true })
      .length,
    1,
  );
  assert.throws(() => addItem([], item(), () => paused));
});
test('cancel/new attempt fences a transport ignoring AbortSignal', async () => {
  let complete;
  const gate = createStockGate({
    availability: () =>
      new Promise((done) => {
        complete = done;
      }),
  });
  const old = gate.check([1]);
  gate.cancel();
  complete(new Map([[1, row()]]));
  await assert.rejects(old, (e) => e.name === 'AbortError');
  const first = gate.check([1]),
    finishFirst = complete;
  const second = gate.check([1]),
    finishSecond = complete;
  finishSecond(new Map([[1, row(1, 0)]]));
  assert.equal((await second).get(1).availableQty, 0);
  finishFirst(new Map([[1, row()]]));
  await assert.rejects(first, (e) => e.name === 'AbortError');
});
test('real HTTP fixture: normal, sold, insufficient, failure/retry, missing and duplicate rows', async () => {
  const fixture = await startStockFixture({ input: resolve('src/main.jsx') });
  const api = createInventoryApi({
    fetchImpl: (path, options) => fetch(fixture.url + path, options),
  });
  try {
    const mixed = await api.availability([1, 2, 3]);
    assert.equal(mixed.get(1).availableQty, 10);
    assert.equal(mixed.get(2).orderable, false);
    assert.equal(mixed.get(3).availableQty, 2);
    fixture.stockControls.status = 503;
    await assert.rejects(api.availability([1]));
    fixture.stockControls.status = 200;
    assert.equal((await api.availability([1])).get(1).orderable, true);
    for (const mode of ['missing', 'duplicate']) {
      fixture.stockControls.mode = mode;
      await assert.rejects(api.availability([1]));
    }
  } finally {
    await fixture.close();
  }
});
