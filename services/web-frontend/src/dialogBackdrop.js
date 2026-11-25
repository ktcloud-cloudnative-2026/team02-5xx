// Native dialog clicks can target the dialog after a child-to-backdrop drag.
// Require both pointer endpoints outside its border box, on the same top dialog.
export function createDialogBackdrop(onDismiss, isTop) {
  let press = null,
    release = false;
  const outside = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX >= bounds.right ||
        event.clientY < bounds.top ||
        event.clientY >= bounds.bottom)
    );
  };
  const reset = () => {
    press = null;
    release = false;
  };
  return {
    onPointerDown(event) {
      release = false;
      press = {
        id: event.pointerId,
        dialog: event.currentTarget,
        outside:
          event.button === 0 &&
          event.isPrimary !== false &&
          isTop(event.currentTarget) &&
          outside(event),
      };
    },
    onPointerUp(event) {
      release = !!(
        press?.id === event.pointerId &&
        press.dialog === event.currentTarget &&
        press.outside &&
        outside(event)
      );
      press = null;
    },
    onPointerCancel: reset,
    onClick(event) {
      const dismiss = release && isTop(event.currentTarget) && outside(event);
      reset();
      if (dismiss) onDismiss();
    },
    reset,
  };
}
