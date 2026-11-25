// Product customer App with loopback HTTP fixtures; no real backend requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.CART_RETURN_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = process.env.CART_RETURN_PREVIEW_URL
  ? null
  : await startCustomerHttpFixture({ input: resolve('src/main.jsx') });
const url = process.env.CART_RETURN_PREVIEW_URL ?? fixture.url;
const browser = await chromium.launch({ headless: true });
const results = [];
let context, page, errors;
async function fresh(width = 1440) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 700 } });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cartWrites = 0;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'peak-order.cart.v1') window.__cartWrites++;
      return write.call(this, key, value);
    };
  });
  await page.goto(`${url}/#menu-list`);
  await page.locator('[data-menu-id="1"]').waitFor();
}
const items = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('peak-order.cart.v1'))?.items ?? [],
  );
const writes = () => page.evaluate(() => window.__cartWrites);
async function open() {
  await page.locator('[data-menu-id="1"]').click();
  await page.locator('.detail-modal input[value="2"]').check();
}
async function addTwice() {
  await page
    .getByRole('button', { name: '장바구니에 담기', exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.locator('.cart-modal[open] .cart-items').waitFor();
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
      `${width}px successful add consumes detail, returns to unchanged menu filters/scroll/focus and writes once`,
      async () => {
        await fresh(width);
        await page
          .getByRole('group', { name: '메뉴 카테고리' })
          .getByRole('button', { name: '버거', exact: true })
          .click();
        await page.getByRole('searchbox').fill('버거');
        await page
          .getByRole('combobox', { name: '메뉴 정렬' })
          .selectOption('priceDesc');
        const menu = page.locator('[data-menu-id="1"]');
        await menu.scrollIntoViewIfNeeded();
        const scroll = await page.evaluate(() => scrollY);
        await open();
        await page
          .getByRole('button', { name: '수량 늘리기', exact: true })
          .click();
        await addTwice();
        assert.equal(await page.locator('.detail-modal').count(), 0);
        assert.equal(await page.locator('dialog[open]').count(), 1);
        assert.deepEqual(await items(), [
          { menuId: 1, optionIds: [2], quantity: 2 },
        ]);
        assert.equal(await writes(), 1);
        if (width === 390) await page.goBack();
        else if (width === 320) await page.keyboard.press('Escape');
        else
          await page
            .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
            .click();
        await page.locator('.cart-modal').waitFor({ state: 'detached' });
        await page.waitForFunction(() =>
          document.activeElement?.matches('[data-menu-id="1"]'),
        );
        await page.waitForFunction(
          (position) => Math.abs(scrollY - position) <= 2,
          scroll,
        );
        assert.equal(await page.locator('dialog[open]').count(), 0);
        assert.equal(await page.getByRole('searchbox').inputValue(), '버거');
        assert.equal(
          await page.getByRole('combobox', { name: '메뉴 정렬' }).inputValue(),
          'priceDesc',
        );
        assert.equal(
          await page
            .getByRole('group', { name: '메뉴 카테고리' })
            .getByRole('button', { name: '버거', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        await page.goForward();
        await page.locator('.cart-modal[open]').waitFor();
        assert.equal(await page.locator('.detail-modal').count(), 0);
        assert.equal(await writes(), 1);
      },
    );
  await check(
    'home cart -> read-only detail -> cart -> home preserves contents without adding',
    async () => {
      await fresh();
      await open();
      await addTwice();
      await page.keyboard.press('Escape');
      await page
        .locator('.sidebar nav')
        .getByRole('link', { name: '홈', exact: true })
        .click();
      await page.locator('#home-heading').waitFor();
      await page.locator('.cart-nav').click();
      const before = await items(),
        count = await writes();
      await page.locator('.cart-photo').click();
      await page.locator('.detail-modal[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.cart-modal[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#home-heading').waitFor();
      assert.equal(new URL(page.url()).hash, '#home');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.deepEqual(await items(), before);
      assert.equal(await writes(), count);
    },
  );
  await check(
    'adding from cart-origin detail consumes its History entry and cannot reopen it on cart close/Forward',
    async () => {
      await fresh();
      await open();
      await addTwice();
      await page.locator('.cart-photo').click();
      await page.locator('.detail-modal input[value="2"]').check();
      await addTwice();
      assert.deepEqual(await items(), [
        { menuId: 1, optionIds: [2], quantity: 2 },
      ]);
      assert.equal(await writes(), 2);
      assert.equal(await page.locator('.detail-modal').count(), 0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => location.hash === '#menu-list');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.goForward();
      await page.locator('.cart-modal[open]').waitFor();
      await page.goForward();
      await page.waitForFunction(() => location.hash === '#menu-list');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await writes(), 2);
    },
  );
  await check(
    'quantity cap feedback survives cart-detail add navigation without duplicating items',
    async () => {
      await fresh();
      await page.evaluate(() =>
        localStorage.setItem(
          'peak-order.cart.v1',
          JSON.stringify({
            version: 1,
            items: [{ menuId: 1, optionIds: [2], quantity: 99 }],
          }),
        ),
      );
      await page.reload();
      await page.locator('.cart-nav').click();
      await page.locator('.cart-photo').click();
      await page.locator('.detail-modal input[value="2"]').check();
      await addTwice();
      await page
        .locator('.cart-feedback')
        .getByText(/최대 99개/)
        .waitFor();
      assert.deepEqual(await items(), [
        { menuId: 1, optionIds: [2], quantity: 99 },
      ]);
      assert.equal(await writes(), 1);
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#menu-list');
      assert.equal(await page.locator('dialog[open]').count(), 0);
    },
  );
  await check(
    'detail loading failure and failed/cancelled login never pretend an add succeeded or discard selection',
    async () => {
      await fresh();
      await page.route('**/api/v1/menus/1', (route) =>
        route.fulfill({
          status: 503,
          json: { success: false, message: 'Synthetic menu failure' },
        }),
      );
      await page.locator('[data-menu-id="1"]').click();
      await page.locator('.detail-modal [role=alert]').waitFor();
      assert.equal(await page.locator('.cart-modal').count(), 0);
      assert.equal(await writes(), 0);
      await page.unroute('**/api/v1/menus/1');
      await page
        .locator('.detail-modal')
        .getByRole('button', { name: '다시 시도', exact: true })
        .click();
      await page.locator('.detail-modal input[value="2"]').check();
      await page
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await page
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page
        .locator('.login-form input[type=email]')
        .fill('customer@example.test');
      await page
        .locator('.login-form input[type=password]')
        .fill('wrong-password');
      await page.locator('.login-form button[type=submit]').click();
      await page.locator('.login-modal [role=alert]').waitFor();
      assert.equal(await page.locator('.detail-modal').count(), 1);
      assert.equal(await page.locator('.cart-modal').count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(
        await page.locator('.detail-modal input[value="2"]').isChecked(),
        true,
      );
      assert.equal(
        await page.getByLabel('선택 수량', { exact: true }).innerText(),
        '2',
      );
      assert.equal(await writes(), 0);
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
