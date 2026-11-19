import { useEffect, useRef } from 'react';
import {
  activateDialog,
  containDialogTab,
  cancelTopDialog,
} from './dialogFocus.js';

export default function useDialog(onClose) {
  const dialogRef = useRef(null);
  useEffect(() => {
    return activateDialog(dialogRef.current);
  }, []);
  function close() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }
  return {
    ref: dialogRef,
    onKeyDown: containDialogTab,
    onCancel: (event) => cancelTopDialog(event, close),
    onClick: (event) => {
      if (event.target === event.currentTarget) close();
    },
    close,
  };
}
