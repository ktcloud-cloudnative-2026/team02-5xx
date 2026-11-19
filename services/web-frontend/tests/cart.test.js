import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addItem,
  cartView,
  changeQuantity,
  removeItem,
  describeItem,
  loadCart,
  saveCart,
  CART_STORAGE_KEY,
} from '../src/cart.js';
import { getMenu } from '../src/data/menuRepository.js';

function storage(value = null) {
  let raw = value;
  return {
    getItem: () => raw,
    setItem: (key, next) => {
      assert.equal(key, CART_STORAGE_KEY);
      raw = next;
    },
    read: () => raw,
  };
}
const single = { menuId: 1, optionIds: [1], quantity: 1 };
const set = { menuId: 1, optionIds: [2], quantity: 2 };

test('selected option and quantity determine the display total', () => {
  const item = describeItem(set, getMenu);
  assert.equal(item.unitPrice, 9000);
  assert.equal(item.quantity, 2);
  assert.equal(item.total, 18000);
  assert.deepEqual(item.optionNames, ['세트']);
});

test('same menu and options merge quantities; another configuration remains separate', () => {
  let items = addItem([], single, getMenu).items;
  items = addItem(items, { ...single, quantity: 2 }, getMenu).items;
  items = addItem(items, set, getMenu).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].quantity, 3);
  assert.equal(cartView(items, getMenu).total, 37500);
});

test('duplicates cap at 99 with explicit limit feedback', () => {
  const items = addItem([], { ...single, quantity: 99 }, getMenu).items;
  const result = addItem(items, single, getMenu);
  assert.equal(result.items[0].quantity, 99);
  assert.equal(result.limited, true);
});

test('quantity changes and deletion recompute totals without mutating prior state', () => {
  const items = addItem([], set, getMenu).items;
  const key = cartView(items, getMenu).rows[0].key;
  const next = changeQuantity(items, key, 3, getMenu);
  assert.equal(items[0].quantity, 2);
  assert.equal(cartView(next, getMenu).total, 27000);
  assert.deepEqual(removeItem(next, key, getMenu), []);
  assert.deepEqual(cartView([], getMenu), { rows: [], total: 0 });
});

for (const quantity of [0, -1, 100, 1.5, NaN, Infinity, '2', null]) {
  test(`rejects invalid quantity ${String(quantity)}`, () => {
    assert.throws(() => addItem([], { ...single, quantity }, getMenu));
    assert.throws(() =>
      changeQuantity(
        [single],
        describeItem(single, getMenu).key,
        quantity,
        getMenu,
      ),
    );
  });
}

for (const selection of [
  { ...single, menuId: 4 }, // PAUSED
  { ...single, menuId: 999 },
  { ...single, menuId: -1 },
  { ...single, menuId: '1' },
  { ...single, optionIds: [3] }, // inactive
  { ...single, optionIds: [999] },
  { ...single, optionIds: [] }, // this menu has required radio options
  { ...single, optionIds: [1, 2] },
  { ...single, optionIds: ['1'] },
  null,
]) {
  test(`rejects unavailable or malformed selection ${JSON.stringify(selection)}`, () => {
    assert.throws(() => describeItem(selection, getMenu));
  });
}

test('hidden menus and invalid catalog prices cannot be added or restored', () => {
  for (const change of [
    { status: 'HIDDEN' },
    { basePrice: -1 },
    { basePrice: 1.5 },
    { basePrice: NaN },
    { basePrice: Number.MAX_SAFE_INTEGER },
    { options: null },
    { options: [{ id: 1, active: true, extraPrice: -1 }] },
    { options: [{ id: 1, active: true, extraPrice: Infinity }] },
  ]) {
    const lookup = () => ({ ...getMenu(1), ...change });
    assert.throws(() => describeItem({ ...single, quantity: 2 }, lookup));
    const restored = loadCart(
      () =>
        storage(
          JSON.stringify({ version: 1, items: [{ ...single, quantity: 2 }] }),
        ),
      lookup,
    );
    assert.deepEqual(restored.items, []);
    assert.ok(restored.warning);
  }
});

test('combined totals cannot overflow safe integer arithmetic', () => {
  const lookup = (id) => ({
    ...getMenu(id),
    basePrice: id === 1 ? Number.MAX_SAFE_INTEGER - 100 : 200,
  });
  const first = addItem([], single, lookup).items;
  assert.throws(() =>
    addItem(first, { menuId: 2, optionIds: [1], quantity: 1 }, lookup),
  );
});

