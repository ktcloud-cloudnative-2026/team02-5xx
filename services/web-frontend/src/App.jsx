import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { menuApi as defaultMenuApi } from './data/menuApi.js';
import { inventoryApi as defaultInventoryApi } from './data/inventoryApi.js';
import {
  stockStatus,
  cartStock,
  createStockGate,
} from './stockAvailability.js';
import RemoteMenuDetail from './components/RemoteMenuDetail.jsx';
import MenuPhoto from './components/MenuPhoto.jsx';
import CategoryIcon from './components/CategoryIcon.jsx';
import { readPendingCart, validateCartCatalog } from './cartCatalog.js';
import { useMenuRequest } from './useMenuRequests.js';
import { formatPrice } from './menu.js';
import {
  addItem,
  browserStorage,
  cartView,
  changeQuantity,
  removeItem,
  saveCart,
} from './cart.js';
import { canUseCustomerFeatures, planCartIntent } from './session.js';
import { authSession } from './authSession.js';
import CartOverlay from './components/CartOverlay.jsx';
import LoginModal from './components/LoginModal.jsx';
import CheckoutPage from './components/CheckoutPage.jsx';
import OrderHistoryPage from './orders/OrderHistoryPage.jsx';
import AccountPage from './account/AccountPage.jsx';
import { useAccountRoute } from './account/accountRoute.js';
import {
  useLocationHash,
  parseOrdersRoute,
  ordersHref,
} from './orders/ordersRoute.js';
import CustomerHome from './home/CustomerHome.jsx';
import {
  createCheckoutFlow,
  customerKey,
  prepareCheckout,
} from './checkout/checkoutFlow.js';
import { createCheckoutHttpAdapter } from './checkout/checkoutHttpAdapter.js';
import {
  captureCartStorage,
  completePaidCart,
} from './checkout/checkoutCompletion.js';

