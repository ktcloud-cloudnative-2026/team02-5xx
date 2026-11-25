import { useMemo, useSyncExternalStore } from 'react';
import { authSession } from '../authSession.js';
import AdminLayout from './AdminLayout.jsx';
import { adminAccess, adminRequest } from './adminRoute.js';
import AdminDashboard from '../admin-dashboard/AdminDashboard.jsx';
import AdminMenuPage from '../components/admin/AdminMenuPage.jsx';
import AdminOrdersPage from '../admin-orders/AdminOrdersPage.jsx';
import AdminInventoryPage from '../admin-inventory/AdminInventoryPage.jsx';
import CookingPage from '../admin-cooking/CookingPage.jsx';
import { createDashboardApi } from '../admin-dashboard/dashboardApi.js';
import { createAdminMenuApi } from '../data/admin/adminMenuApi.js';
import { createAdminOrderApi } from '../admin-orders/adminOrderApi.js';
import { createInventoryAdminApi } from '../admin-inventory/inventoryAdminApi.js';
import { createCookingApi } from '../admin-cooking/cookingApi.js';
import { createMenuApi } from '../data/menuApi.js';

function ProtectedPage({ route, sessionSource }) {
  const apis = useMemo(() => {
    const request = adminRequest(sessionSource);
    return {
      dashboard: createDashboardApi({ request }),
      menus: createAdminMenuApi({ request }),
      orders: createAdminOrderApi({ request }),
      inventory: createInventoryAdminApi({ request }),
      cooking: createCookingApi({ request }),
      directory: createMenuApi({ fetchImpl: request }),
    };
  }, [sessionSource]);
  switch (route.id) {
    case 'dashboard':
      return (
        <AdminDashboard
          embedded
          api={apis.dashboard}
          navigation={{
            menu: { href: '#admin/menus' },
            cooking: { href: '#admin/cooking' },
            inventory: { href: '#admin/inventory' },
            orders: { href: '#admin/orders' },
          }}
        />
      );
    case 'menus':
      return <AdminMenuPage embedded adapter={apis.menus} />;
    case 'orders':
      return <AdminOrdersPage embedded api={apis.orders} />;
    case 'inventory':
      return (
        <AdminInventoryPage
          embedded
          api={apis.inventory}
          menuApi={apis.directory}
        />
      );
    case 'cooking':
      return <CookingPage embedded api={apis.cooking} />;
    default:
      return (
        <section className="admin-message">
          <h1>페이지를 찾을 수 없어요</h1>
          <p>관리자 메뉴에서 원하는 화면을 선택해 주세요.</p>
          <a href="#admin">대시보드로 이동</a>
        </section>
      );
  }
}

export default function AdminApp({ route, sessionSource = authSession }) {
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot,
  );
  if (adminAccess(session, true) !== 'allowed')
    return <p role="status">접근 권한을 확인하고 있어요</p>;
  return (
    <AdminLayout
      route={route}
      session={session}
      onLogout={() => sessionSource.logout()}
    >
      <ProtectedPage
        key={`${session.user.id}:${route.id}`}
        route={route}
        sessionSource={sessionSource}
      />
    </AdminLayout>
  );
}
