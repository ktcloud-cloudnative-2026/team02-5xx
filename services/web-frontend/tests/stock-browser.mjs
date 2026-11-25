import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startStockFixture } from './stock-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.STOCK_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startStockFixture({ input: resolve('src/main.jsx') });
const browser = await chromium.launch({ headless: true });
let context, page, errors;
const results = [];
const item = (menuId, quantity, option = 1) => ({
  menuId,
  quantity,
  optionIds: [option],
});
const mixedCart = [
  item(1, 2),
  item(2, 1),
  item(3, 2),
  item(3, 1, 2),
  item(4, 1),
];
async function fresh({ scenario = 'mixed', items = [], width = 1440 } = {}) {
  await context?.close();
  fixture.seed(scenario);
  fixture.stockControls.requests.length = 0;
  fixture.requests.length = 0;
  context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((items) => {
    localStorage.setItem(
      'peak-order.cart.v1',
      JSON.stringify({ version: 1, items }),
    );
    window.__stockWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'peak-order.cart.v1') window.__stockWrites++;
      return original.call(this, key, value);
    };
  }, items);
  await page.goto(`${fixture.url}/#menu-list`);
  await page.locator('[data-menu-id="1"]').waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.status-badge')].some(
        (e) => e.textContent === '재고 확인 중',
      ),
  );
}
async function cart() {
  await page.locator('.sidebar > .cart-nav').click();
  await page.locator('.cart-modal .cart-line-total').first().waitFor();
  await page
    .locator('.cart-modal')
    .getByText('재고 확인 중', { exact: true })
    .waitFor({ state: 'detached' });
  return page.locator('.cart-modal');
}
async function login() {
  if (!(await page.locator('.login-modal').count()))
    await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page
    .getByLabel('이메일', { exact: true })
    .fill('customer@example.test');
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type=submit]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
const stored = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('peak-order.cart.v1')).items,
  );
