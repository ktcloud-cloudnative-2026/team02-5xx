import { parseAdminLocation } from './admin/adminRoute.js';

export function sessionIdentity(session) {
  return session?.authenticated === true
    ? JSON.stringify([session.user?.id, session.user?.role, session.role])
    : null;
}

/** Only a verified AuthSession snapshot decides which application may mount. */
export function applicationRoute(
  session,
  hash,
  { restored, sessionEnded = false } = {},
) {
  if (!restored || session?.phase === 'restoring')
    return { screen: 'restoring' };
  const admin = parseAdminLocation(hash);
  if (session?.authenticated !== true) {
    return {
      screen: 'customer',
      redirect: sessionEnded || admin || !hash || hash === '#' ? '#home' : null,
    };
  }
  const role = session.user?.role;
  if (
    !Number.isSafeInteger(session.user?.id) ||
    session.user.id <= 0 ||
    session.role !== role ||
    !['CUSTOMER', 'STORE_ADMIN'].includes(role)
  )
    return { screen: 'unsupported' };
  if (role === 'STORE_ADMIN')
    return { screen: 'admin', route: admin, redirect: admin ? null : '#admin' };
  return {
    screen: 'customer',
    redirect: admin || !hash || hash === '#' ? '#home' : null,
  };
}

export function replaceApplicationRoute(hash) {
  if (window.location.hash === hash) return;
  window.history.replaceState(null, '', hash);
  window.dispatchEvent(new Event('peak-order-route'));
}
