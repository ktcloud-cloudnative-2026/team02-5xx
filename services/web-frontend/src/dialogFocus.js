import { lockDialogScroll } from './dialogScroll.js';

const stacks = new WeakMap();

export function activateDialog(dialog) {
  const document = dialog.ownerDocument;
  const previousFocus = document.activeElement;
  const unlockScroll = lockDialogScroll(document.body);
  try {
    dialog.showModal();
  } catch (failure) {
    unlockScroll();
    throw failure;
  }
  const unregister = registerDialog(dialog);
  return () => {
    if (dialog.open) dialog.close();
    unregister();
    unlockScroll();
    if (previousFocus?.isConnected)
      previousFocus.focus({ preventScroll: true });
  };
}

export function registerDialog(dialog) {
  const document = dialog.ownerDocument;
  const stack = stacks.get(document) ?? [];
  stacks.set(document, stack);
  stack.push(dialog);
  return () => {
    const index = stack.indexOf(dialog);
    if (index !== -1) stack.splice(index, 1);
    if (!stack.length) stacks.delete(document);
  };
}

export function isTopDialog(dialog) {
  return (
    stacks.get(dialog.ownerDocument)?.findLast((item) => item.open) === dialog
  );
}

// Leave navigation inside the dialog to the browser; wrap only its Tab edges.
export function containDialogTab(event) {
  const dialog = event.currentTarget;
  if (
    event.key !== 'Tab' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.defaultPrevented ||
    !isTopDialog(dialog)
  )
    return;
  const targets = [
    ...dialog.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    ),
  ].filter(
    (item) =>
      item.tabIndex >= 0 &&
      !item.matches(':disabled') &&
      !item.closest('[inert]') &&
      item.getClientRects().length > 0 &&
      dialog.ownerDocument.defaultView.getComputedStyle(item).visibility !==
        'hidden',
  );
  const first = targets[0];
  const last = targets.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (
    !first ||
    !dialog.contains(active) ||
    active === dialog ||
    (event.shiftKey ? active === first : active === last)
  ) {
    event.preventDefault();
    event.stopPropagation();
    (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    if (!first) dialog.focus({ preventScroll: true });
  }
}

export function cancelTopDialog(event, close) {
  event.preventDefault();
  event.stopPropagation();
  if (isTopDialog(event.currentTarget)) close();
}