async function check(name, fn) {
  await fn();
  assert.deepEqual(errors, []);
  results.push({ name, status: 'PASS' });
  console.log(`PASS: ${name}`);
}
try {
  await check(
    'list sold/paused precedence; sold details stay readable and block actions; options/prices and shortage',
    async () => {
      await fresh();
      assert.equal(
        await page.locator('[data-menu-id="2"] .status-badge').innerText(),
        '품절',
      );
      assert.equal(
        await page.locator('[data-menu-id="4"] .status-badge').innerText(),
        '판매 중지',
      );
      await page.screenshot({
        path: resolve(output, 'desktop-list.png'),
        fullPage: true,
      });
      await page.locator('[data-menu-id="2"]').click();
      const detail = page.locator('.detail-modal');
      await detail.getByText('품절', { exact: true }).waitFor();
      assert.equal(
        await detail
          .getByRole('button', { name: '장바구니에 담기', exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await detail
          .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
          .isDisabled(),
        true,
      );
      await page.keyboard.press('Escape');
      await page.locator('[data-menu-id="3"]').click();
      await detail.getByText('주문 가능 · 가용 2개', { exact: true }).waitFor();
      await detail.locator('input[value="2"]').check();
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      assert.equal(
        await detail.getByLabel('총 금액', { exact: true }).innerText(),
        '19,000원',
      );
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await detail.getByText(/재고 부족 · 가용 2개/).waitFor();
      assert.equal(
        await detail
          .getByRole('button', { name: '장바구니에 담기', exact: true })
          .isDisabled(),
        true,
      );
      await page.screenshot({
        path: resolve(output, 'desktop-short-detail.png'),
      });
      await detail
        .getByRole('button', { name: '수량 줄이기', exact: true })
        .click();
      assert.equal(
        await detail
          .getByRole('button', { name: '장바구니에 담기', exact: true })
          .isEnabled(),
        true,
      );
    },
  );
  await check(
    'mixed cart preserves all rows/quantities/storage; sold and paused remain editable',
    async () => {
      await fresh({ items: mixedCart });
      const dialog = await cart();
      assert.equal(await dialog.locator('.cart-item').count(), 5);
      assert.equal(
        await dialog
          .getByRole('button', { name: '주문하기', exact: true })
          .isDisabled(),
        true,
      );
      assert.deepEqual(await stored(), mixedCart);
      assert.equal(await page.evaluate(() => window.__stockWrites), 0);
      await page.screenshot({
        path: resolve(output, 'desktop-mixed-cart.png'),
      });
      const paused = dialog
        .locator('.cart-item')
        .filter({ hasText: '머시룸 버거' });
      await paused
        .getByRole('button', { name: '머시룸 버거 수량 늘리기', exact: true })
        .click();
      await paused.getByLabel('머시룸 버거 수량', { exact: true }).waitFor();
      assert.equal((await stored()).find((r) => r.menuId === 4).quantity, 2);
      const sold = dialog
        .locator('.cart-item')
        .filter({ hasText: '더블 치즈 버거' });
      await sold.getByRole('button', { name: /삭제$/ }).click();
      assert.equal(
        (await stored()).some((r) => r.menuId === 2),
        false,
      );
      assert.equal((await stored()).filter((r) => r.menuId === 3).length, 2);
    },
  );
  await check(
    'same-menu option totals block; quantity edits permit order; final lookup blocks a newer shortage then explicit retry enters Checkout once',
    async () => {
      await fresh({ scenario: 'short', items: [item(1, 2), item(1, 2, 2)] });
      await login();
      const dialog = await cart();
      await dialog
        .getByText(/선택 합계 4개/)
        .first()
        .waitFor();
      assert.equal(
        await dialog
          .getByRole('button', { name: '주문하기', exact: true })
          .isDisabled(),
        true,
      );
      await dialog
        .getByRole('button', { name: '클래식 버거 수량 줄이기', exact: true })
        .first()
        .click();
      await dialog
        .getByRole('button', { name: '주문하기', exact: true })
        .waitFor();
      await page.waitForFunction(
        () => !document.querySelector('.cart-summary .pill-button').disabled,
      );
      fixture.stockControls.quantities.set(1, 2);
      await dialog
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await dialog
        .locator('.cart-feedback')
        .filter({ hasText: '재고 부족' })
        .waitFor();
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        0,
      );
      fixture.stockControls.quantities.set(1, 50);
      await dialog
        .getByRole('button', { name: '재고 다시 확인', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.cart-summary .pill-button').disabled,
      );
      const before = fixture.stockControls.requests.length;
      fixture.stockControls.delay = 250;
      await dialog
        .getByRole('button', { name: '주문하기', exact: true })
        .dblclick();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .waitFor();
      assert.equal(fixture.stockControls.requests.length, before + 1);
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await stored(), []);
    },
  );
  await check(
    'HTTP failure and malformed rows stay unknown; explicit retry recovers, storage and editing remain available',
    async () => {
      await fresh({ scenario: 'error', items: [item(1, 2)] });
      assert.equal(
        await page.locator('[data-menu-id="1"] .status-badge').innerText(),
        '재고 확인 불가',
      );
      const dialog = await cart();
      assert.deepEqual(await stored(), [item(1, 2)]);
      await dialog
        .getByRole('button', { name: '클래식 버거 수량 줄이기', exact: true })
        .click();
      assert.deepEqual(await stored(), [item(1, 1)]);
      fixture.stockControls.status = 200;
      await dialog
        .getByRole('button', { name: '재고 다시 확인', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.cart-summary .pill-button').disabled,
      );
      for (const mode of ['missing', 'duplicate']) {
        fixture.stockControls.mode = mode;
        await dialog
          .getByRole('button', { name: '재고 다시 확인', exact: true })
          .click();
        await dialog.getByText('재고 확인 불가', { exact: true }).waitFor();
        assert.equal(
          await dialog
            .getByRole('button', { name: '주문하기', exact: true })
            .isDisabled(),
          true,
        );
      }
    },
  );
  await check(
    'late previous-search availability cannot overwrite new data',
    async () => {
      await fresh({ scenario: 'normal' });
      let release;
      let intercepted;
      const started = new Promise((done) => {
        intercepted = done;
      });
      await page.route('**/api/v1/inventory/availability?*', async (route) => {
        if (!release) {
          await new Promise((done) => {
            release = done;
            intercepted();
          });
          await route.fulfill({
            json: {
              success: true,
              data: [{ menuId: 1, orderable: false, availableQty: 0 }],
            },
          });
        } else await route.continue();
      });
      await page.getByRole('searchbox').fill('클래식');
      await started;
      await page.getByRole('searchbox').fill('더블');
      await page.locator('[data-menu-id="2"]').waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-menu-id="2"] .status-badge'),
      );
      release();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator('[data-menu-id="2"] .status-badge').count(),
        0,
      );
    },
  );
  await check(
    'close detail during final stock check prevents late Checkout',
    async () => {
      await fresh({ scenario: 'normal' });
      await login();
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('.detail-modal');
      await detail
        .getByText('주문 가능 · 가용 50개', { exact: true })
        .waitFor();
      fixture.stockControls.delay = 250;
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '메뉴 상세 닫기', exact: true })
        .click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.checkout-page').count(), 0);
    },
  );
  await check(
    'cart quantity edit during final check cancels the old order attempt',
    async () => {
      await fresh({ scenario: 'normal', items: [item(1, 2)] });
      await login();
      const dialog = await cart();
      fixture.stockControls.delay = 250;
      await dialog
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: '클래식 버거 수량 줄이기', exact: true })
        .click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.deepEqual(await stored(), [item(1, 1)]);
    },
  );
  for (const width of [390, 320])
    await check(`mobile ${width}px list/detail/cart and keyboard`, async () => {
      await fresh({ items: mixedCart, width });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: resolve(output, `mobile-${width}-list.png`),
        fullPage: true,
      });
      await page.locator('[data-menu-id="3"]').click();
      await page
        .locator('.detail-modal')
        .getByText('주문 가능 · 가용 2개', { exact: true })
        .waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      const dialog = await cart();
      assert.equal(await dialog.locator('.cart-item').count(), 5);
      await page.screenshot({
        path: resolve(output, `mobile-${width}-cart.png`),
      });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.cart-modal').count(), 0);
    });
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'FAIL.png'), fullPage: true });
  throw error;
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  await browser.close();
  await fixture.close();
}
