// Nested dialogs can unmount in either order when a pending action navigates.
const locks = new WeakMap();

export function lockDialogScroll(body) {
  let lock = locks.get(body);
  if (!lock) {
    lock = { count: 0, overflow: body.style.overflow };
    locks.set(body, lock);
  }
  lock.count += 1;
  body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count -= 1;
    if (lock.count === 0) {
      body.style.overflow = lock.overflow;
      locks.delete(body);
    }
  };
}
