import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleDialogFocus,
  openAdminDialog,
} from '../src/components/admin/adminDialogFocus.js';

function fixture() {
  const node = () => ({
    isConnected: true,
    disabled: false,
    focused: 0,
    focus() {
      this.focused++;
    },
    getClientRects: () => [1],
  });
  const first = node(),
    middle = node(),
    last = node(),
    opener = node(),
    fallback = node();
  const dialog = {
    opened: 0,
    closed: 0,
    focused: 0,
    showModal() {
      this.opened++;
    },
    close() {
      this.closed++;
    },
    focus() {
      this.focused++;
    },
    querySelectorAll: () => [first, middle, last],
    querySelector: () => first,
  };
  const document = {
    activeElement: opener,
    body: { style: { overflow: 'auto' } },
    querySelector: () => fallback,
  };
  return { first, middle, last, opener, fallback, dialog, document };
}
function event(shiftKey = false, key = 'Tab') {
  return {
    key,
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}
test('Tab at the last element wraps to first; Shift+Tab at first wraps to last', () => {
  const f = fixture();
  const forward = event();
  cycleDialogFocus(forward, f.dialog, f.last);
  assert.equal(forward.prevented, true);
  assert.equal(f.first.focused, 1);
  const backward = event(true);
  cycleDialogFocus(backward, f.dialog, f.first);
  assert.equal(backward.prevented, true);
  assert.equal(f.last.focused, 1);
});
test('internal Tab navigation remains native and other keys are not consumed', () => {
  const f = fixture();
  for (const e of [event(), event(true), event(false, 'ArrowDown')]) {
    cycleDialogFocus(e, f.dialog, f.middle);
    assert.equal(e.prevented, false);
  }
});
test('focus outside the dialog is recovered and hidden items are excluded', () => {
  const f = fixture();
  f.first.getClientRects = () => [];
  const e = event();
  cycleDialogFocus(e, f.dialog, {});
  assert.equal(f.middle.focused, 1);
  assert.equal(f.first.focused, 0);
});
test('empty focus list keeps focus on dialog', () => {
  const f = fixture();
  f.dialog.querySelectorAll = () => [];
  const e = event();
  cycleDialogFocus(e, f.dialog, null);
  assert.equal(f.dialog.focused, 1);
  assert.equal(e.prevented, true);
});
test('open/cleanup restores scroll and connected opener', () => {
  const f = fixture();
  const cleanup = openAdminDialog(f.dialog, f.document, { current: f.opener });
  assert.equal(f.dialog.opened, 1);
  assert.equal(f.document.body.style.overflow, 'hidden');
  assert.equal(f.first.focused, 1);
  cleanup();
  assert.equal(f.dialog.closed, 1);
  assert.equal(f.document.body.style.overflow, 'auto');
  assert.equal(f.opener.focused, 1);
});
for (const state of ['removed', 'disabled'])
  test(`cleanup uses fallback when opener is ${state}`, () => {
    const f = fixture();
    if (state === 'removed') f.opener.isConnected = false;
    else f.opener.disabled = true;
    openAdminDialog(f.dialog, f.document, { current: f.opener })();
    assert.equal(f.fallback.focused, 1);
    assert.equal(f.opener.focused, 0);
  });
