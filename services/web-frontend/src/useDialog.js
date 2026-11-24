import { useEffect, useRef } from 'react';
import {
  activateDialog,
  containDialogTab,
  cancelTopDialog,
} from './dialogFocus.js';

export default function useDialog(onClose, active = true) {
  const dialogRef = useRef(null);
  const backdropPress = useRef(null);
  const backdropRelease = useRef(false);
  function isBackdrop(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX >= bounds.right ||
        event.clientY < bounds.top ||
        event.clientY >= bounds.bottom)
    );
  }
  useEffect(() => {
    if (active) return activateDialog(dialogRef.current);
  }, [active]);
  function close() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }
  return {
    ref: dialogRef,
    onKeyDown: containDialogTab,
    onCancel: (event) => cancelTopDialog(event, close),
    onPointerDown: (event) => {
      backdropPress.current = {
        id: event.pointerId,
        outside: event.button === 0 && isBackdrop(event),
      };
      backdropRelease.current = false;
    },
    onPointerUp: (event) => {
      backdropRelease.current =
        backdropPress.current?.id === event.pointerId &&
        backdropPress.current.outside &&
        isBackdrop(event);
      backdropPress.current = null;
    },
    onPointerCancel: () => {
      backdropPress.current = null;
      backdropRelease.current = false;
    },
    onClick: (event) => {
      const dismiss = backdropRelease.current && isBackdrop(event);
      backdropRelease.current = false;
      if (dismiss) close();
    },
    close,
  };
}
