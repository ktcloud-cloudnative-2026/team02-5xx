// Customer action feedback lifecycle against local HTTP fixtures only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startRegistrationFixture } from './registration-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.NOTICE_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = process.env.NOTICE_PREVIEW_URL
  ? null
  : await startRegistrationFixture({ preview: true });
const url = process.env.NOTICE_PREVIEW_URL ?? fixture.url;
const browser = await chromium.launch({ headless: true });
const results = [];
let context, page, errors;
async function fresh() {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${url}/#menu-list`);
  await page.locator('.menu-card').first().waitFor();
}
async function login(email = 'customer@example.test') {
  await page
    .locator('.customer-header')
    .getByRole('button', { name: '로그인', exact: true })
    .click();
  await page.locator('.login-form input[type=email]').fill(email);
  await page
    .locator('.login-form input[type=password]')
    .fill('fixture-only-password');
  await page.locator('.login-form button[type=submit]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function add() {
  await page.locator('[data-menu-id="1"]').click();
  await page
    .getByRole('button', { name: '장바구니에 담기', exact: true })
    .click();
  await page.locator('.cart-items').waitFor();
}
async function noGlobalNotice() {
  assert.equal(await page.locator('.action-notice').count(), 0);
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /장바구니에서 삭제했어요|수량을 변경했어요|로그인했어요|로그아웃했어요|장바구니에 담았어요/,
  );
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
  await check(
    'add, quantity and delete have no global success banner, while accessible totals/counts still change',
    async () => {
      await fresh();
      await add();
      await noGlobalNotice();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '클래식 버거 수량 늘리기' })
        .click();
      await page
        .locator('.cart-modal .sr-only[role=status]')
        .getByText('장바구니 상품 2개', { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByLabel('장바구니 전체 합계', { exact: true })
          .innerText(),
        '13,000원',
      );
      await noGlobalNotice();
      await page
        .locator('.cart-item')
        .getByRole('button', { name: /삭제$/ })
        .click();
      await page
        .locator('.cart-modal .sr-only[role=status]')
        .getByText('장바구니 상품 0개', { exact: true })
        .waitFor();
      await noGlobalNotice();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.detail-modal').count(), 0);
      await page.waitForFunction(() =>
        document.activeElement?.matches('[data-menu-id="1"]'),
      );
      await page
        .locator('.sidebar nav')
        .getByRole('link', { name: '홈', exact: true })
        .click();
      await page.goBack();
      await noGlobalNotice();
    },
  );
  await check(
    'quantity cap warning stays inside cart and disappears after the next operation and navigation',
    async () => {
      await fresh();
      await page.evaluate(() =>
        localStorage.setItem(
          'peak-order.cart.v1',
          JSON.stringify({
            version: 1,
            items: [{ menuId: 1, optionIds: [1], quantity: 99 }],
          }),
        ),
      );
      await page.reload();
      await add();
      await page
        .locator('.cart-feedback')
        .getByText(/최대 99개/)
        .waitFor();
      await noGlobalNotice();
      await page
        .getByRole('button', { name: '클래식 버거 수량 줄이기' })
        .click();
      assert.equal(await page.locator('.cart-feedback').count(), 0);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.cart-nav').click();
      assert.equal(await page.locator('.cart-feedback').count(), 0);
    },
  );
  await check(
    'permission failure is local to the attempted order and does not survive closing or reopening its modal',
    async () => {
      await fresh();
      await login('admin@example.test');
      await noGlobalNotice();
      await add();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .locator('.cart-feedback')
        .getByText(/고객용 계정/)
        .waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.cart-feedback').count(), 0);
      assert.equal(await page.locator('.selection-feedback').count(), 0);
      await page.keyboard.press('Escape');
      await page.locator('.cart-nav').click();
      assert.equal(await page.locator('.cart-feedback').count(), 0);
      await noGlobalNotice();
    },
  );
  await check(
    'login/logout successes stay quiet and logout failure retains its nearby warning and explicit retry',
    async () => {
      await fresh();
      await login();
      await noGlobalNotice();
      await page.route('**/api/v1/auth/logout', (route) =>
        route.fulfill({
          status: 503,
          json: {
            success: false,
            message: 'Synthetic failure',
            errorCode: 'FIXTURE_ERROR',
          },
        }),
      );
      await page
        .locator('.customer-header')
        .getByRole('button', { name: '로그아웃', exact: true })
        .click();
      await page
        .locator('.customer-header [role=alert]')
        .getByText(/로그아웃을 완료하지 못했어요/)
        .waitFor();
      await noGlobalNotice();
      await page.unroute('**/api/v1/auth/logout');
      await page
        .locator('.customer-header')
        .getByRole('button', { name: '로그아웃 다시 시도', exact: true })
        .click();
      await page
        .locator('.account-action-error')
        .waitFor({ state: 'detached' });
      await noGlobalNotice();
      await page
        .locator('.sidebar nav')
        .getByRole('link', { name: '홈', exact: true })
        .click();
      await noGlobalNotice();
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  await browser.close();
  await fixture?.close();
}
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
