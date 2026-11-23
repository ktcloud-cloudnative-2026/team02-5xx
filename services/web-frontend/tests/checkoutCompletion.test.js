import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  subtractPurchasedItems,
  captureCartStorage,
  completePaidCart,
} from '../src/checkout/checkoutCompletion.js';

const ordered = [{ menuId: 1, optionIds: [2], quantity: 2 }];
const other = { menuId: 1, optionIds: [1], quantity: 3 };
function storage(items = ordered) {
  let raw = JSON.stringify({ version: 1, items });
  let writes = 0;
  return {
    getItem: () => raw,
    setItem: (key, next) => {
      assert.equal(key, 'peak-order.cart.v1');
      raw = next;
      writes++;
    },
    replace: (items) => {
      raw = JSON.stringify({ version: 1, items });
    },
    writes: () => writes,
    raw: () => raw,
  };
}
test('paid cart removes only purchased quantities and preserves other options without mutating input', () => {
  const current = [{ ...ordered[0], quantity: 5 }, other];
  const before = structuredClone(current);
  assert.deepEqual(subtractPurchasedItems(current, ordered), [
    { ...ordered[0], quantity: 3 },
    other,
  ]);
  assert.deepEqual(current, before);
  for (const quantity of [1, 2])
    assert.deepEqual(
      subtractPurchasedItems([{ ...ordered[0], quantity }, other], ordered),
      [other],
    );
  assert.deepEqual(subtractPurchasedItems([other], ordered), [other]);
});
test('duplicate current/ordered rows consume purchased quantity only once across matching rows', () => {
  assert.deepEqual(
    subtractPurchasedItems(
      [{ ...ordered[0], quantity: 1 }, { ...ordered[0], quantity: 4 }, other],
      ordered,
    ),
    [{ ...ordered[0], quantity: 3 }, other],
  );
  assert.deepEqual(
    subtractPurchasedItems(
      [{ ...ordered[0], quantity: 5 }],
      [...ordered, ...ordered],
    ),
    [{ ...ordered[0], quantity: 1 }],
  );
});
test('success reconciliation uses newer persisted cart and retains later additions', () => {
  const store = storage();
  const provider = () => store;
  const baseline = captureCartStorage(provider);
  store.replace([{ ...ordered[0], quantity: 4 }, other]);
  const result = completePaidCart({
    orderedItems: ordered,
    currentItems: ordered,
    storageProvider: provider,
    baseline,
    canApply: () => true,
  });
  assert.deepEqual(result.items, [{ ...ordered[0], quantity: 2 }, other]);
  assert.deepEqual(JSON.parse(store.raw()), {
    version: 1,
    items: result.items,
  });
  assert.equal(store.writes(), 1);
});
test('unchanged storage baseline preserves newer in-memory non-target items', () => {
  const store = storage();
  const provider = () => store;
  const result = completePaidCart({
    orderedItems: ordered,
    currentItems: [...ordered, other],
    storageProvider: provider,
    baseline: captureCartStorage(provider),
    canApply: () => true,
  });
  assert.deepEqual(result.items, [other]);
});
test('deleted current cart stays deleted; malformed or inaccessible storage is never overwritten', () => {
  const store = storage();
  const provider = () => store;
  const baseline = captureCartStorage(provider);
  store.getItem = () => null;
  assert.deepEqual(
    completePaidCart({
      orderedItems: ordered,
      currentItems: ordered,
      storageProvider: provider,
      baseline,
      canApply: () => true,
    }).items,
    [],
  );
  for (const getItem of [
    () => '{',
    () => JSON.stringify({ version: 1, items: [null] }),
    () => {
      throw new Error('denied');
    },
  ]) {
    const broken = {
      getItem,
      setItem: () => assert.fail('must not overwrite'),
    };
    const result = completePaidCart({
      orderedItems: ordered,
      currentItems: ordered,
      storageProvider: () => broken,
      baseline,
      canApply: () => true,
    });
    assert.deepEqual(result.items, ordered);
    assert.ok(result.warning);
  }
});
test('session change during storage access blocks cart write and keeps current items', () => {
  const store = storage();
  let allowed = true;
  const baseline = captureCartStorage(() => store);
  const getItem = store.getItem;
  store.getItem = () => {
    allowed = false;
    return getItem();
  };
  const result = completePaidCart({
    orderedItems: ordered,
    currentItems: ordered,
    storageProvider: () => store,
    baseline,
    canApply: () => allowed,
  });
  assert.equal(store.writes(), 0);
  assert.deepEqual(result.items, ordered);
});
test('storage write failure keeps cart intact and returns a warning without changing payment success', () => {
  const store = storage();
  const provider = () => store;
  const baseline = captureCartStorage(provider);
  store.setItem = () => {
    throw new Error('quota');
  };
  const result = completePaidCart({
    orderedItems: ordered,
    currentItems: ordered,
    storageProvider: provider,
    baseline,
    canApply: () => true,
  });
  assert.deepEqual(result.items, ordered);
  assert.ok(result.warning);
});
