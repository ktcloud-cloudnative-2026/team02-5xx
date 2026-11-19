import { useEffect, useRef } from 'react';
import { cycleDialogFocus, openAdminDialog } from './adminDialogFocus.js';

export default function AdminDialog({
  title,
  onClose,
  children,
  busy = false,
  returnFocusRef,
}) {
  const ref = useRef(null);
  useEffect(() => {
    return openAdminDialog(ref.current, document, returnFocusRef);
  }, [returnFocusRef]);
  return (
    <dialog
      ref={ref}
      className="am-dialog"
      aria-labelledby="am-dialog-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        cycleDialogFocus(event, ref.current, document.activeElement);
      }}
    >
      <div className="am-dialog-heading">
        <div>
          <span className="am-eyebrow">메뉴 관리 · Mock</span>
          <h2 id="am-dialog-title">{title}</h2>
        </div>
        <button
          className="am-icon-button"
          type="button"
          aria-label={`${title} 닫기`}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
