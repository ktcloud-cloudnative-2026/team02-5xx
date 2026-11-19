import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activateDialog,
  containDialogTab,
  cancelTopDialog,
} from '../src/dialogFocus.js';

// DOM test doubles exercise the production handlers, not browser-native focus behavior.
function environment() {
  const document = {
    body: { style: { overflow: 'auto' } },
    defaultView: {
      getComputedStyle: (item) => ({
        visibility: item.visibility ?? 'visible',
      }),
    },
  };
  function target(overrides = {}) {
    return {
      tabIndex: 0,
      isConnected: true,
      matches: () => false,
      closest: () => null,
      getClientRects: () => [1],
      focus() {
        document.activeElement = this;
      },
      ...overrides,
    };
  }
  const card = target();
  card.focus();
  function dialog() {
    const first = target(),
      middle = target(),
      last = target();
    const items = [first, middle, last];
    const element = target({
      ownerDocument: document,
      open: false,
      showModal() {
        this.open = true;
        first.focus();
      },
      close() {
        this.open = false;
      },
      querySelectorAll: () => items,
      contains: (item) => items.includes(item),
    });
    return { element, first, middle, last, items };
  }
  return { document, card, target, dialog };
}
function event(dialog, extra = {}) {
  return {
    currentTarget: dialog.element,
    key: 'Tab',
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...extra,
  };
}

test('top modal wraps last Tab and first Shift+Tab without reaching BODY', () => {
  const env = environment(),
    outer = env.dialog(),
    inner = env.dialog();
  const closeOuter = activateDialog(outer.element),
    closeInner = activateDialog(inner.element);
  const backward = event(inner, { shiftKey: true });
  containDialogTab(backward);
  assert.equal(env.document.activeElement, inner.last);
  const forward = event(inner);
  containDialogTab(forward);
  assert.equal(env.document.activeElement, inner.first);
  assert.ok(forward.defaultPrevented && backward.stopped);
  closeInner();
  closeOuter();
});

test('middle Tab, non-Tab and browser keyboard shortcuts retain native handling', () => {
  const env = environment(),
    dialog = env.dialog();
  const close = activateDialog(dialog.element);
  dialog.middle.focus();
  for (const extra of [
    {},
    { key: 'Escape' },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
  ]) {
    const input = event(dialog, extra);
    containDialogTab(input);
    assert.equal(input.defaultPrevented, false);
    assert.equal(env.document.activeElement, dialog.middle);
  }
  close();
});

test('underlying dialog ignores Tab and Escape; Escape closes only the top modal', () => {
  const env = environment(),
    outer = env.dialog(),
    inner = env.dialog();
  const closeOuter = activateDialog(outer.element);
  outer.last.focus();
  const closeInner = activateDialog(inner.element);
  containDialogTab(event(outer, { shiftKey: true }));
  assert.equal(env.document.activeElement, inner.first);
  let outerClosed = false;
  cancelTopDialog(event(outer), () => {
    outerClosed = true;
  });
  assert.equal(outerClosed, false);
  cancelTopDialog(event(inner), closeInner);
  assert.equal(inner.element.open, false);
  assert.equal(outer.element.open, true);
  assert.equal(env.document.activeElement, outer.last);
  assert.equal(env.document.body.style.overflow, 'hidden');
  containDialogTab(event(outer));
  assert.equal(env.document.activeElement, outer.first);
  cancelTopDialog(event(outer), closeOuter);
  assert.equal(env.document.activeElement, env.card);
  assert.equal(env.document.body.style.overflow, 'auto');
  const reopen = activateDialog(outer.element);
  assert.equal(env.document.activeElement, outer.first);
  reopen();
});

test('focus boundaries skip disabled, hidden, inert and negative tabindex controls', () => {
  const env = environment(),
    dialog = env.dialog();
  dialog.items.push(
    env.target({ matches: () => true }),
    env.target({ getClientRects: () => [] }),
    env.target({ tabIndex: -1 }),
    env.target({ closest: () => ({}) }),
    env.target({ visibility: 'hidden' }),
  );
  const close = activateDialog(dialog.element);
  containDialogTab(event(dialog, { shiftKey: true }));
  assert.equal(env.document.activeElement, dialog.last);
  // Defensive recovery if an external focus change has already moved it out.
  env.document.activeElement = env.document.body;
  containDialogTab(event(dialog));
  assert.equal(env.document.activeElement, dialog.first);
  close();
});

test('failure to open a native dialog releases its scroll lock', () => {
  const env = environment(),
    dialog = env.dialog();
  dialog.element.showModal = () => {
    throw new Error('unavailable');
  };
  assert.throws(() => activateDialog(dialog.element));
  assert.equal(env.document.body.style.overflow, 'auto');
});
