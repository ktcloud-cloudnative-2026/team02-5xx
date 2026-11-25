import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogBackdrop } from '../src/dialogBackdrop.js';
function fixture() {
  let calls = 0,
    top = true;
  const dialog = {
    getBoundingClientRect: () => ({
      left: 100,
      right: 500,
      top: 100,
      bottom: 500,
    }),
  };
  const child = {};
  const handlers = createDialogBackdrop(
    () => calls++,
    () => top,
  );
  const event = (outside, childTarget = false, extra = {}) => ({
    currentTarget: dialog,
    target: childTarget ? child : dialog,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: outside ? 50 : 150,
    clientY: 150,
    ...extra,
  });
  const drag = (a, b) => {
    handlers.onPointerDown(a);
    handlers.onPointerUp(b);
    handlers.onClick(b);
  };
  return {
    handlers,
    event,
    drag,
    calls: () => calls,
    otherTop: () => {
      top = false;
    },
  };
}
for (const [name, down, up] of [
  ['inside to outside', false, true],
  ['outside to inside', true, false],
  ['inside padding click', false, false],
])
  test(`backdrop ignores ${name}`, () => {
    const f = fixture();
    f.drag(f.event(down), f.event(up));
    assert.equal(f.calls(), 0);
  });
test('backdrop accepts only one matching primary outside gesture', () => {
  const f = fixture();
  f.drag(f.event(true), f.event(true));
  f.handlers.onClick(f.event(true));
  assert.equal(f.calls(), 1);
});
test('retargeted click from child never counts as an outside press', () => {
  const f = fixture();
  f.drag(f.event(false, true), f.event(true));
  assert.equal(f.calls(), 0);
});
test('cancelled or mismatched pointer never dismisses', () => {
  const f = fixture();
  f.handlers.onPointerDown(f.event(true));
  f.handlers.onPointerCancel();
  f.handlers.onClick(f.event(true));
  f.drag(f.event(true), f.event(true, false, { pointerId: 2 }));
  assert.equal(f.calls(), 0);
});
test('secondary pointer and right button never dismiss', () => {
  const f = fixture();
  f.drag(f.event(true, false, { button: 2 }), f.event(true));
  f.drag(f.event(true, false, { isPrimary: false }), f.event(true));
  assert.equal(f.calls(), 0);
});
test('underlying dialog and synthetic click alone never dismiss', () => {
  const f = fixture();
  f.handlers.onClick(f.event(true));
  f.handlers.onPointerDown(f.event(true));
  f.otherTop();
  f.handlers.onPointerUp(f.event(true));
  f.handlers.onClick(f.event(true));
  assert.equal(f.calls(), 0);
});