export default function App({
  sessionSource = authSession,
  storageProvider = browserStorage,
  menuApi = defaultMenuApi,
  inventoryApi = defaultInventoryApi,
  checkoutAdapter,
  registrationApi,
  registrationTerms,
  congestionApi,
}) {
  const hash = useLocationHash();
  const ordersRoute = parseOrdersRoute(hash);
  const accountRoute = useAccountRoute();
  const home = ['', '#', '#home'].includes(hash);
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot ?? sessionSource.getSnapshot,
  );
  const authenticated = session?.authenticated === true;
  const signedIn = canUseCustomerFeatures(session);
  const [authBusy, setAuthBusy] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const previousAuthenticated = useRef(authenticated);
  const [page, setPage] = useState(() =>
    typeof window !== 'undefined' && window.location.hash === '#cart'
      ? 'cart'
      : 'menu',
  );
  const [cart, setCart] = useState(() => readPendingCart(storageProvider));
  const cartRef = useRef(cart);
  const [loginIntent, setLoginIntent] = useState(null);
  const pendingIntent = useRef(null);
  const cartOpen = useRef(page === 'cart');
  const [cartFeedback, setCartFeedback] = useState('');
  const [detailFeedback, setDetailFeedback] = useState('');
  const [checkout, setCheckout] = useState(null);
  const checkoutRef = useRef(null);
  const defaultAdapter = useMemo(
    () => createCheckoutHttpAdapter({ sessionSource }),
    [sessionSource],
  );
  const intentNumber = useRef(0);
  const handledIntent = useRef(null);
  const lastMenuId = useRef(null);
  const previousPage = useRef(page);
  const menuScroll = useRef(0);
  const section = home
    ? 'home'
    : ordersRoute
      ? 'orders'
      : accountRoute
        ? 'account'
        : 'menu';
  const sectionRef = useRef(section);
  const sectionScroll = useRef({ home: 0, menu: 0, orders: 0, account: 0 });
  useEffect(() => {
    const rememberScroll = () => {
      if (!cartOpen.current && !checkoutRef.current)
        sectionScroll.current[sectionRef.current] = window.scrollY;
    };
    window.addEventListener('scroll', rememberScroll, { passive: true });
    return () => window.removeEventListener('scroll', rememberScroll);
  }, []);
  useEffect(() => {
    if (sectionRef.current === section) return;
    sectionRef.current = section;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, sectionScroll.current[section]);
      if (!document.querySelector('dialog[open]'))
        document
          .getElementById(
            {
              home: 'home-heading',
              menu: 'menu-list',
              orders: 'orders-heading',
              account: 'account-heading',
            }[section],
          )
          ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);
  const [categoryId, setCategoryId] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [selectedId, setSelectedId] = useState(null);
  const openerRef = useRef(null);
  const cartOpenerRef = useRef(null);
  const cartReturnHash = useRef('#menu-list');
  const cartDetail = useRef(null);
  const cartReturnFocus = useRef(null);
  const cartAddResult = useRef(null);
  const cartFromHome = useRef(false);
  const restoreCartFocus = useRef(false);
  useEffect(() => {
    if (hash === '#cart' || !restoreCartFocus.current) return;
    // Fragment navigation can move focus after the native dialog closes.
    const frame = requestAnimationFrame(() => {
      restoreCartFocus.current = false;
      const opener = cartOpenerRef.current;
      const target =
        opener?.isConnected && opener.getClientRects().length
          ? opener
          : document.getElementById(
              home
                ? 'home-heading'
                : ordersRoute
                  ? 'orders-heading'
                  : accountRoute
                    ? 'account-heading'
                    : 'menu-list',
            );
      window.scrollTo(0, menuScroll.current);
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, page, home, Boolean(ordersRoute), accountRoute]);
  const listKey = JSON.stringify([categoryId, query, sort]);
  const listing = useMenuRequest(
    listKey,
    (signal) => menuApi.list({ categoryId, query, sort }, { signal }),
    [menuApi, categoryId, query, sort],
  );
  const menus = listing.data?.menus ?? [];
  const stockIds = [
    ...new Set([
      ...menus.map((menu) => menu.id),
      ...cart.items.map((item) => item.menuId),
      ...(selectedId === null ? [] : [selectedId]),
    ]),
  ].sort((a, b) => a - b);
  const stockKey = JSON.stringify([listKey, stockIds, selectedId, page]);
  const stock = useMenuRequest(
    stockKey,
    (signal) => inventoryApi.availability(stockIds, { signal }),
    [inventoryApi, stockKey],
  );
  const stockGate = useMemo(
    () => createStockGate(inventoryApi),
    [inventoryApi],
  );
  const stockFlight = useRef(null);
  const [stockChecking, setStockChecking] = useState(false);
  function cancelStockCheck() {
    stockGate.cancel();
    stockFlight.current = null;
    setStockChecking(false);
  }
  useEffect(() => {
    cancelStockCheck();
    return () => {
      stockGate.cancel();
      stockFlight.current = null;
    };
  }, [stockGate, selectedId, page, authenticated, session?.user?.id]);
  const categories = useRef([]);
  if (listing.data) categories.current = listing.data.categories;
  const details = useRef(new Map());
  const [, detailChanged] = useState(0);
  const onDetailLoaded = useCallback((menu) => {
    details.current.set(menu.id, { menu, checkedAt: performance.now() });
    detailChanged((value) => value + 1);
  }, []);
  const pendingMenuId = loginIntent?.selection?.menuId ?? null;
  const catalogKey = useMemo(
    () => ({ items: cart.items, pendingMenuId }),
    [cart.items, pendingMenuId],
  );
  const catalog = useMenuRequest(
    catalogKey,
    async (signal) => {
      const result = await validateCartCatalog(cart.items, menuApi, {
        signal,
        allowPaused: true,
      });
      // A retry may clear the detail cache. Validate the waiting selection too,
      // without inserting it into the cart before the pending action executes.
      if (pendingMenuId !== null && !result.menus.has(pendingMenuId))
        result.menus.set(
          pendingMenuId,
          await menuApi.detail(pendingMenuId, { signal }),
        );
      return { ...result, checkedAt: performance.now() };
    },
    [cart.items, pendingMenuId, menuApi],
  );
  const getMenu = (id) => {
    const detail = details.current.get(id);
    if (
      catalog.data?.menus.has(id) &&
      (!detail || catalog.data.checkedAt >= detail.checkedAt)
    )
      return catalog.data.getMenu(id);
    return detail?.menu ?? null;
  };
  const validatedItems = catalog.data?.items ?? [];
  let view = null;
  let cartFailure = catalog.error?.message ?? '';
  if (catalog.data) {
    try {
      view = cartView(validatedItems, getMenu, { allowPaused: true });
    } catch {
      cartFailure = '메뉴 정보가 변경됐어요. 장바구니를 다시 확인해 주세요.';
    }
  }
  const cartReady = Boolean(view) && !catalog.loading && !cartFailure;
  const cartAvailability = cartStock(validatedItems, getMenu, stock);

  useEffect(() => {
    // The store owns restoration; StrictMode must not cancel or duplicate rotation.
    void sessionSource.restore?.();
  }, [sessionSource]);

  useEffect(() => {
    let previous = sessionSource.getSnapshot();
    const identity = (value) =>
      value?.authenticated === true
        ? JSON.stringify([
            value.user?.id ?? null,
            value.user?.role ?? value.role,
          ])
        : null;
    return sessionSource.subscribe(() => {
      const next = sessionSource.getSnapshot();
      if (identity(previous) !== identity(next)) cancelStockCheck();
      if (
        previous?.authenticated === true &&
        identity(previous) !== identity(next)
      ) {
        pendingIntent.current = null;
        setLoginIntent(null);
        clearActionFeedback();
      }
      previous = next;
    });
  }, [sessionSource]);

  useEffect(() => {
    const onHistory = () => {
      cancelStockCheck();
      clearActionFeedback();
      const detailId = window.history.state?.peakOrderCartDetail;
      if (Number.isSafeInteger(detailId) && detailId > 0) {
        cartDetail.current = detailId;
        cartOpen.current = false;
        setPage('menu');
        setSelectedId(detailId);
        return;
      }
      const returningFromCartDetail = cartDetail.current !== null;
      if (cartDetail.current !== null) {
        cartReturnFocus.current = cartDetail.current;
        cartDetail.current = null;
        setSelectedId(null);
      }
      if (/^#(orders|account)/.test(window.location.hash)) setSelectedId(null);
      if (window.location.hash === '#checkout' && checkoutRef.current) return;
      const completed =
        checkoutRef.current?.flow.getSnapshot().stage === 'paid';
      if (completed || window.location.hash === '#checkout') {
        window.history.replaceState(
          { peakOrderPage: 'menu' },
          '',
          '#menu-list',
        );
        setSelectedId(null);
      }
      if (checkoutRef.current) {
        checkoutRef.current.flow.dispose();
        checkoutRef.current = null;
        setCheckout(null);
      }
      const next = window.location.hash === '#cart' ? 'cart' : 'menu';
      if (
        next === 'cart' &&
        previousPage.current !== 'cart' &&
        !returningFromCartDetail &&
        !cartAddResult.current
      )
        menuScroll.current = window.scrollY;
      if (next !== 'cart' && previousPage.current === 'cart')
        restoreCartFocus.current = true;
      cartOpen.current = next === 'cart';
      setPage(next);
      const added = cartAddResult.current;
      cartAddResult.current = null;
      if (next === 'cart' && added) {
        requestAnimationFrame(() => {
          if (
            window.location.hash === '#cart' &&
            cartOpen.current &&
            cartRef.current === added.cart
          )
            setCartFeedback((current) => current || added.feedback);
        });
      }
      if (next !== 'cart') {
        pendingIntent.current = null;
        setLoginIntent(null);
      }
    };
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    if (window.location.hash === '#checkout') onHistory();
    return () => {
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
    };
  }, []);

  useEffect(() => {
    const wasAuthenticated = previousAuthenticated.current;
    previousAuthenticated.current = authenticated;
    if (!wasAuthenticated && authenticated) setLogoutFailed(false);
    if (wasAuthenticated && !authenticated) {
      clearActionFeedback();
      pendingIntent.current = null;
      setLoginIntent(null);
    }
    if (checkoutRef.current) {
      pendingIntent.current = null;
      setLoginIntent(null);
    }
  }, [authenticated, checkout]);

  useEffect(() => {
    if (
      !loginIntent ||
      pendingIntent.current !== loginIntent ||
      handledIntent.current === loginIntent.id
    )
      return;
    const planned = planCartIntent(session, loginIntent);
    if (planned.pending) return;
    if (
      !planned.forbidden &&
      ['add', 'order'].includes(loginIntent.type) &&
      !cartReady
    )
      return;
    handledIntent.current = loginIntent.id;
    pendingIntent.current = null;
    setLoginIntent(null);
    if (planned.forbidden) {
      if (loginIntent.type === 'order')
        reportAction('주문하려면 고객용 계정으로 로그인해 주세요.');
    } else executeIntent(planned.action);
  }, [
    authenticated,
    signedIn,
    loginIntent,
    cartReady,
    session?.user?.id,
    session?.user?.role,
  ]);

  useEffect(() => {
    const pageChanged = previousPage.current !== page;
    previousPage.current = page;
    if (!pageChanged) return;
    if (page === 'cart') {
      document.getElementById('cart-title')?.focus({ preventScroll: true });
      if (cartReturnFocus.current !== null) {
        const id = cartReturnFocus.current;
        cartReturnFocus.current = null;
        requestAnimationFrame(() =>
          document
            .querySelector(`[data-cart-menu-id="${id}"]`)
            ?.focus({ preventScroll: true }),
        );
      }
    } else {
      window.scrollTo(0, menuScroll.current);
      const target =
        (cartOpenerRef.current?.isConnected ? cartOpenerRef.current : null) ??
        document.querySelector(`[data-menu-id="${lastMenuId.current}"]`) ??
        document.getElementById('menu-list');
      target?.focus({ preventScroll: true });
    }
  }, [page]);

  function navigate(nextPage) {
    if (nextPage === 'cart' && page !== 'cart') {
      cartReturnHash.current = window.location.hash || '#home';
      cartFromHome.current = ['', '#', '#home'].includes(window.location.hash);
      if (selectedId === null) menuScroll.current = window.scrollY;
      window.history.pushState(
        { peakOrderPage: nextPage, cartOverlay: true },
        '',
        '#cart',
      );
    }
    cartOpen.current = nextPage === 'cart';
    setPage(nextPage);
    window.dispatchEvent(new Event('peak-order-route'));
  }

  function closeCart() {
    cancelStockCheck();
    clearActionFeedback();
    restoreCartFocus.current = true;
    // Update React first: a pending popstate must not reopen anonymous login.
    pendingIntent.current = null;
    setLoginIntent(null);
    cartOpen.current = false;
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

  function clearActionFeedback() {
    setCartFeedback('');
    setDetailFeedback('');
  }

  function reportAction(message) {
    if (cartOpen.current) setCartFeedback(message);
    else if (selectedId !== null) setDetailFeedback(message);
  }

  function persist(items) {
    const warning = saveCart(items, storageProvider, getMenu, {
      allowPaused: true,
    });
    const next = { items, warning };
    cartRef.current = next;
    setCart(next);
  }

  async function executeIntent(intent) {
    if (intent.type === 'order' && !signedIn) return;
    if (intent.type === 'login') return;
    if (intent.type === 'view') {
      catalog.retry();
      navigate('cart');
      return;
    }
    if (!cartReady) {
      reportAction('장바구니 메뉴 정보를 먼저 확인해 주세요.');
      return;
    }
    if (intent.type === 'order') {
      if (checkoutRef.current || stockFlight.current) return;
      const ticket = {};
      stockFlight.current = ticket;
      setStockChecking(true);
      try {
        const input = prepareCheckout(
          intent.selection ? [intent.selection] : validatedItems,
          getMenu,
        );
        const owner = customerKey(sessionSource.getSnapshot());
        const cartItems = cartRef.current.items;
        const route = window.location.hash;
        const latestStock = await stockGate.check(
          input.items.map((item) => item.menuId),
        );
        if (
          stockFlight.current !== ticket ||
          customerKey(sessionSource.getSnapshot()) !== owner ||
          cartItems !== cartRef.current.items ||
          route !== window.location.hash
        )
          return;
        const checked = cartStock(input.items, getMenu, { data: latestStock });
        const blocked = [...checked.states.values()].find(
          (state) => state.blocked,
        );
        if (blocked) {
          reportAction(
            `${blocked.label} 상태예요. 수량과 재고를 다시 확인해 주세요.`,
          );
          stock.retry();
          return;
        }
        const baseline = captureCartStorage(storageProvider);
        const next = {
          source: intent.selection ? 'immediate' : 'cart',
          flow: createCheckoutFlow({
            input,
            adapter: checkoutAdapter ?? defaultAdapter,
            sessionSource,
            onPaid: ({ items }) => {
              const canApply = () =>
                checkoutRef.current === next &&
                customerKey(sessionSource.getSnapshot()) === owner;
              if (!canApply() || next.source !== 'cart') return '';
              const result = completePaidCart({
                orderedItems: items,
                currentItems: cartRef.current.items,
                storageProvider,
                baseline,
                canApply,
              });
              if (canApply()) {
                cartRef.current = result;
                setCart(result);
              }
              return result.warning;
            },
          }),
        };
        checkoutRef.current = next;
        setCheckout(next);
        window.history.pushState({ peakOrderCheckout: true }, '', '#checkout');
      } catch (failure) {
        if (stockFlight.current === ticket && failure.name !== 'AbortError')
          reportAction(failure.message);
      } finally {
        if (stockFlight.current === ticket) {
          stockFlight.current = null;
          setStockChecking(false);
        }
      }
      return;
    }
    try {
      const selected = intent.selection;
      const total = validatedItems
        .filter((item) => item.menuId === selected.menuId)
        .reduce((sum, item) => sum + item.quantity, selected.quantity);
      const status = stockStatus(getMenu(selected.menuId), stock, total);
      if (status.blocked) {
        reportAction(status.label);
        return;
      }
      const result = addItem(validatedItems, intent.selection, getMenu);
      persist(result.items);
      const feedback = result.limited
        ? '동일한 메뉴와 옵션은 합쳐서 최대 99개까지 담을 수 있어요.'
        : '';
      // Only a completed add consumes the detail. Validation/auth failures keep it.
      setSelectedId(null);
      setDetailFeedback('');
      if (
        cartDetail.current !== null &&
        window.history.state?.peakOrderCartDetail
      ) {
        cartReturnFocus.current = cartDetail.current;
        cartDetail.current = null;
        cartAddResult.current = { cart: cartRef.current, feedback };
        cartOpen.current = true;
        // Reuse the cart entry beneath this detail; don't create a second cart.
        // The consumed detail must also stay closed if the user goes Forward.
        window.history.replaceState(
          { peakOrderPage: cartReturnHash.current.slice(1) },
          '',
          cartReturnHash.current,
        );
        window.history.back();
      } else {
        cartOpenerRef.current = openerRef.current;
        navigate('cart');
        setCartFeedback(feedback);
      }
    } catch (failure) {
      reportAction(failure.message);
    }
  }

  function requestIntent(intent) {
    if (
      intent.type === 'add' &&
      (cartOpen.current || pendingIntent.current?.type === 'add')
    )
      return;
    clearActionFeedback();
    const planned = planCartIntent(session, intent);
    if (planned.forbidden) {
      reportAction('주문하려면 고객용 계정으로 로그인해 주세요.');
      return;
    }
    const action = planned.pending ?? planned.action;
    if (
      planned.pending ||
      (['add', 'order'].includes(action.type) && !cartReady)
    ) {
      const waiting = { ...action, id: ++intentNumber.current };
      pendingIntent.current = waiting;
      setLoginIntent(waiting);
      if (action.type === 'add')
        setDetailFeedback('메뉴 정보를 확인 중이에요. 잠시만 기다려 주세요.');
      return;
    }
    executeIntent(action);
  }

  function closeLogin() {
    cancelStockCheck();
    clearActionFeedback();
    pendingIntent.current = null;
    setLoginIntent(null);
  }

  function closeCheckout() {
    clearActionFeedback();
    const completed = checkoutRef.current?.flow.getSnapshot().stage === 'paid';
    checkoutRef.current?.flow.dispose();
    checkoutRef.current = null;
    setCheckout(null);
    if (completed) {
      cartOpen.current = false;
      setPage('menu');
      setSelectedId(null);
      pendingIntent.current = null;
      setLoginIntent(null);
      window.history.replaceState({ peakOrderPage: 'menu' }, '', '#menu-list');
      requestAnimationFrame(() =>
        document.getElementById('menu-list')?.focus({ preventScroll: true }),
      );
      return;
    }
    if (window.history.state?.peakOrderCheckout) window.history.back();
  }

  function updateCart(key, quantity) {
    if (!cartReady) return;
    cancelStockCheck();
    setCartFeedback('');
    try {
      persist(
        changeQuantity(validatedItems, key, quantity, getMenu, {
          allowPaused: true,
        }),
      );
    } catch (failure) {
      reportAction(failure.message);
    }
  }

  function deleteCartItem(key) {
    if (!cartReady) return;
    cancelStockCheck();
    setCartFeedback('');
    persist(removeItem(validatedItems, key, getMenu, { allowPaused: true }));
    requestAnimationFrame(() => document.getElementById('cart-title')?.focus());
  }

  function openMenu(id, event) {
    pendingIntent.current = null;
    setLoginIntent(null);
    openerRef.current = event.currentTarget;
    menuScroll.current = window.scrollY;
    lastMenuId.current = id;
    clearActionFeedback();
    setSelectedId(id);
  }

  function closeMenu() {
    cancelStockCheck();
    clearActionFeedback();
    pendingIntent.current = null;
    setLoginIntent(null);
    if (
      cartDetail.current !== null &&
      window.history.state?.peakOrderCartDetail
    ) {
      window.history.back();
      return;
    }
    setSelectedId(null);
    openerRef.current?.focus();
  }

  function openCartMenu(id) {
    clearActionFeedback();
    pendingIntent.current = null;
    setLoginIntent(null);
    restoreCartFocus.current = false;
    cartOpen.current = false;
    cartDetail.current = id;
    openerRef.current = cartOpenerRef.current;
    setPage('menu');
    setSelectedId(id);
    window.history.pushState(
      { peakOrderCartDetail: id },
      '',
      cartReturnHash.current,
    );
    window.dispatchEvent(new Event('peak-order-route'));
  }

  async function signOut() {
    if (authBusy || !sessionSource.logout) return;
    setAuthBusy(true);
    clearActionFeedback();
    setLoginIntent(null);
    pendingIntent.current = null;
    try {
      await sessionSource.logout();
      setLogoutFailed(false);
    } catch {
      setLogoutFailed(true);
    } finally {
      setAuthBusy(false);
    }
  }

  function navigateSection(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const link = event.target.closest('a');
    const href = link?.getAttribute('href');
    if (
      !['#home', '#menu-list', '#orders', '#account'].includes(href) &&
      !href?.startsWith('#account/')
    )
      return;
    event.preventDefault();
    clearActionFeedback();
    // Save before navigating: native anchor scrolling must not overwrite the previous page's position.
    sectionScroll.current[sectionRef.current] = window.scrollY;
    if (window.location.hash !== href)
      window.history.pushState({ peakOrderPage: href.slice(1) }, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <div className="app-shell" onClick={navigateSection}>
      <a
        className="skip-link"
        href={
          home
            ? '#home-heading'
            : ordersRoute
              ? '#orders-heading'
              : accountRoute
                ? '#account-heading'
                : '#menu-list'
        }
        onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById(
            home
              ? 'home-heading'
              : ordersRoute
                ? 'orders-heading'
                : accountRoute
                  ? 'account-heading'
                  : 'menu-list',
          );
          target?.focus();
          target?.scrollIntoView();
        }}
      >
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="피크오더">
        <a className="brand" aria-label="피크오더 홈" href="#home">
          <img src="/images/brand/peakorder-logo-a.png" alt="Peak Order" />
        </a>
        <nav aria-label="고객 메뉴">
          <a
            className={`nav-item ${home ? 'active' : ''}`}
            href="#home"
            aria-current={home ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />
            </svg>
            홈
          </a>
          <a
            className={`nav-item ${
              page !== 'cart' && !ordersRoute && !accountRoute && !home
                ? 'active'
                : ''
            }`}
            href="#menu-list"
            aria-current={
              page !== 'cart' && !ordersRoute && !accountRoute && !home
                ? 'page'
                : undefined
            }
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
          <a
            className={`nav-item ${ordersRoute ? 'active' : ''}`}
            href="#orders"
            aria-current={ordersRoute ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />
            </svg>
            주문 내역
          </a>
          <a
            className={`nav-item ${accountRoute ? 'active' : ''}`}
            href="#account"
            aria-current={accountRoute ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
            </svg>
            마이페이지
          </a>
        </nav>
        <button
          className={`nav-item cart-nav ${page === 'cart' ? 'active' : ''}`}
          aria-haspopup="dialog"
          aria-label={`장바구니, 상품 ${cart.items.reduce((sum, item) => sum + item.quantity, 0)}개`}
          aria-expanded={page === 'cart'}
          onClick={requestCart}
        >
          <span className="cart-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 4h2l3 12h11l2-8H6M10 20h.01M18 20h.01" />
            </svg>
            {cart.items.length > 0 && (
              <span className="cart-dot" aria-hidden="true" />
            )}
          </span>
          장바구니
        </button>
      </aside>
      <header className="customer-header" aria-label="고객 계정과 장바구니">
        {authenticated && (
          <span className="session-user" aria-label="로그인 사용자">
            {session.user?.nickname || session.user?.email || '로그인됨'}
          </span>
        )}
        {authenticated ? (
          <button className="text-button" onClick={signOut} disabled={authBusy}>
            로그아웃
          </button>
        ) : (
          <button
            className="text-button"
            disabled={authBusy || session?.phase === 'restoring'}
            onClick={() => requestIntent({ type: 'login' })}
          >
            {session?.phase === 'restoring' ? '로그인 확인 중' : '로그인'}
          </button>
        )}
        {logoutFailed && (
          <>
            <p className="account-action-error" role="alert">
              로그아웃을 완료하지 못했어요. 다시 시도해 주세요.
            </p>
            <button
              className="text-button"
              disabled={authBusy}
              onClick={signOut}
            >
              로그아웃 다시 시도
            </button>
          </>
        )}
      </header>
      {home && (
        <CustomerHome
          session={session}
          sessionSource={sessionSource}
          onLogin={() => requestIntent({ type: 'login' })}
          onCart={requestCart}
          authBusy={authBusy}
          congestionApi={congestionApi}
        />
      )}
      <main
        className="menu-page"
        hidden={Boolean(ordersRoute || accountRoute) || home}
      >
        <>
          <header className="page-heading">
            <h1>
              <strong>메뉴</strong> 카테고리
            </h1>
            <div className="header-actions">
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
            </div>
          </header>
          <div className="categories" role="group" aria-label="메뉴 카테고리">
            {[{ id: 'all', name: '전체' }, ...categories.current].map(
              (category) => (
                <button
                  key={category.id}
                  className={`category ${categoryId === category.id ? 'selected' : ''}`}
                  aria-pressed={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  <span className="category-image">
                    <CategoryIcon name={category.name} />
                  </span>
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
            {stock.error && (
              <div className="stock-notice" role="alert">
                <p>재고 확인 불가. 품절 여부를 확인하지 못했어요.</p>
                <button className="text-button" onClick={stock.retry}>
                  재고 다시 확인
                </button>
              </div>
            )}
            {listing.loading ? (
              <p className="empty-state" role="status">
                메뉴를 불러오는 중이에요.
              </p>
            ) : listing.error ? (
              <div className="empty-state" role="alert">
                <p>{listing.error.message}</p>
                <button className="pill-button" onClick={listing.retry}>
                  다시 시도
                </button>
              </div>
            ) : menus.length ? (
              <div className="menu-grid">
                {menus.map((menu) => (
                  <button
                    key={menu.id}
                    data-menu-id={menu.id}
                    className="menu-card"
                    onClick={(event) => openMenu(menu.id, event)}
                    aria-label={`${menu.name}, ${formatPrice(menu.basePrice)}${stockStatus(menu, stock).label ? `, ${stockStatus(menu, stock).label}` : ', 상세 보기'}`}
                  >
                    <span className="menu-photo" aria-hidden="true">
                      <MenuPhoto imageUrl={menu.imageUrl} name={menu.name} />
                    </span>
                    <span className="menu-name">{menu.name}</span>
                    <span className="menu-price">
                      {formatPrice(menu.basePrice)}
                    </span>
                    {stockStatus(menu, stock).label && (
                      <span className="status-badge">
                        {stockStatus(menu, stock).label}
                      </span>
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
      {accountRoute && (
        <AccountPage route={accountRoute} sessionSource={sessionSource} />
      )}
      {ordersRoute && (
        <OrderHistoryPage
          route={ordersRoute}
          sessionSource={sessionSource}
          onLogout={signOut}
          authBusy={authBusy}
          accountActions={false}
        />
      )}
      {page === 'cart' && (
        <CartOverlay
          backLabel={
            cartFromHome.current ? '홈으로 돌아가기' : '메뉴로 돌아가기'
          }
          onMenu={openCartMenu}
          rows={view?.rows ?? []}
          total={view?.total}
          pending={catalog.loading}
          failure={cartFailure}
          onRetry={() => {
            details.current.clear();
            catalog.retry();
          }}
          warning={[cart.warning, catalog.data?.warning]
            .filter(Boolean)
            .join(' ')}
          feedback={cartFeedback}
          stockStates={cartAvailability.states}
          stockBlocked={cartAvailability.blocked}
          stockLoading={stock.loading}
          stockError={stock.error}
          onStockRetry={stock.retry}
          stockChecking={stockChecking}
          onQuantity={updateCart}
          onRemove={deleteCartItem}
          onClose={closeCart}
          onOrder={() => requestIntent({ type: 'order' })}
        />
      )}
      {selectedId !== null && (
        <RemoteMenuDetail
          key={selectedId}
          active={
            page !== 'cart' &&
            (cartDetail.current !== null ||
              (!home && !ordersRoute && !accountRoute))
          }
          api={menuApi}
          menuId={selectedId}
          onLoaded={onDetailLoaded}
          adding={loginIntent?.type === 'add'}
          stock={stock}
          onStockRetry={stock.retry}
          cartQuantity={validatedItems
            .filter((item) => item.menuId === selectedId)
            .reduce((sum, item) => sum + item.quantity, 0)}
          stockChecking={stockChecking}
          onClose={closeMenu}
          feedback={detailFeedback}
          onAdd={(selection) => requestIntent({ type: 'add', selection })}
          onOrder={(selection) => requestIntent({ type: 'order', selection })}
          onViewCart={requestCart}
        />
      )}
      {checkout && (
        <CheckoutPage
          flow={checkout.flow}
          source={checkout.source}
          onClose={closeCheckout}
          onOrders={(id) => {
            if (checkoutRef.current?.flow.getSnapshot().stage !== 'paid')
              return;
            closeCheckout();
            window.history.replaceState(
              { peakOrderPage: 'orders' },
              '',
              ordersHref(0, id),
            );
            window.dispatchEvent(new Event('peak-order-route'));
          }}
        />
      )}
      {loginIntent &&
        ['order', 'login'].includes(loginIntent.type) &&
        !authenticated && (
          <LoginModal
            registrationApi={registrationApi}
            registrationTerms={registrationTerms}
            onClose={closeLogin}
            onLogin={sessionSource.login}
            waiting={session?.phase === 'restoring' || authBusy}
          />
        )}
    </div>
  );
}
