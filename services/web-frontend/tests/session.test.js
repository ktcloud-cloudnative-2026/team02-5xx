import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anonymousSession, planCartIntent } from '../src/session.js';

test('anonymous add preserves option and quantity without allowing a cart mutation', () => {
  const selection = { menuId: 1, optionIds: [2], quantity: 2 };
  const result = planCartIntent(anonymousSession.getSnapshot(), {
    type: 'add',
    selection,
  });
  assert.equal(result.action, null);
  assert.deepEqual(result.pending, { type: 'add', selection });
  selection.optionIds[0] = 1;
  selection.quantity = 99;
  assert.deepEqual(result.pending.selection, {
    menuId: 1,
    optionIds: [2],
    quantity: 2,
  });
});

for (const type of ['view', 'order']) {
  test(`anonymous ${type} waits for login without navigation or order execution`, () => {
    assert.deepEqual(planCartIntent(null, { type }), {
      action: null,
      pending: { type },
    });
  });
}

test('a future injected verified snapshot resumes the exact pending selection', () => {
  const pending = planCartIntent(null, {
    type: 'add',
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
    assert.equal(planCartIntent(fake, { type: 'view' }).action, null);
  }
});