test('menus with no options accept an empty option list', () => {
  const cola = describeItem({ menuId: 7, optionIds: [], quantity: 1 }, getMenu);
  assert.equal(cola.name, '콜라');
  assert.deepEqual(cola.optionNames, []);
});

test('round trip restores IDs and quantity using current catalog data only', () => {
  const memory = storage();
  assert.equal(
    saveCart([set], () => memory, getMenu),
    '',
  );
  assert.deepEqual(JSON.parse(memory.read()), { version: 1, items: [set] });
  assert.deepEqual(loadCart(() => memory, getMenu).items, [set]);
  const changedPrice = (id) => ({ ...getMenu(id), basePrice: 7000 });
  assert.equal(
    cartView(loadCart(() => memory, changedPrice).items, changedPrice).total,
    19000,
  );
});

test('storage never persists names, prices, identity, credentials or arbitrary extra fields', () => {
  const memory = storage();
  saveCart(
    [
      {
        ...single,
        name: 'tampered',
        unitPrice: 1,
        token: 'not-a-token',
        userId: 99,
        password: 'not-a-password',
      },
    ],
    () => memory,
    getMenu,
  );
  assert.deepEqual(JSON.parse(memory.read()).items, [single]);
  assert.equal(
    cartView(loadCart(() => memory, getMenu).items, getMenu).total,
    6500,
  );
});

for (const raw of [
  '{',
  'null',
  '[]',
  '{}',
  '{"version":0,"items":[]}',
  '{"version":1}',
  '{"version":1,"items":{}}',
]) {
  test(`invalid or old storage resets safely: ${raw}`, () => {
    const result = loadCart(() => storage(raw), getMenu);
    assert.deepEqual(result.items, []);
    assert.ok(result.warning);
  });
}

test('malformed entries are dropped while valid entries and duplicate normalization survive', () => {
  const raw = JSON.stringify({
    version: 1,
    items: [
      single,
      { ...single, quantity: 3 },
      set,
      {},
      null,
      { ...single, quantity: 0 },
      { ...single, menuId: 4 },
    ],
  });
  const result = loadCart(() => storage(raw), getMenu);
  assert.deepEqual(result.items, [{ ...single, quantity: 4 }, set]);
  assert.ok(result.warning);
});

test('missing storage has no warning; getter/read/write exceptions do not crash', () => {
  assert.deepEqual(
    loadCart(() => storage(), getMenu),
    { items: [], warning: '' },
  );
  const denied = () => {
    throw new Error('denied');
  };
  assert.deepEqual(loadCart(denied, getMenu).items, []);
  assert.ok(saveCart([single], denied, getMenu));
  assert.deepEqual(loadCart(() => ({ getItem: denied }), getMenu).items, []);
  assert.ok(saveCart([single], () => ({ setItem: denied }), getMenu));
});

test('persisted invalid quantities/options are discarded without losing valid configurations', () => {
  const invalid = [
    ...[-1, 100, 1.5, '2', null].map((quantity) => ({ ...single, quantity })),
    ...[null, [999], [3], ['1'], [1, 2]].map((optionIds) => ({
      ...single,
      optionIds,
    })),
  ];
  const result = loadCart(
    () => storage(JSON.stringify({ version: 1, items: [...invalid, set] })),
    getMenu,
  );
  assert.deepEqual(result.items, [set]);
  assert.ok(result.warning);
});

test('restoration validates actual option prices and ignores injected persisted prices', () => {
  for (const extraPrice of [-1, 0.5, '2500', null, Infinity]) {
    const lookup = () => ({
      ...getMenu(1),
      options: [{ id: 1, name: '단품', active: true, extraPrice }],
    });
    const result = loadCart(
      () => storage(JSON.stringify({ version: 1, items: [single] })),
      lookup,
    );
    assert.deepEqual(result.items, []);
    assert.ok(result.warning);
  }
  const result = loadCart(
    () =>
      storage(
        JSON.stringify({
          version: 1,
          items: [{ ...set, basePrice: -100, unitPrice: 0, total: 1 }],
        }),
      ),
    getMenu,
  );
  assert.deepEqual(result.items, [set]);
  assert.equal(cartView(result.items, getMenu).total, 18000);
});
