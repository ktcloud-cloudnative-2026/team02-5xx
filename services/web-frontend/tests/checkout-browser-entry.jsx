// Test-only session and fault injection; never imported by the product entry.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { getMenu } from '../src/data/menuRepository.js';
import { getMenus, getCategories } from '../src/data/menuRepository.js';
import { createMockCheckoutAdapter } from '../src/checkout/mockCheckoutAdapter.js';
import '../src/index.css';

const params = new URLSearchParams(location.search);
const customer = (id) => ({
  authenticated: true,
  user: { id, role: 'CUSTOMER' },
});
let snapshot =
  params.get('session') === 'anonymous'
    ? null
    : params.get('session') === 'admin'
      ? { authenticated: true, user: { id: 9, role: 'STORE_ADMIN' } }
      : customer(1);
const listeners = new Set();
const sessionSource = {
  getSnapshot: () => snapshot,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
const publish = (next) => {
  snapshot = next;
  listeners.forEach((fn) => fn());
};
const adapter = createMockCheckoutAdapter({
  resolveMenu: getMenu,
  delay: Number(params.get('delay') ?? 80),
  scenario: params.get('scenario') ?? 'success',
  estimateScenario: params.get('estimate') ?? 'success',
});
const calls = { estimate: 0, create: 0, pay: 0, get: 0 };
const cartWrites = [];
let failCartWrites = false,
  holdPaid = false,
  releasePaid,
  paidResponseWaiting = false;
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  if (this === localStorage && key === 'peak-order.cart.v1') {
    if (failCartWrites) throw new Error('Test-only quota failure');
    cartWrites.push(value);
  }
  return originalSetItem.call(this, key, value);
};
let estimateFailure = params.get('estimate') === 'retry';
for (const name of Object.keys(calls)) {
  const original = adapter[name];
  adapter[name] = async (...args) => {
    calls[name]++;
    if (name === 'estimate' && estimateFailure) {
      estimateFailure = false;
      throw new Error('테스트 예상시간 일시 장애');
    }
    const result = await original(...args);
    if (name === 'pay' && holdPaid) {
      paidResponseWaiting = true;
      await new Promise((resolve) => {
        releasePaid = resolve;
      });
    }
    return result;
  };
}
const root = createRoot(document.getElementById('root'));
const mount = () =>
  root.render(
    <StrictMode>
      <App
        sessionSource={sessionSource}
        checkoutAdapter={adapter}
        menuApi={{
          list: async (query) => ({
            menus: getMenus(query),
            categories: getCategories(),
          }),
          detail: async (id) => getMenu(id),
        }}
      />
    </StrictMode>,
  );
window.__checkoutQA = {
  customer: (id) => publish(customer(id)),
  logout: () => publish(null),
  calls,
  cartWrites,
  failCartWrites: () => {
    failCartWrites = true;
  },
  holdPaidResponse: () => {
    holdPaid = true;
  },
  get paidResponseWaiting() {
    return paidResponseWaiting;
  },
  releasePaidResponse: () => releasePaid?.(),
  unmount: () => root.render(null),
  mount,
};
document.getElementById('test-sign-in').onclick = () => publish(customer(1));
document.getElementById('test-sign-out').onclick = () => publish(null);
document.getElementById('test-pending').onclick = () => {
  const watcher = new MutationObserver(() => {
    if (document.querySelector('.login-modal[open]')) {
      watcher.disconnect();
      publish(customer(1));
    }
  });
  watcher.observe(document.body, { childList: true, subtree: true });
};
mount();
