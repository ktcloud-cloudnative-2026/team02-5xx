// Real Chromium against the customer product entry and loopback HTTP contracts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(
  process.env.PENDING_LOGIN_QA_OUTPUT ??
    resolve(tmpdir(), 'peak-order-331-login-history'),
);
await mkdir(output, { recursive: true });
const fixture = await startCustomerHttpFixture({
  input: resolve('src/main.jsx'),
});
const browser = await chromium.launch({ headless: true });
const originalCart = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
const detailSelection = { menuId: 1, optionIds: [1], quantity: 3 };
const results = [];
let page, context, errors, requestIndex;

async function fresh(width = 1440) {
  await context?.close();
  fixture.controls.delay = 0;
  requestIndex = fixture.requests.length;
  context = await browser.newContext({ viewport: { width, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((cart) => {
    localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart));
    window.__cartWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'peak-order.cart.v1') window.__cartWrites++;
      return setItem.call(this, key, value);
    };
  }, originalCart);
  await page.goto(`${fixture.url}/#menu-list`);
  await page.locator('[data-menu-id="1"]').waitFor();
  await page.locator('.cart-nav').click();
  await page.locator('.cart-modal[open] .cart-photo').waitFor();
}
const orderPosts = () =>
  fixture.requests
    .slice(requestIndex)
    .filter(
      (request) =>
        request.method === 'POST' && request.path.startsWith('/api/v1/orders'),
    );
async function preservedCart() {
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('peak-order.cart.v1')),
    ),
    originalCart,
  );
  assert.equal(await page.evaluate(() => window.__cartWrites), 0);
}
async function noOrder(expectedPosts = 0) {
  assert.equal(
    await page.locator('.checkout-page, .estimate-modal, .login-modal').count(),
    0,
  );
  assert.equal(orderPosts().length, expectedPosts);
  await preservedCart();
}
async function openDetail() {
  await page.locator('.cart-photo').click();
  await page.locator('.detail-modal[open] input[value="1"]').check();
  for (let i = 0; i < 2; i++)
    await page
      .locator('.detail-modal')
      .getByRole('button', { name: '수량 늘리기', exact: true })
      .click();
  assert.equal(
    await page.getByLabel('선택 수량', { exact: true }).innerText(),
    '3',
  );
}
async function pendingDetailOrder() {
  await openDetail();
  await page
    .locator('.detail-modal')
    .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
    .click();
  await page.locator('.login-modal[open]').waitFor();
}
async function login({ wait = true } = {}) {
  if (!(await page.locator('.login-modal').count()))
    await page
      .locator('.customer-header')
      .getByRole('button', { name: '로그인', exact: true })
      .click();
  await page
    .getByLabel('이메일', { exact: true })
    .fill('customer@example.test');
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  if (wait) {
    await page.locator('.login-modal').waitFor({ state: 'detached' });
    await page.getByLabel('로그인 사용자').waitFor();
  }
}
async function restoredCart(expectedPosts = 0) {
  await page.locator('.login-modal').waitFor({ state: 'detached' });
  await page.locator('.detail-modal').waitFor({ state: 'detached' });
  await page.locator('.cart-modal[open]').waitFor();
  await page.waitForFunction(() => location.hash === '#cart');
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await page.waitForFunction(() =>
    Boolean(document.activeElement?.closest('.cart-modal[open]')),
  );
  await noOrder(expectedPosts);
}
async function loginWithoutOrdering() {
  await page.keyboard.press('Escape');
  await page.locator('.cart-modal').waitFor({ state: 'detached' });
  await login();
  await page.waitForTimeout(200);
  await noOrder();
}
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack });
    await page.screenshot({
      path: resolve(output, `FAIL-${results.length}.png`),
      fullPage: true,
    });
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  for (const width of [1440, 390, 320])
    await check(
      `${width}px guest cart/detail/order/login Back cancels intent through repeated Back/Forward and later login`,
      async () => {
        await fresh(width);
        await pendingDetailOrder();
        await page.goBack();
        await restoredCart();
        for (let i = 0; i < 2; i++) {
          await page.goForward();
          await page.locator('.detail-modal[open]').waitFor();
          await noOrder();
          await page.goBack();
          await restoredCart();
        }
        await loginWithoutOrdering();
      },
    );
  await check(
    'Forward restoring a detail entry also cancels the cart login order before the early return',
    async () => {
      await fresh();
      await openDetail();
      await page.goBack();
      await restoredCart();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page.locator('.login-modal[open]').waitFor();
      await page.goForward();
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      await page.locator('.detail-modal[open]').waitFor();
      await noOrder();
      await page.goBack();
      await restoredCart();
      await loginWithoutOrdering();
    },
  );
  await check(
    'Back during a dispatched login request discards the intent and ignores late authentication completion',
    async () => {
      await fresh();
      await pendingDetailOrder();
      fixture.controls.delay = 650;
      const dispatched = page.waitForRequest(
        (request) =>
          request.url().endsWith('/api/v1/auth/login') &&
          request.method() === 'POST',
      );
      await login({ wait: false });
      await dispatched;
      await page.goBack();
      await restoredCart();
      await page.waitForTimeout(800);
      fixture.controls.delay = 0;
      await noOrder();
      await page.goForward();
      await page.locator('.detail-modal[open]').waitFor();
      await noOrder();
      await page.goBack();
      await restoredCart();
      await loginWithoutOrdering();
    },
  );
  await check(
    'normal detail login resumes the selected option and quantity once and keeps the existing cart',
    async () => {
      await fresh();
      await pendingDetailOrder();
      await login();
      await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await page.locator('.checkout-page[open]').waitFor();
      assert.match(await page.locator('.checkout-summary').innerText(), /× 3/);
      await preservedCart();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).waitFor();
      assert.equal(
        orderPosts().filter((request) => request.path === '/api/v1/orders')
          .length,
        1,
      );
      assert.deepEqual(
        orderPosts().find((request) => request.path === '/api/v1/orders').body,
        { items: [detailSelection] },
      );
      await preservedCart();
      await page.goBack();
      await page.locator('.checkout-page').waitFor({ state: 'detached' });
      await page.locator('.detail-modal[open]').waitFor();
      await page.goBack();
      await restoredCart(1);
    },
  );
  await check(
    'normal cart login still resumes the existing cart selection',
    async () => {
      await fresh();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await login();
      await page.locator('.checkout-page[open]').waitFor();
      assert.match(await page.locator('.checkout-summary').innerText(), /× 2/);
      await preservedCart();
      assert.equal(orderPosts().length, 0);
    },
  );
} finally {
  await context?.close();
  await browser.close();
  await fixture.close();
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
}
console.log(
  `${results.filter((result) => result.status === 'PASS').length}/${results.length} PASS`,
);
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
