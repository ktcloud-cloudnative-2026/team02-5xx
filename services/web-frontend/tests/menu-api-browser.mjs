// Focused ME-01/02 integration checks; uses an existing external Playwright install.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startUiFixture } from './ui-fixture.mjs';

if (!process.env.PLAYWRIGHT_PACKAGE || !process.env.MENU_QA_OUTPUT) {
  throw new Error(
    'Set PLAYWRIGHT_PACKAGE and MENU_QA_OUTPUT; no project dependencies are installed.',
  );
}
const { chromium } = createRequire(
  resolve(process.env.PLAYWRIGHT_PACKAGE, 'package.json'),
)('playwright');
const output = resolve(process.env.MENU_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startUiFixture();
const browser = await chromium.launch({ headless: true });
const results = [];
const pageErrors = [];
async function scenario(name, check) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await check(page, context);
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack });
    await page.screenshot({
      path: resolve(output, `FAIL-${results.length}.png`),
    });
  } finally {
    await context.close();
  }
}
try {
  await scenario(
    'HTTP filters/search/sort, no all parameter, late list response cannot replace current results',
    async (page) => {
      const requests = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/v1/menus?'))
          requests.push(new URL(request.url()));
      });
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      assert.equal(requests[0].searchParams.has('categoryId'), false);
      await page.getByRole('button', { name: '버거', exact: true }).click();
      await page.getByLabel('메뉴 정렬').selectOption('priceDesc');
      await page.getByRole('searchbox').fill('치즈');
      await page.locator('[data-menu-id="2"]').waitFor();
      assert.equal(requests.at(-1).searchParams.get('categoryId'), '1');
      assert.equal(requests.at(-1).searchParams.get('sort'), 'priceDesc');
      let oldRoute;
      await page.route('**/api/v1/menus?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('query');
        const body = {
          success: true,
          data: {
            categories: [{ id: 1, name: '버거' }],
            menus: [
              {
                id: 1,
                categoryId: 1,
                name: query,
                imageUrl: null,
                basePrice: 1000,
                status: 'ON_SALE',
              },
            ],
          },
        };
        if (query === '느린') oldRoute = () => route.fulfill({ json: body });
        else await route.fulfill({ json: body });
      });
      await page.getByRole('searchbox').fill('느린');
      await page.waitForFunction(() =>
        document.body.textContent.includes('메뉴를 불러오는 중'),
      );
      while (!oldRoute) await new Promise((done) => setTimeout(done, 10));
      await page.getByRole('searchbox').fill('빠른');
      await page.locator('.menu-name').filter({ hasText: '빠른' }).waitFor();
      await oldRoute();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.menu-name').innerText(), '빠른');
      await page.screenshot({ path: resolve(output, 'customer-list.png') });
    },
  );
  await scenario(
    'PAUSED detail is readable but not actionable, contract omissions and active radio default',
    async (page) => {
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="4"]').click();
      const dialog = page.locator('dialog.detail-modal[open]');
      await dialog.getByText('현재 판매 중지된 메뉴입니다.').waitFor();
      assert.equal(
        await dialog
          .getByRole('button', { name: '장바구니에 담기' })
          .isDisabled(),
        true,
      );
      await page.keyboard.press('Escape');
      await page.locator('[data-menu-id="1"]').click();
      await dialog.getByText('영양 정보는 제공되지 않습니다.').waitFor();
      assert.equal(await dialog.getByRole('radio').first().isChecked(), true);
      assert.equal(await dialog.getByRole('radio').last().isDisabled(), true);
      await page.screenshot({ path: resolve(output, 'customer-detail.png') });
    },
  );
  await scenario(
    'anonymous login nests without losing selected options/quantity; Escape returns to detail',
    async (page) => {
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('dialog.detail-modal[open]');
      await detail
        .getByRole('radio', { name: '세트 +2,500원', exact: true })
        .check();
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.locator('dialog.login-modal[open]').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(
        await detail
          .getByRole('radio', { name: '세트 +2,500원', exact: true })
          .isChecked(),
        true,
      );
      assert.equal(await detail.getByLabel('선택 수량').innerText(), '2');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        null,
      );
    },
  );
  await scenario(
    'offline restore keeps storage and hides amounts; retry recalculates fresh server price and preserves CRUD/overlay history',
    async (page, context) => {
      const raw = JSON.stringify({
        version: 1,
        items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
      });
      await context.addInitScript(
        (value) => localStorage.setItem('peak-order.cart.v1', value),
        raw,
      );
      let offline = true;
      await page.route('**/api/v1/menus/1', async (route) => {
        if (offline)
          return route.fulfill({
            status: 500,
            json: { success: false, errorCode: 'INTERNAL_ERROR' },
          });
        const response = await route.fetch();
        const body = await response.json();
        body.data.basePrice = 7000;
        await route.fulfill({ json: body });
      });
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      await page.locator('#test-sign-in').click();
      await page.locator('.header-cart').click();
      const cart = page.locator('dialog.cart-modal[open]');
      await cart
        .getByText('장바구니를 확인하지 못했어요', { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        raw,
      );
      assert.equal(await cart.getByLabel('장바구니 전체 합계').count(), 0);
      offline = false;
      await cart.getByRole('button', { name: '다시 확인' }).click();
      await cart
        .getByLabel('장바구니 전체 합계')
        .filter({ hasText: '19,000원' })
        .waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        raw,
      );
      await cart
        .getByRole('button', { name: '클래식 버거 수량 늘리기' })
        .click();
      await cart
        .getByLabel('장바구니 전체 합계')
        .filter({ hasText: '28,500원' })
        .waitFor();
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('peak-order.cart.v1')),
      );
      assert.deepEqual(stored, {
        version: 1,
        items: [{ menuId: 1, optionIds: [2], quantity: 3 }],
      });
      await page.screenshot({ path: resolve(output, 'verified-cart.png') });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => location.hash !== '#cart');
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains('header-cart'),
      );
      assert.equal(
        await page
          .locator('.header-cart')
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.locator('.header-cart').click();
      await cart
        .getByLabel('장바구니 전체 합계')
        .filter({ hasText: '28,500원' })
        .waitFor();
      await cart.getByRole('button', { name: '클래식 버거 세트 삭제' }).click();
      await cart.getByText('장바구니가 비어 있어요').waitFor();
    },
  );
  await scenario(
    'list HTTP failure and retry are visible without fake empty results',
    async (page) => {
      let offline = true;
      await page.route('**/api/v1/menus?**', (route) =>
        offline
          ? route.fulfill({ status: 503, json: { success: false } })
          : route.continue(),
      );
      await page.goto(fixture.url + '#menu-list');
      await page
        .getByRole('button', { name: '다시 시도', exact: true })
        .waitFor();
      assert.equal(await page.getByText('등록된 메뉴가 없어요').count(), 0);
      offline = false;
      await page
        .getByRole('button', { name: '다시 시도', exact: true })
        .click();
      await page.locator('[data-menu-id="1"]').waitFor();
    },
  );
  await scenario(
    '320px customer view uses real async HTTP data and retains detail/login flow',
    async (page) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('dialog.detail-modal[open]');
      await detail.getByRole('radio').first().waitFor();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.locator('dialog.login-modal[open]').waitFor();
      await page.screenshot({ path: resolve(output, 'mobile-login.png') });
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        browser: browser.version(),
        source: 'Contract Mock HTTP only',
        results,
        pageErrors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
console.log(JSON.stringify({ results, pageErrors, output }, null, 2));
if (results.some((item) => item.status !== 'PASS') || pageErrors.length)
  process.exitCode = 1;
