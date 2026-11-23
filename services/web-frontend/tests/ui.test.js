import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getCategories,
  getMenu,
  getMenus,
} from '../src/data/menuRepository.js';
import { cartView } from '../src/cart.js';
import { anonymousSession } from '../src/session.js';

let vite;
let App;
let Cart;
let MenuDetail;
let MenuPhoto;
let LoginModal;
before(async () => {
  vite = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  App = (await vite.ssrLoadModule('/src/App.jsx')).default;
  Cart = (await vite.ssrLoadModule('/src/components/Cart.jsx')).default;
  MenuDetail = (await vite.ssrLoadModule('/src/components/MenuDetail.jsx'))
    .default;
  LoginModal = (await vite.ssrLoadModule('/src/components/LoginModal.jsx'))
    .default;
  MenuPhoto = (await vite.ssrLoadModule('/src/components/MenuPhoto.jsx'))
    .default;
});
after(async () => vite?.close());
const render = (Component, props = {}) =>
  renderToStaticMarkup(createElement(Component, props));

test('anonymous session cannot be enabled by persisted data', () => {
  assert.equal(anonymousSession.getSnapshot(), null);
  const html = render(App, {
    storageProvider: () => ({
      getItem: () =>
        JSON.stringify({
          version: 1,
          authenticated: true,
          role: 'STORE_ADMIN',
          items: [{ menuId: 1, optionIds: [1], quantity: 1 }],
        }),
    }),
  });
  assert.ok(!html.includes('내 장바구니'));
  assert.ok(!html.includes('장바구니 항목'));
  assert.ok(html.includes('메뉴 카테고리'));
});

test('cart deep link keeps the menu underneath and renders the same public overlay for anonymous and signed-in sessions', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { hash: '#cart' } };
  const snapshot = Object.freeze({ authenticated: true, role: 'CUSTOMER' });
  const storageProvider = () => ({ getItem: () => null });
  try {
    const signed = render(App, {
      storageProvider,
      sessionSource: {
        subscribe: () => () => {},
        getSnapshot: () => snapshot,
        getServerSnapshot: () => snapshot,
      },
    });
    assert.ok(signed.includes('class="cart-modal"'));
    assert.ok(signed.includes('id="menu-list"'));
    assert.ok(signed.includes('aria-labelledby="cart-title"'));
    const anonymous = render(App, { storageProvider });
    assert.ok(anonymous.includes('class="cart-modal"'));
    assert.ok(anonymous.includes('id="menu-list"'));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('signed-in UI is an injected test snapshot, not an implementation of authentication', () => {
  const snapshot = Object.freeze({ authenticated: true, role: 'CUSTOMER' });
  const sessionSource = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
  };
  const html = render(App, {
    sessionSource,
    storageProvider: () => ({
      getItem: () =>
        JSON.stringify({
          version: 1,
          items: [{ menuId: 1, optionIds: [1], quantity: 1 }],
        }),
    }),
  });
  assert.ok(html.includes('장바구니 (1)'));
});

test('cart renders configured options, limits, totals and empty state', () => {
  const view = cartView([{ menuId: 1, optionIds: [2], quantity: 2 }], getMenu);
  const html = render(Cart, {
    ...view,
    onBack: () => {},
    onRemove: () => {},
    onQuantity: () => {},
  });
  assert.ok(html.includes('클래식 버거'));
  assert.ok(html.includes('세트'));
  assert.ok(html.includes('18,000원'));
  assert.ok(html.includes('메뉴로 돌아가기'));
  assert.ok(html.includes('삭제'));
  assert.ok(
    render(Cart, { rows: [], total: 0 }).includes('장바구니가 비어 있어요'),
  );
  for (const quantity of [1, 99]) {
    const limited = render(Cart, {
      ...cartView([{ menuId: 1, optionIds: [1], quantity }], getMenu),
    });
    assert.ok(limited.includes('disabled=""'));
  }
});

test('menu detail retains radio defaults, inactive options, quantity and new entry actions', () => {
  const html = render(MenuDetail, { menu: getMenu(1), onClose: () => {} });
  assert.ok(html.includes('메뉴 상세 닫기'));
  assert.ok(html.includes('장바구니에 담기'));
  assert.ok(html.includes('이 메뉴만 바로 주문'));
  assert.ok(html.includes('라지 세트'));
  assert.ok(html.includes('disabled=""'));
  assert.ok(html.includes('checked=""'));
  assert.ok(html.includes('선택 수량'));
});

test('login modal provides real credential fields and a return path, without pretending to authenticate', () => {
  const html = render(LoginModal, { onClose: () => {} });
  assert.ok(html.includes('로그인이 필요해요'));
  assert.ok(html.includes('선택한 화면으로 돌아가기'));
  assert.ok(html.includes('disabled=""'));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.toLowerCase().includes('autocomplete="current-password"'));
  assert.ok(html.includes('로그인 유지'));
});

test('existing menu catalog behavior stays intact', () => {
  assert.equal(getCategories().length, 5);
  const all = getMenus();
  assert.ok(all.every((menu) => menu.status !== 'HIDDEN'));
  assert.ok(all.some((menu) => menu.status === 'PAUSED'));
  assert.deepEqual(getMenus({ query: '존재하지않는메뉴' }), []);
  const prices = getMenus({ sort: 'priceAsc' }).map((menu) => menu.basePrice);
  assert.deepEqual(
    prices,
    [...prices].sort((a, b) => a - b),
  );
  assert.ok(
    getMenus({ categoryId: 1, query: '버거' }).every(
      (menu) => menu.categoryId === 1,
    ),
  );
  assert.equal(getMenu(999), null);
});

test('storage corruption and access failures do not abort the real App SSR render', () => {
  const denied = () => {
    throw new Error('storage denied');
  };
  const providers = [
    denied,
    () => ({ getItem: denied }),
    ...[
      '{',
      '{"version":0,"items":[]}',
      '{"version":1}',
      '{"version":1,"items":[null,{}, {"menuId":1,"optionIds":[1],"quantity":100}]}',
    ].map((raw) => () => ({ getItem: () => raw, setItem: denied })),
  ];
  for (const storageProvider of providers) {
    const html = render(App, { storageProvider });
    assert.ok(html.includes('메뉴 카테고리'));
    assert.ok(html.includes('메뉴를 불러오는 중이에요.'));
    assert.ok(!html.includes('storage denied'));
  }
});

test('menu images use the default asset when missing and preserve configured paths', () => {
  const missing = render(MenuPhoto, { imageUrl: null });
  assert.ok(missing.includes('src="/images/defaults/menu-placeholder.svg"'));
  const empty = render(MenuPhoto, { imageUrl: '   ' });
  assert.ok(empty.includes('src="/images/defaults/menu-placeholder.svg"'));
  const configured = render(MenuPhoto, {
    imageUrl: '/images/menus/classic-burger.webp',
  });
  assert.ok(configured.includes('src="/images/menus/classic-burger.webp"'));
});
