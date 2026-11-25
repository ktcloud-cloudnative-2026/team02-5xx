import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createMockAdminMenuAdapter } from '../src/data/admin/mockAdminMenuAdapter.js';
import {
  adminCategories,
  adminMenuFixtures,
} from '../src/data/admin/adminMenuFixtures.js';
import { startAdminPreview } from '../scripts/admin-preview.mjs';
import {
  getCategories,
  getMenu,
  getMenus,
} from '../src/data/menuRepository.js';
import { calculateTotal, MAX_QUANTITY } from '../src/menu.js';

test('actual React SSR renders separate admin page, editor and unchanged customer App', async () => {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const page = (
      await server.ssrLoadModule('/src/components/admin/AdminMenuPage.jsx')
    ).default;
    const editor = (
      await server.ssrLoadModule('/src/components/admin/AdminMenuEditor.jsx')
    ).default;
    const customer = (await server.ssrLoadModule('/src/App.jsx')).default;
    const html = renderToStaticMarkup(
      createElement(page, { adapter: createMockAdminMenuAdapter() }),
    );
    assert.ok(html.includes('MOCK PREVIEW'));
    assert.ok(html.includes('새 메뉴 등록'));
    assert.ok(html.includes('불러오는 중'));
    assert.ok(html.includes('전체 상태'));
    assert.ok(html.includes('aria-label="판매 상태 필터"'));
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 3);
    assert.ok(!html.includes('품절'));
    const editHtml = renderToStaticMarkup(
      createElement(editor, {
        menu: adminMenuFixtures[0],
        categories: adminCategories,
        adapter: createMockAdminMenuAdapter(),
        returnFocusRef: { current: null },
      }),
    );
    assert.ok(editHtml.includes('메뉴 수정'));
    assert.ok(editHtml.includes('비활성'));
    assert.ok(editHtml.includes('aria-labelledby="am-dialog-title"'));
    assert.ok(editHtml.includes('options.0.name'));
    assert.ok(editHtml.includes('class="am-dialog am-drawer"'));
    assert.ok(editHtml.includes('이미지 주소 (선택)'));
    assert.ok(!editHtml.includes('type="file"'));
    assert.ok(!editHtml.includes('name="status"'));
    const createHtml = renderToStaticMarkup(
      createElement(editor, {
        categories: adminCategories,
        adapter: createMockAdminMenuAdapter(),
        returnFocusRef: { current: null },
      }),
    );
    assert.ok(createHtml.includes('name="status"'));
    assert.ok(createHtml.includes('기본 가격 (원)'));
    assert.ok(createHtml.includes('메뉴 등록'));
    assert.ok(createHtml.includes('class="am-dialog am-drawer"'));
    const customerHtml = renderToStaticMarkup(createElement(customer));
    assert.ok(customerHtml.includes('메뉴'));
    // The product App now loads its public catalog over HTTP after mounting.
    assert.ok(customerHtml.includes('메뉴를 불러오는 중이에요.'));
    assert.ok(!customerHtml.includes('MOCK PREVIEW'));
    assert.ok(!customerHtml.includes('새 메뉴 등록'));
  } finally {
    await server.close();
  }
});
test('existing customer repository and price behavior remain intact', () => {
  assert.ok(getCategories().length > 0);
  const rows = getMenus({ categoryId: 'all', query: '', sort: 'default' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((m) => m.status !== 'HIDDEN'));
  assert.equal(getMenu(rows[0].id).id, rows[0].id);
  assert.equal(calculateTotal(6500, 2500, 2), 18000);
  assert.equal(MAX_QUANTITY, 99);
});
test('isolated static preview serves no HMR, backend endpoint or product admin route', async () => {
  const preview = await startAdminPreview();
  try {
    const index = await fetch(preview.origin);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.ok(html.includes('관리자 Mock 미리보기'));
    assert.ok(!html.includes('/@vite/client'));
    // The isolated preview declares its own icon, avoiding Chromium's implicit
    // /favicon.ico request without adding assets to the customer product.
    assert.ok(html.includes('rel="icon"'));
    assert.ok(html.includes('data:image/svg+xml,'));
    for (const [path, body] of preview.files)
      if (path.endsWith('.js')) {
        assert.ok(!body.toString().includes('/@vite/client'));
        const response = await fetch(preview.origin + path);
        assert.equal(response.status, 200);
      }
    assert.equal(
      (await fetch(`${preview.origin}/api/v1/admin/menus`)).status,
      404,
    );
    assert.equal((await fetch(`${preview.origin}/admin`)).status, 404);
    assert.equal((await fetch(preview.origin, { method: 'POST' })).status, 405);
  } finally {
    await preview.close();
  }
});
