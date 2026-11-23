import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anonymousSession, planCartIntent } from '../src/session.js';

test('anonymous add is public and preserves an independent option/quantity snapshot', () => {
  const selection = { menuId: 1, optionIds: [2], quantity: 2 };
  const result = planCartIntent(anonymousSession.getSnapshot(), {
    type: 'add',
    selection,
  });
  assert.equal(result.pending, null);
  assert.deepEqual(result.action, { type: 'add', selection });
  selection.optionIds[0] = 1;
  selection.quantity = 99;
  assert.deepEqual(result.action.selection, {
    menuId: 1,
    optionIds: [2],
    quantity: 2,
  });
});

for (const type of ['order', 'login']) {
  test(`anonymous ${type} waits for login without navigation or order execution`, () => {
    assert.deepEqual(planCartIntent(null, { type }), {
      action: null,
      pending: { type },
    });
  });
}

test('a future injected verified snapshot resumes the exact pending selection', () => {
  const pending = planCartIntent(null, {
    type: 'order',
    selection: { menuId: 1, optionIds: [2], quantity: 3 },
  }).pending;
  assert.deepEqual(
    planCartIntent({ authenticated: true, role: 'CUSTOMER' }, pending),
    {
      action: pending,
      pending: null,
    },
  );
});

test('a role or arbitrary stored token does not represent a connected UI session', () => {
  for (const fake of [
    { role: 'STORE_ADMIN' },
    { token: 'test-only-invalid-token' },
    { userId: 1 },
    {},
  ]) {
    assert.equal(planCartIntent(fake, { type: 'order' }).action, null);
  }
});

test('cart view/add are public for anonymous, CUSTOMER and STORE_ADMIN; only order requires CUSTOMER', () => {
  for (const session of [
    null,
    { authenticated: true, user: { id: 1, role: 'CUSTOMER' } },
    { authenticated: true, user: { id: 2, role: 'STORE_ADMIN' } },
  ]) {
    for (const type of ['view', 'add']) {
      const result = planCartIntent(session, { type });
      assert.equal(result.pending, null);
      assert.deepEqual(result.action, { type });
      assert.equal(result.forbidden, undefined);
    }
  }
  assert.equal(
    planCartIntent(
      { authenticated: true, user: { id: 2, role: 'STORE_ADMIN' } },
      { type: 'order' },
    ).forbidden,
    true,
  );
});
