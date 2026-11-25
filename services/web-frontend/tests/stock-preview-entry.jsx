// Test-only entry. Real App/HTTP clients; synthetic backend and cart presets.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { CART_STORAGE_KEY } from '../src/cart.js';
import '../src/index.css';
const scenarios = {
  mixed: '전체 상태',
  normal: '정상',
  sold: '품절',
  short: '옵션 합산 부족',
  paused: '판매 중지',
  error: '조회 실패',
};
const requested =
  new URLSearchParams(location.search).get('scenario') ?? 'mixed';
const scenario = Object.hasOwn(scenarios, requested) ? requested : 'mixed';
await fetch(`/__stock/scenario?name=${scenario}`, { method: 'POST' });
const item = (menuId, quantity, optionId = 1) => ({
  menuId,
  quantity,
  optionIds: [optionId],
});
const carts = {
  mixed: [item(1, 2), item(2, 1), item(3, 2), item(3, 1, 2), item(4, 1)],
  normal: [item(1, 2)],
  sold: [item(1, 1)],
  short: [item(1, 2), item(1, 2, 2)],
  paused: [item(4, 1)],
  error: [item(1, 1)],
};
// Explicit demo preset selection only. Production never writes a seeded cart.
localStorage.setItem(
  CART_STORAGE_KEY,
  JSON.stringify({ version: 1, items: carts[scenario] }),
);
createRoot(document.getElementById('root')).render(
  <>
    <aside
      style={{
        margin: '92px 16px 0 clamp(16px, 10vw, 140px)',
        padding: 16,
        background: 'white',
        border: '1px solid #ddd',
        borderRadius: 16,
      }}
      aria-label="HTTP fixture 시나리오"
    >
      <strong>검수용 HTTP fixture · 실제 Inventory 아님</strong>
      <p style={{ marginTop: 8 }}>
        가상 로그인: customer@example.test / fixture-only-password
      </p>
      <p style={{ marginTop: 8 }}>
        시나리오를 선택하면 검수용 장바구니를 초기화합니다.
      </p>
      <nav
        style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}
      >
        {Object.entries(scenarios).map(([key, label]) => (
          <a key={key} href={`/?scenario=${key}#menu-list`}>
            {label}
          </a>
        ))}
      </nav>
    </aside>
    <App />
  </>,
);
