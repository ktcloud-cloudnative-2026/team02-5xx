export const ADMIN_ROUTES = Object.freeze([
  { id: 'dashboard', href: '#admin', label: '대시보드' },
  { id: 'menus', href: '#admin/menus', label: '메뉴 관리' },
  { id: 'orders', href: '#admin/orders', label: '주문 관리' },
  { id: 'inventory', href: '#admin/inventory', label: '재고 관리' },
  { id: 'cooking', href: '#admin/cooking', label: '주문·조리 현황' },
]);

export function parseAdminLocation(hash = '') {
  const path = hash.split('?')[0];
  if (path !== '#admin' && !path.startsWith('#admin/')) return null;
  const route = ADMIN_ROUTES.find((item) => item.href === path);
  return (
    route ?? { id: 'not-found', href: path, label: '페이지를 찾을 수 없어요' }
  );
}

export function adminAccess(session, restored) {
  if (!restored || session.phase === 'restoring') return 'restoring';
  if (!session.authenticated) return 'anonymous';
  return session.role === 'STORE_ADMIN' && session.user?.role === 'STORE_ADMIN'
    ? 'allowed'
    : 'forbidden';
}

/** Uses the existing session's GET-only recovery. Never creates identity headers. */
export function adminRequest(session) {
  const owner = session.getSnapshot().user?.id;
  const allowed = () => {
    const current = session.getSnapshot();
    return (
      adminAccess(current, true) === 'allowed' && current.user.id === owner
    );
  };
  return async (path, options = {}) => {
    if (!allowed())
      throw new DOMException('관리자 인증을 확인해 주세요.', 'AbortError');
    const result = await session.request(path, {
      ...options,
      retryOn401: ['GET', 'HEAD'].includes(
        (options.method ?? 'GET').toUpperCase(),
      ),
    });
    if (!allowed())
      throw new DOMException('이전 사용자 응답입니다.', 'AbortError');
    return result;
  };
}
