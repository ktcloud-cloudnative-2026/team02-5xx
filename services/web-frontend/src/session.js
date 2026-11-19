// Auth integration boundary. No cookie/header/storage/query parameter grants a session here.
// A future Auth integration must publish stable snapshots and notify subscribers.
export const anonymousSession = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => null,
  getServerSnapshot: () => null,
});

// Preserve only the UI action and selection; never a token or credential.
export function planCartIntent(session, intent) {
  const action = {
    type: intent.type,
    ...(intent.selection
      ? {
          selection: {
            menuId: intent.selection.menuId,
            optionIds: [...intent.selection.optionIds],
            quantity: intent.selection.quantity,
          },
        }
      : {}),
  };
  return session?.authenticated === true
    ? { action, pending: null }
    : { action: null, pending: action };
}
