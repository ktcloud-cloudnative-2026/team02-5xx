import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCategories, getMenu, getMenus } from './data/menuRepository.js';
import MenuDetail from './components/MenuDetail.jsx';
import { formatPrice } from './menu.js';
import {
  addItem,
  browserStorage,
  cartView,
  changeQuantity,
  loadCart,
  removeItem,
  saveCart,
} from './cart.js';
import { canUseCustomerFeatures, planCartIntent } from './session.js';
import { authSession } from './authSession.js';
import CartOverlay from './components/CartOverlay.jsx';
import LoginModal from './components/LoginModal.jsx';

export default function App({
  sessionSource = authSession,
  storageProvider = browserStorage,
}) {
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot ?? sessionSource.getSnapshot,
  );
  const authenticated = session?.authenticated === true;
  const signedIn = canUseCustomerFeatures(session);
  const lastCustomer = useRef(null);
  const cartAccountMismatch =
    signedIn &&
    lastCustomer.current !== null &&
    session.user?.id !== undefined &&
    session.user.id !== lastCustomer.current;
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const previousAuthenticated = useRef(authenticated);
  const [page, setPage] = useState(() =>
    typeof window !== 'undefined' && window.location.hash === '#cart'
      ? 'cart'
      : 'menu',
  );
  const [cart, setCart] = useState(() => loadCart(storageProvider, getMenu));
  const [loginIntent, setLoginIntent] = useState(null);
  const [notice, setNotice] = useState('');
  const intentNumber = useRef(0);
  const handledIntent = useRef(null);
  const lastMenuId = useRef(null);
  const previousPage = useRef(page);
  const previousSignedIn = useRef(signedIn);
  const menuScroll = useRef(0);
  const [categoryId, setCategoryId] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const openerRef = useRef(null);
  const cartOpenerRef = useRef(null);
  const menus = getMenus({ categoryId, query, sort });
  const selectedMenu = selectedId === null ? null : getMenu(selectedId);

  useEffect(() => {
    // The store owns restoration; StrictMode must not cancel or duplicate rotation.
    void sessionSource.restore?.();
  }, [sessionSource]);

  useEffect(() => {
    if (
      signedIn &&
      session.user?.id !== undefined &&
      lastCustomer.current === null
    ) {
      lastCustomer.current = session.user.id;
    }
  }, [signedIn, session?.user?.id]);

  useEffect(() => {
    const onHistory = () => {
      const next = window.location.hash === '#cart' ? 'cart' : 'menu';
      if (next === 'cart' && previousPage.current !== 'cart')
        menuScroll.current = window.scrollY;
      setPage(next);
      if (next === 'cart') setSelectedId(null);
      else setLoginIntent(null);
    };
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    return () => {
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
    };
  }, []);

  useEffect(() => {
    const expired =
      previousAuthenticated.current &&
      !authenticated &&
      session?.reason === 'expired';
    previousAuthenticated.current = authenticated;
    if (cartAccountMismatch && page === 'cart') {
      closeCart();
      setNotice(
        '계정이 변경되어 기존 장바구니를 사용할 수 없어요. 저장된 항목은 보존했습니다.',
      );
    } else if (authenticated && !signedIn && page === 'cart') {
      closeCart();
      setNotice('고객 장바구니와 주문은 CUSTOMER 계정만 이용할 수 있어요.');
    } else if (
      !authenticated &&
      session?.phase !== 'restoring' &&
      session?.phase !== 'authenticating' &&
      !loginIntent &&
      (page === 'cart' || expired)
    ) {
      setLoginIntent({
        type: page === 'cart' ? 'view' : 'login',
        id: ++intentNumber.current,
      });
    }
  }, [
    page,
    authenticated,
    signedIn,
    loginIntent,
    session?.phase,
    session?.reason,
    cartAccountMismatch,
  ]);

  useEffect(() => {
    if (
      authenticated &&
      loginIntent &&
      handledIntent.current !== loginIntent.id
    ) {
      handledIntent.current = loginIntent.id;
      setLoginIntent(null);
      const planned = planCartIntent(session, loginIntent);
      if (planned.forbidden)
        setNotice('고객 장바구니와 주문은 CUSTOMER 계정만 이용할 수 있어요.');
      else executeIntent(planned.action);
    }
  }, [authenticated, signedIn, loginIntent]);

  useEffect(() => {
    const pageChanged = previousPage.current !== page;
    const cartBecameAvailable =
      page === 'cart' && signedIn && !previousSignedIn.current;
    previousPage.current = page;
    previousSignedIn.current = signedIn;
    if (!pageChanged && !cartBecameAvailable) return;
    if (page === 'cart' && signedIn) {
      document.getElementById('cart-title')?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, menuScroll.current);
      const target =
        (cartOpenerRef.current?.isConnected ? cartOpenerRef.current : null) ??
        document.querySelector(`[data-menu-id="${lastMenuId.current}"]`) ??
        document.getElementById('menu-list');
      target?.focus({ preventScroll: true });
    }
  }, [page, signedIn]);

  function navigate(nextPage) {
    if (nextPage === 'cart' && page !== 'cart') {
      menuScroll.current = window.scrollY;
      window.history.pushState(
        { peakOrderPage: nextPage, cartOverlay: true },
        '',
        '#cart',
      );
    }
    setPage(nextPage);
    setSelectedId(null);
  }

  function closeCart() {
    // Update React first: a pending popstate must not reopen anonymous login.
    setPage('menu');
    if (window.history.state?.cartOverlay === true) {
      window.history.back();
    } else {
      // Direct #cart entries must close locally rather than leave the app.
      window.history.replaceState({ peakOrderPage: 'menu' }, '', '#menu-list');
    }
  }

  function requestCart(event) {
    cartOpenerRef.current = event.currentTarget;
    requestIntent({ type: 'view' });
  }

  function persist(items) {
    const warning = saveCart(items, storageProvider, getMenu);
    setCart({ items, warning });
  }

  function executeIntent(intent) {
    if (!signedIn) return;
    if (cartAccountMismatch) {
      setNotice(
        '계정이 변경되어 기존 장바구니를 사용할 수 없어요. 저장된 항목은 보존했습니다. 계정별 처리 정책 확인이 필요합니다.',
      );
      return;
    }
    if (intent.type === 'login') {
      setNotice('로그인했어요.');
      return;
    }
    if (intent.type === 'view') {
      navigate('cart');
      return;
    }
    if (intent.type === 'order') {
      setNotice(
        '주문·결제 연결을 준비 중이에요. 현재 주문은 생성되지 않습니다.',
      );
      return;
    }
    try {
      const result = addItem(cart.items, intent.selection, getMenu);
      persist(result.items);
      setNotice(
        result.limited
          ? '동일한 메뉴와 옵션은 합쳐서 최대 99개까지 담을 수 있어요.'
          : '장바구니에 담았어요.',
      );
    } catch (failure) {
      setNotice(failure.message);
    }
  }

  function requestIntent(intent) {
    setNotice('');
    const planned = planCartIntent(session, intent);
    if (planned.forbidden) {
      setNotice('고객 장바구니와 주문은 CUSTOMER 계정만 이용할 수 있어요.');
    } else if (planned.pending) {
      setLoginIntent({ ...planned.pending, id: ++intentNumber.current });
    } else {
      executeIntent(planned.action);
    }
  }

  function closeLogin() {
    setLoginIntent(null);
    if (page === 'cart' && !signedIn) {
      closeCart();
    }
  }

  function updateCart(key, quantity) {
    if (!signedIn) return requestIntent({ type: 'view' });
    if (cartAccountMismatch) return;
    try {
      persist(changeQuantity(cart.items, key, quantity, getMenu));
      setNotice('수량을 변경했어요.');
    } catch (failure) {
      setNotice(failure.message);
    }
  }

  function deleteCartItem(key) {
    if (!signedIn) return requestIntent({ type: 'view' });
    if (cartAccountMismatch) return;
    persist(removeItem(cart.items, key, getMenu));
    setNotice('장바구니에서 삭제했어요.');
    requestAnimationFrame(() => document.getElementById('cart-title')?.focus());
  }

  let view;
  try {
    view = cartView(cart.items, getMenu);
  } catch {
    view = { rows: [], total: 0 };
  }

  function openMenu(id, event) {
    const menu = getMenu(id);
    if (!menu || menu.status !== 'ON_SALE') {
      setError('선택할 수 없는 메뉴입니다. 다른 메뉴를 선택해 주세요.');
      return;
    }
    openerRef.current = event.currentTarget;
    lastMenuId.current = id;
    setError('');
    setNotice('');
    setSelectedId(id);
  }

  function closeMenu() {
    setSelectedId(null);
    openerRef.current?.focus();
  }

  async function signOut() {
    if (authBusy || !sessionSource.logout) return;
    setAuthBusy(true);
    setLoginIntent(null);
    if (page === 'cart') closeCart();
    try {
      await sessionSource.logout();
      setLogoutFailed(false);
      setNotice('로그아웃했어요. 장바구니 항목은 이 브라우저에 보존했습니다.');
    } catch {
      setLogoutFailed(true);
      setNotice(
        '화면의 세션은 종료했지만 서버 로그아웃을 확인하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#menu-list">
        메뉴 목록으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="피크오더">
        <div className="brand" aria-label="피크오더">
          로고
        </div>
        <nav aria-label="고객 메뉴">
          <a
            className={`nav-item ${page !== 'cart' || !signedIn ? 'active' : ''}`}
            href="#menu-list"
            aria-current={page !== 'cart' || !signedIn ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
            </svg>
            메뉴
          </a>
          <button
            className={`nav-item cart-nav ${page === 'cart' && signedIn ? 'active' : ''}`}
            aria-current={page === 'cart' && signedIn ? 'page' : undefined}
            onClick={requestCart}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 4h2l3 12h11l2-8H6M10 20h.01M18 20h.01" />
            </svg>
            장바구니
            {signedIn && cart.items.length > 0 ? ` (${cart.items.length})` : ''}
          </button>
        </nav>
      </aside>
      <main className="menu-page">
        {(page !== 'cart' || !signedIn || cartAccountMismatch) && (
          <p className="action-notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}
        <>
          <header className="page-heading">
            <h1>
              <strong>메뉴</strong> 카테고리
            </h1>
            <div className="header-actions">
              {authenticated && (
                <span className="session-user" aria-label="로그인 사용자">
                  {session.user?.nickname || session.user?.email || '로그인됨'}
                </span>
              )}
              {authenticated ? (
                <button
                  className="text-button"
                  onClick={signOut}
                  disabled={authBusy}
                >
                  로그아웃
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={authBusy || session?.phase === 'restoring'}
                  onClick={() => requestIntent({ type: 'login' })}
                >
                  {session?.phase === 'restoring' ? '세션 확인 중' : '로그인'}
                </button>
              )}
              {logoutFailed && (
                <button
                  className="text-button"
                  disabled={authBusy}
                  onClick={signOut}
                >
                  로그아웃 다시 시도
                </button>
              )}
              <label className="search-field">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
                <span className="sr-only">메뉴 검색</span>
                <input
                  type="search"
                  placeholder="메뉴를 검색해 보세요"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="pill-button header-cart"
                onClick={requestCart}
                aria-haspopup="dialog"
              >
                장바구니
                {signedIn && cart.items.length > 0
                  ? ` (${cart.items.length})`
                  : ''}
              </button>
            </div>
          </header>
          <div className="categories" role="group" aria-label="메뉴 카테고리">
            {[{ id: 'all', name: '전체' }, ...getCategories()].map(
              (category) => (
                <button
                  key={category.id}
                  className={`category ${categoryId === category.id ? 'selected' : ''}`}
                  aria-pressed={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  <span className="category-image" aria-hidden="true" />
                  {category.name}
                </button>
              ),
            )}
          </div>
          <section id="menu-list" aria-labelledby="list-title" tabIndex="-1">
            <div className="list-heading">
              <h2 id="list-title">
                <strong>메뉴</strong> 고르기
              </h2>
              <label className="sort-field">
                정렬
                <select
                  aria-label="메뉴 정렬"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="default">기본순</option>
                  <option value="priceAsc">낮은 가격순</option>
                  <option value="priceDesc">높은 가격순</option>
                </select>
              </label>
            </div>
            <p className="sr-only" role="status">
              메뉴 {menus.length}개
            </p>
            {error && <p role="alert">{error}</p>}
            {menus.length ? (
              <div className="menu-grid">
                {menus.map((menu) => (
                  <button
                    key={menu.id}
                    data-menu-id={menu.id}
                    className="menu-card"
                    disabled={menu.status !== 'ON_SALE'}
                    onClick={(event) => openMenu(menu.id, event)}
                    aria-label={`${menu.name}, ${formatPrice(menu.basePrice)}${menu.status === 'PAUSED' ? ', 판매 중지' : ', 상세 보기'}`}
                  >
                    <span className="menu-photo" aria-hidden="true">
                      메뉴 사진
                    </span>
                    <span className="menu-name">{menu.name}</span>
                    <span className="menu-price">
                      {formatPrice(menu.basePrice)}
                    </span>
                    {menu.status === 'PAUSED' && (
                      <span className="status-badge">판매 중지</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state" role="status">
                <h3>
                  {query.trim() ? '검색 결과가 없어요' : '등록된 메뉴가 없어요'}
                </h3>
                <p>다른 카테고리나 검색어로 메뉴를 찾아보세요.</p>
                <button
                  className="pill-button"
                  onClick={() => {
                    setCategoryId('all');
                    setQuery('');
                  }}
                >
                  전체 메뉴 보기
                </button>
              </div>
            )}
          </section>
        </>
      </main>
      {page === 'cart' && signedIn && !cartAccountMismatch && (
        <CartOverlay
          rows={view.rows}
          total={view.total}
          warning={cart.warning}
          notice={notice}
          onQuantity={updateCart}
          onRemove={deleteCartItem}
          onClose={closeCart}
          onOrder={() => requestIntent({ type: 'order' })}
        />
      )}
      {selectedId !== null && (
        <MenuDetail
          key={selectedId}
          menu={selectedMenu}
          onClose={closeMenu}
          feedback={[notice, signedIn ? cart.warning : '']
            .filter(Boolean)
            .join(' ')}
          onAdd={(selection) => requestIntent({ type: 'add', selection })}
          onOrder={(selection) => requestIntent({ type: 'order', selection })}
          onViewCart={requestCart}
        />
      )}
      {loginIntent && !authenticated && (
        <LoginModal
          onClose={closeLogin}
          onLogin={sessionSource.login}
          waiting={session?.phase === 'restoring' || authBusy}
        />
      )}
    </div>
  );
}
