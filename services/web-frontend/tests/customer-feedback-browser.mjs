// Local HTTP fixture only; exercises the same customer App used for manual QA.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startRegistrationFixture } from './registration-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.CUSTOMER_FEEDBACK_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = process.env.CUSTOMER_FEEDBACK_URL
  ? null
  : await startRegistrationFixture({ preview: true });
const url = process.env.CUSTOMER_FEEDBACK_URL ?? fixture.url;
const browser = await chromium.launch({ headless: true });
const results = [];
let context, page, errors;
async function fresh(width = 1440, hash = '#menu-list') {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${url}/?preview=1${hash}`);
}
async function login(
  email = 'customer@example.test',
  password = 'fixture-only-password',
) {
  await page
    .locator('.customer-header')
    .getByRole('button', { name: '로그인', exact: true })
    .click();
  await page.locator('.login-form input[type=email]').fill(email);
  await page.locator('.login-form input[type=password]').fill(password);
  await page.locator('.login-form button[type=submit]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
const cart = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('peak-order.cart.v1')));
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
      `${width}px brand, photos, cart dot, product detail and History preserve quantity/options`,
      async () => {
        await fresh(width);
        await page.locator('.menu-card').first().waitFor();
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.brand img, .menu-photo img')].every(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        );
        assert.equal(await page.locator('.sidebar nav a').count(), 4);
        assert.equal(
          await page.locator('.customer-header .cart-nav').count(),
          0,
        );
        assert.equal(await page.locator('.cart-dot').count(), 0);
        for (const target of [
          page.locator('.brand'),
          ...(await page.locator('.sidebar nav a').all()),
          page.locator('.cart-nav'),
        ]) {
          const box = await target.boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        }
        const first = page.locator('[data-menu-id="1"]');
        const source = await first.locator('img').getAttribute('src');
        assert.equal(source, '/images/menus/classic-burger.webp');
        await first.click();
        await page
          .locator('.detail-modal')
          .getByRole('radio', { name: /^세트/ })
          .check();
        await page
          .locator('.detail-modal')
          .getByRole('button', { name: '수량 늘리기' })
          .click();
        assert.equal(
          await page.locator('.detail-modal img').getAttribute('src'),
          source,
        );
        await page
          .getByRole('button', { name: '장바구니에 담기', exact: true })
          .click();
        await page.locator('.cart-items').waitFor();
        const before = await cart();
        assert.equal(before.items[0].quantity, 2);
        assert.deepEqual(before.items[0].optionIds, [2]);
        assert.equal(await page.locator('.cart-dot').count(), 1);
        assert.equal(
          await page.locator('.cart-photo img').getAttribute('src'),
          source,
        );
        await page.locator('.cart-photo').click();
        await page.locator('.detail-modal[open]').waitFor();
        assert.equal(await page.locator('dialog[open]').count(), 1);
        assert.deepEqual(await cart(), before);
        await page.goBack();
        await page.locator('.cart-modal[open]').waitFor();
        await page.waitForFunction(() =>
          document.activeElement?.hasAttribute('data-cart-menu-id'),
        );
        assert.deepEqual(await cart(), before);
        await page.goForward();
        await page.locator('.detail-modal[open]').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.cart-modal[open]').waitFor();
        await page.locator('.cart-menu-name').click();
        await page.locator('.detail-modal[open]').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.cart-modal[open]').waitFor();
        assert.deepEqual(await cart(), before);
        await page
          .locator('.cart-item')
          .getByRole('button', { name: /삭제$/ })
          .click();
        assert.equal(await page.locator('.cart-dot').count(), 0);
        await page.keyboard.press('Escape');
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: resolve(output, `customer-${width}.png`),
          fullPage: true,
        });
      },
    );
  await check(
    'public cart order logs in once, retains selected items, uses matching short order number everywhere',
    async () => {
      await fresh();
      await page.locator('[data-menu-id="1"]').click();
      await page
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .locator('.login-form input[type=email]')
        .fill('customer@example.test');
      await page
        .locator('.login-form input[type=password]')
        .fill('fixture-only-password');
      const before = await cart();
      await page.locator('.login-form button[type=submit]').click();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .waitFor();
      assert.deepEqual(await cart(), before);
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      const number = await page.locator('.mock-order-number').innerText();
      assert.match(number, /^\d{6}-\d{4}$/);
      await page.getByRole('button', { name: '주문 내역에서 확인' }).click();
      await page
        .getByRole('heading', { name: `주문번호 ${number}`, exact: true })
        .waitFor();
    },
  );
  await check(
    'nickname PATCH updates account/header, survives reload, and does not leak to another customer',
    async () => {
      await fresh(390, '#account');
      await login();
      await page
        .locator('.account-links')
        .getByRole('link', { name: '회원정보 수정' })
        .click();
      await page.getByLabel('닉네임', { exact: true }).fill('피크 검수 고객');
      const patch = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/me') &&
          response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: '저장', exact: true }).click();
      const response = await patch;
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).data.nickname, '피크 검수 고객');
      await page
        .locator('.account-card h2')
        .getByText('피크 검수 고객', { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('로그인 사용자').innerText(),
        '피크 검수 고객',
      );
      await page.reload();
      await page
        .locator('.account-card h2')
        .getByText('피크 검수 고객', { exact: true })
        .waitFor();
      await page
        .locator('.account-links')
        .getByRole('link', { name: '회원정보 수정' })
        .click();
      await page.getByLabel('닉네임', { exact: true }).fill('작성 중인 이름');
      await page.getByLabel('닉네임', { exact: true }).blur();
      assert.equal(
        await page.getByLabel('닉네임', { exact: true }).inputValue(),
        '작성 중인 이름',
      );
      await page
        .locator('.customer-header')
        .getByRole('button', { name: '로그아웃', exact: true })
        .click();
      await login('other@example.test');
      assert.equal(
        await page.getByLabel('닉네임', { exact: true }).inputValue(),
        '',
      );
      await page
        .locator('.account-actions')
        .getByRole('link', { name: '취소', exact: true })
        .click();
      await page
        .locator('.account-card h2')
        .getByText('닉네임 미설정', { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('로그인 사용자').innerText(),
        'other@example.test',
      );
    },
  );
  await check(
    'broken API image falls back to the default and unregistered menu/category remains usable',
    async () => {
      await fresh();
      await page.route('**/api/v1/menus?*', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        for (const menu of json.data.menus)
          menu.imageUrl = '/images/missing-photo.webp';
        await route.fulfill({ json });
      });
      await page.reload();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.menu-photo img')].length > 0 &&
          [...document.querySelectorAll('.menu-photo img')].every(
            (img) =>
              img.src.endsWith('/menu-placeholder.svg') && img.naturalWidth > 0,
          ),
      );
    },
  );
  await check(
    'unified preview password change logs out, accepts the new password and preserves cart',
    async () => {
      await fresh(320, '#account');
      await login();
      const before = await cart();
      async function change(current, next) {
        if (new URL(page.url()).hash !== '#account/password')
          await page
            .locator('.account-links')
            .getByRole('link', { name: '비밀번호 변경' })
            .click();
        await page.getByLabel('현재 비밀번호', { exact: true }).fill(current);
        await page.getByLabel('새 비밀번호', { exact: true }).fill(next);
        await page.getByLabel('새 비밀번호 확인', { exact: true }).fill(next);
        await page
          .locator('.account-form')
          .getByRole('button', { name: '비밀번호 변경', exact: true })
          .click();
        await page
          .getByRole('heading', { name: '비밀번호를 변경했어요', exact: true })
          .waitFor();
      }
      await change('fixture-only-password', 'fixture-updated-password');
      assert.deepEqual(await cart(), before);
      await login('customer@example.test', 'fixture-updated-password');
      await change('fixture-updated-password', 'fixture-only-password');
      await login();
      assert.deepEqual(await cart(), before);
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
