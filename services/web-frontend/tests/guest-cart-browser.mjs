// Actual App/Auth/Menu/Checkout HTTP clients against a loopback contract server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.GUEST_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startCustomerHttpFixture({
  input: resolve('tests/integration-boundary-entry.jsx'),
});
const browser = await chromium.launch({ headless: true });
const original = {
  version: 1,
  items: [{ menuId: 2, optionIds: [1], quantity: 1 }],
};
const added = { menuId: 1, optionIds: [2], quantity: 2 };
const results = [];
let context,
  page,
  errors,
  cleanups = [];
const storage = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('peak-order.cart.v1')));
const writes = () => page.evaluate(() => window.__guestWrites);
async function fresh({
  hash = '#menu-list',
  mobile = false,
  route,
  items = original,
} = {}) {
  await context?.close();
  fixture.requests.length = 0;
  Object.assign(fixture.checkoutControls, {
    scenario: 'success',
    delay: 0,
    priceDelta: 0,
  });
  context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    if (localStorage.getItem('peak-order.cart.v1') === null)
      localStorage.setItem('peak-order.cart.v1', JSON.stringify(value));
    window.__guestWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'peak-order.cart.v1')
        window.__guestWrites++;
      return set.call(this, key, value);
    };
  }, items);
  if (route) await route(page);
  await page.goto(fixture.url + hash);
  await page.locator('[data-menu-id="1"]').waitFor();
}
async function select() {
  await page.locator('[data-menu-id="1"]').click();
  const detail = page.locator('.detail-modal');
  await detail.locator('input[value="2"]').check();
  await detail
    .getByRole('button', { name: '수량 늘리기', exact: true })
    .click();
  return detail;
}
async function add(detail) {
  await detail
    .getByRole('button', { name: '장바구니에 담기', exact: true })
    .click();
  await page
    .locator('.cart-modal')
    .getByLabel('장바구니 전체 합계', { exact: true })
    .waitFor();
}
async function login() {
  await page
    .getByLabel('이메일', { exact: true })
    .fill('customer@example.test');
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function storeLogin(email = 'customer@example.test') {
  await page.evaluate(
    (email) =>
      window.__integration.session.login({
        email,
        password: 'fixture-only-password',
      }),
    email,
  );
}
async function closeCart() {
  await page
    .locator('.cart-modal')
    .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
    .click();
  await page.locator('.cart-modal').waitFor({ state: 'detached' });
}
async function gateMenu() {
  let release;
  const ready = new Promise((done) => {
    release = done;
  });
  cleanups.push(release);
  await fresh({
    route: (page) =>
      page.route('**/api/v1/menus/2', async (route) => {
        await ready;
        await route.continue().catch(() => {});
      }),
  });
  return release;
}
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await page
      ?.screenshot({ path: resolve(output, `FAIL-${results.length}.png`) })
      .catch(() => {});
  } finally {
    cleanups.forEach((done) => done());
    cleanups = [];
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  await check(
    'guest add opens cart without login; duplicate click blocked; close restores filters/selection',
    async () => {
      await fresh();
      await page.getByRole('searchbox').fill('버거');
      await page
        .getByRole('combobox', { name: '메뉴 정렬' })
        .selectOption('priceAsc');
      const detail = await select();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await page.locator('.cart-modal .cart-items').waitFor();
      assert.equal(await page.locator('.cart-feedback').count(), 0);
      assert.equal(await page.locator('.action-notice').count(), 0);
      assert.equal(await page.locator('.login-modal').count(), 0);
      assert.deepEqual((await storage()).items, [...original.items, added]);
      assert.equal(await writes(), 1);
      await page.screenshot({
        path: resolve(output, 'guest-cart-desktop.png'),
      });
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
        .focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest('dialog')?.className,
        ),
        'cart-modal',
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest('dialog')?.className,
        ),
        'cart-modal',
      );
      await closeCart();
      assert.equal(await page.locator('.detail-modal').count(), 0);
      assert.deepEqual((await storage()).items, [...original.items, added]);
      assert.equal(await page.getByRole('searchbox').inputValue(), '버거');
      assert.equal(
        await page.getByRole('combobox', { name: '메뉴 정렬' }).inputValue(),
        'priceAsc',
      );
    },
  );
  await check(
    'guest can view/change quantity/delete without authentication',
    async () => {
      await fresh();
      await page.locator('.cart-nav').click();
      const cart = page.locator('.cart-modal');
      await cart
        .getByRole('button', { name: '더블 치즈 버거 수량 늘리기' })
        .click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')).items[0]
            .quantity === 2,
      );
      assert.equal(await page.locator('.login-modal').count(), 0);
      await cart.getByRole('button', { name: /더블 치즈 버거.*삭제/ }).click();
      await cart
        .getByRole('heading', { name: '장바구니가 비어 있어요' })
        .waitFor();
      assert.deepEqual(await storage(), { version: 1, items: [] });
    },
  );
  await check(
    'anonymous cart deep link and reload keep contents without opening login',
    async () => {
      await fresh({ hash: '#cart' });
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      await page.reload();
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      assert.equal(await page.locator('.login-modal').count(), 0);
      assert.deepEqual(await storage(), original);
      assert.equal(await writes(), 0);
    },
  );
  await check(
    'cart order login cancel keeps overlay; later login never replays cancelled order',
    async () => {
      await fresh({ hash: '#cart' });
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .locator('.login-modal')
        .getByRole('button', { name: '선택한 화면으로 돌아가기' })
        .click();
      assert.equal(await page.locator('.cart-modal[open]').count(), 1);
      await storeLogin();
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.deepEqual(await storage(), original);
      assert.equal(fixture.requests.length, 0);
    },
  );
  await check(
    'guest cart order resumes once after login and confirmed payment subtracts once',
    async () => {
      await fresh({ hash: '#cart' });
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await login();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page
        .getByRole('button', { name: /원 모의 결제$/ })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await storage(), { version: 1, items: [] });
      assert.equal(await writes(), 1);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        1,
      );
    },
  );
  await check(
    'immediate order label/login cancel preserve selection and do not touch cart',
    async () => {
      await fresh();
      const detail = await select();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page
        .locator('.login-modal')
        .getByRole('button', { name: '선택한 화면으로 돌아가기' })
        .click();
      assert.equal(await detail.getByLabel('선택 수량').innerText(), '2');
      assert.deepEqual(await storage(), original);
      assert.equal(fixture.requests.length, 0);
    },
  );
  await check(
    'mobile immediate order sends detail selection only; success preserves existing cart',
    async () => {
      await fresh({ mobile: true });
      const detail = await select();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await login();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      assert.deepEqual(
        fixture.requests.find((r) => r.path === '/api/v1/orders').body,
        { items: [added] },
      );
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await storage(), original);
      assert.equal(await writes(), 0);
      await page.screenshot({ path: resolve(output, 'immediate-mobile.png') });
    },
  );
  await check(
    'STORE_ADMIN may use browser cart but cannot execute either order path',
    async () => {
      await fresh();
      await storeLogin('admin@example.test');
      const detail = await select();
      await add(detail);
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .locator('.cart-modal')
        .getByText('주문하려면 고객용 계정으로 로그인해 주세요.', {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator('.login-modal').count(), 0);
      await closeCart();
      await select();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.equal(fixture.requests.length, 0);
    },
  );
  await check(
    'logout keeps public cart usable and does not silently replay order',
    async () => {
      await fresh();
      await storeLogin();
      await page.locator('.cart-nav').click();
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      await page.evaluate(() => window.__integration.session.logout());
      assert.equal(await page.locator('.cart-modal[open]').count(), 1);
      assert.equal(await page.locator('.login-modal').count(), 0);
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '더블 치즈 버거 수량 늘리기' })
        .click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')).items[0]
            .quantity === 2,
      );
      assert.equal(fixture.requests.length, 0);
    },
  );
  await check(
    'pending guest add completes once after delayed catalog without login',
    async () => {
      const release = await gateMenu();
      const detail = await select();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await detail.getByRole('button', { name: '메뉴 확인 중…' }).waitFor();
      assert.deepEqual(await storage(), original);
      assert.equal(await page.locator('.login-modal').count(), 0);
      release();
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      assert.deepEqual((await storage()).items, [...original.items, added]);
      assert.equal(await writes(), 1);
    },
  );
  await check(
    'closing detail cancels delayed add; old validation and later login cannot reopen cart',
    async () => {
      const release = await gateMenu();
      const detail = await select();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await detail.getByRole('button', { name: '메뉴 상세 닫기' }).click();
      release();
      await storeLogin();
      await page.waitForTimeout(120);
      assert.deepEqual(await storage(), original);
      assert.equal(await writes(), 0);
      assert.equal(await page.locator('.cart-modal').count(), 0);
    },
  );
  await check(
    'logout cancels delayed prior-session add while new guest actions remain allowed',
    async () => {
      const release = await gateMenu();
      await storeLogin();
      const detail = await select();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await page.evaluate(() => window.__integration.session.logout());
      release();
      await page.waitForTimeout(140);
      assert.deepEqual(await storage(), original);
      assert.equal(await writes(), 0);
      await add(detail);
      assert.equal(await writes(), 1);
    },
  );
  await check(
    'account switch cancels old pending order but permits a fresh explicit CUSTOMER order',
    async () => {
      const release = await gateMenu();
      await storeLogin();
      const detail = await select();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.evaluate(() => window.__integration.session.logout());
      await storeLogin('other@example.test');
      release();
      await page.waitForTimeout(140);
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.deepEqual(await storage(), original);
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        0,
      );
    },
  );
  await check(
    'menu HTTP failure preserves raw cart; retry uses fresh server price before adding',
    async () => {
      let failed = true;
      await fresh({
        route: (page) =>
          page.route('**/api/v1/menus/2', async (route) => {
            if (failed)
              return route.fulfill({
                status: 503,
                json: { success: false, errorCode: 'MENU_SERVICE_UNAVAILABLE' },
              });
            const response = await route.fetch();
            const value = await response.json();
            value.data.basePrice = 10000;
            await route.fulfill({ json: value });
          }),
      });
      const detail = await select();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '장바구니 보기', exact: true })
        .click();
      const cart = page.locator('.cart-modal');
      await cart
        .getByText('장바구니를 확인하지 못했어요', { exact: true })
        .waitFor();
      assert.deepEqual(await storage(), original);
      assert.equal(await writes(), 0);
      failed = false;
      await cart.getByRole('button', { name: '다시 확인' }).click();
      await cart
        .getByLabel('장바구니 전체 합계')
        .filter({ hasText: '28,000원' })
        .waitFor();
      assert.equal(await writes(), 1);
      assert.deepEqual((await storage()).items, [...original.items, added]);
    },
  );
  await check(
    'restored cookie session and logout/reload preserve the browser cart',
    async () => {
      await fresh({ hash: '#cart' });
      await storeLogin();
      await page.reload();
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      await page.waitForFunction(
        () => window.__integration.session.getSnapshot().authenticated,
      );
      assert.deepEqual(await storage(), original);
      await page.evaluate(() => window.__integration.session.logout());
      await page.reload();
      await page
        .locator('.cart-modal')
        .getByLabel('장바구니 전체 합계')
        .waitFor();
      assert.equal(await page.locator('.login-modal').count(), 0);
      assert.deepEqual(await storage(), original);
    },
  );
  await check(
    'order intent during session restoration resumes once after verified CUSTOMER restore',
    async () => {
      await fresh();
      await storeLogin();
      let release;
      const gate = new Promise((done) => {
        release = done;
      });
      cleanups.push(release);
      await page.route('**/api/v1/auth/refresh', async (route) => {
        await gate;
        await route.continue().catch(() => {});
      });
      await page.reload();
      await page.locator('[data-menu-id="1"]').waitFor();
      const detail = await select();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.locator('.login-modal').waitFor();
      release();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/cooking/estimates')
          .length,
        1,
      );
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        0,
      );
      assert.deepEqual(await storage(), original);
    },
  );
} finally {
  await browser.close();
  await fixture.close();
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        pass: results.filter((r) => r.status === 'PASS').length,
        fail: results.filter((r) => r.status === 'FAIL').length,
        note: 'Temporary candidate, actual Chromium + loopback HTTP fixtures, not dev services.',
      },
      null,
      2,
    ),
  );
}
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
