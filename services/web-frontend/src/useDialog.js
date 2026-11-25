import { useEffect, useRef } from 'react';
import {
  activateDialog,
  containDialogTab,
  cancelTopDialog,
  isTopDialog,
} from './dialogFocus.js';
import { createDialogBackdrop } from './dialogBackdrop.js';

export default function useDialog(
  onClose,
  active = true,
  { canClose = () => true, deferClose = false } = {},
) {
  const dialogRef = useRef(null);
  const closing = useRef(false);
  const latest = useRef(null);
  latest.current = { onClose, canClose, deferClose };
  function close() {
    const node = dialogRef.current;
    if (
      !node?.open ||
      closing.current ||
      !isTopDialog(node) ||
      !latest.current.canClose()
    )
      return;
    // Checkout first asks for exit confirmation; keep the native dialog open.
    if (!latest.current.deferClose) {
      closing.current = true;
      node.close();
    }
    latest.current.onClose();
  }
  const backdrop = useRef(null);
  if (!backdrop.current)
    backdrop.current = createDialogBackdrop(close, isTopDialog);
  useEffect(() => {
    closing.current = false;
    backdrop.current.reset();
    if (active) return activateDialog(dialogRef.current);
  }, [active]);
  const { reset: _reset, ...backdropEvents } = backdrop.current;
  return {
    ref: dialogRef,
    onKeyDown: containDialogTab,
    onCancel: (event) => cancelTopDialog(event, close),
    ...backdropEvents,
    close,
  };
}
