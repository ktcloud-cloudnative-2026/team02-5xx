export function cycleDialogFocus(event, dialog, activeElement) {
  if (event.key !== 'Tab') return;
  const nodes = [
    ...dialog.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ),
  ].filter((node) => node.getClientRects().length);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first) {
    event.preventDefault();
    dialog.focus();
  } else if (
    event.shiftKey &&
    (activeElement === first || !nodes.includes(activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === last || !nodes.includes(activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}

export function openAdminDialog(dialog, document, returnFocusRef) {
  const previous = document.activeElement;
  const overflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  dialog.querySelector('[data-initial-focus]')?.focus();
  return () => {
    dialog.close();
    document.body.style.overflow = overflow;
    const target = returnFocusRef?.current ?? previous;
    if (target?.isConnected && !target.disabled) target.focus();
    else document.querySelector('[data-admin-focus-fallback]')?.focus();
  };
}
