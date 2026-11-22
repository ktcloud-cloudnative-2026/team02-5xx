// Explicitly injected anonymous source remains available to tests and isolated previews.
export const anonymousSession = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => null,
  getServerSnapshot: () => null,
});

export function canUseCustomerFeatures(session) {
  return (
    session?.authenticated === true &&
    (session.user?.role ?? session.role) === 'CUSTOMER'
  );
}

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
  if (canUseCustomerFeatures(session)) return { action, pending: null };
  if (session?.authenticated === true)
    return { action: null, pending: null, forbidden: true };
  return { action: null, pending: action };
}
