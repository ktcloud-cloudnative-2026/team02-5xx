// Product App + existing loopback HTTP fixtures; never real Gateway/dev E2E.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.CUSTOMER_NAV_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startCustomerHttpFixture({
  input: resolve('src/main.jsx'),
});
const browser = await chromium.launch({ headless: true });
const results = [];
const originalCart = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
let context, page, errors;
const cart = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('peak-order.cart.v1')));
const nav = (name) =>
  page
    .getByRole('navigation', { name: '고객 메뉴', exact: true })
    .getByRole('link', { name, exact: true });
async function focus(id) {
  await page.waitForFunction(
    (value) => document.activeElement?.id === value,
    id,
  );
}
async function fresh(hash = '#menu-list', width = 1440) {
  await context?.close();
  fixture.requests.length = 0;
  context = await browser.newContext({ viewport: { width, height: 600 } });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    if (localStorage.getItem('peak-order.cart.v1') === null)
      localStorage.setItem('peak-order.cart.v1', JSON.stringify(value));
  }, originalCart);
  await page.goto(`${fixture.url}/${hash}`);
  const login = page
    .locator('.customer-header')
    .getByRole('button', { name: '로그인', exact: true });
  await login.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.customer-header button').disabled,
  );
  await login.click();
  await page
    .locator('.login-form input[type="email"]')
    .fill('customer@example.test');
  await page
    .locator('.login-form input[type="password"]')
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
  await page.getByLabel('로그인 사용자').waitFor();
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
    'menu/account preserve independent scroll positions and focus through back/forward',
    async () => {
      await fresh();
      await page.locator('.menu-card').first().waitFor();
      await page.evaluate(() => window.scrollTo(0, 450));
      await page.waitForFunction(() => window.scrollY === 450);
      await nav('마이페이지').click();
      await page.locator('.account-links').waitFor();
      await focus('account-heading');
      assert.equal(await page.locator('main.menu-page').isVisible(), false);
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await page.evaluate(() => window.scrollTo(0, 100));
      await page.waitForFunction(() => window.scrollY === 100);
      await nav('메뉴').click();
      await focus('menu-list');
      await page.waitForFunction(() => window.scrollY === 450);
      await page.goBack();
      await focus('account-heading');
      await page.waitForFunction(() => window.scrollY === 100);
      await page.goForward();
      await focus('menu-list');
      await page.waitForFunction(() => window.scrollY === 450);
      assert.deepEqual(await cart(), originalCart);
    },
  );

  await check(
    'home/menu/orders/account round trips keep one active screen and the menu query',
    async () => {
      await fresh();
      await page.getByRole('searchbox', { name: '메뉴 검색' }).fill('버거');
      for (const [name, heading] of [
        ['홈', 'home-heading'],
        ['주문 내역', 'orders-heading'],
        ['마이페이지', 'account-heading'],
        ['메뉴', 'menu-list'],
      ]) {
        await nav(name).click();
        await focus(heading);
        assert.equal(await page.locator('main:visible').count(), 1);
        assert.equal(await nav(name).getAttribute('aria-current'), 'page');
      }
      assert.equal(
        await page.getByRole('searchbox', { name: '메뉴 검색' }).inputValue(),
        '버거',
      );
      assert.deepEqual(await cart(), originalCart);
      assert.equal(
        fixture.requests.filter((r) => r.method === 'POST').length,
        0,
      );
    },
  );

  for (const width of [390, 320])
    await check(
      `${width}px account subroutes support direct entry, refresh, history and skip focus`,
      async () => {
        await fresh('#account/profile', width);
        await page.getByLabel('닉네임', { exact: true }).waitFor();
        await page.reload();
        await page.getByLabel('닉네임', { exact: true }).waitFor();
        await focus('account-heading');
        await page
          .locator('.account-actions')
          .getByRole('link', { name: '취소', exact: true })
          .click();
        await page.locator('.account-links').waitFor();
        await page
          .locator('.account-links')
          .getByRole('link', { name: '비밀번호 변경' })
          .click();
        await page.getByLabel('현재 비밀번호', { exact: true }).waitFor();
        await page.goBack();
        await page.locator('.account-links').waitFor();
        await page.locator('.skip-link').evaluate((link) => link.click());
        await focus('account-heading');
        assert.equal(await page.locator('main:visible').count(), 1);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(await cart(), originalCart);
      },
    );

  await check(
    'cart opened from account returns to account without changing cart or creating an order',
    async () => {
      await fresh('#account');
      await page.locator('.account-links').waitFor();
      await page.locator('.cart-nav').click();
      await page.locator('.cart-modal').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.cart-modal').waitFor({ state: 'detached' });
      await page.waitForFunction(() => location.hash === '#account');
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains('cart-nav'),
      );
      assert.deepEqual(await cart(), originalCart);
      assert.equal(
        fixture.requests.filter((r) => r.method === 'POST').length,
        0,
      );
    },
  );

  await check(
    'account route never exposes a form that the new profile GET would replace',
    async () => {
      await fresh('#account');
      await page.locator('.account-links').waitFor();
      let release, started;
      const gate = new Promise((done) => {
        release = done;
      });
      const lookup = new Promise((done) => {
        started = done;
      });
      await page.route('**/api/v1/auth/me', async (route) => {
        started();
        await gate;
        await route.continue();
      });
      await page.evaluate(() => {
        window.__earlyAccountForm = false;
        window.__accountObserver = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (
                node.nodeType === Node.ELEMENT_NODE &&
                (node.matches('.account-form') ||
                  node.querySelector('.account-form'))
              )
                window.__earlyAccountForm = true;
        });
        window.__accountObserver.observe(
          document.querySelector('.account-card'),
          { childList: true, subtree: true },
        );
      });
      try {
        await page
          .locator('.account-links')
          .getByRole('link', { name: '비밀번호 변경' })
          .click();
        await lookup;
        await page
          .getByText('회원정보를 불러오는 중이에요.', { exact: true })
          .waitFor();
        assert.equal(await page.locator('.account-form').count(), 0);
        assert.equal(
          await page.evaluate(() => window.__earlyAccountForm),
          false,
        );
        await page.evaluate(() => window.__accountObserver.disconnect());
      } finally {
        release();
      }
      await page
        .getByLabel('현재 비밀번호', { exact: true })
        .fill('fixture-only-password');
      await page.getByLabel('새 비밀번호', { exact: true }).fill('short');
      await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('short');
      await page
        .locator('.account-form')
        .getByRole('button', { name: '비밀번호 변경', exact: true })
        .click();
      await page
        .locator('#account-error')
        .getByText('새 비밀번호는 12~64자로 입력해 주세요.', { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('현재 비밀번호', { exact: true }).inputValue(),
        'fixture-only-password',
      );
      assert.equal(
        fixture.requests.filter((r) => r.method === 'POST').length,
        0,
      );
      assert.deepEqual(await cart(), originalCart);
    },
  );

  for (const status of [401, 403])
    for (const operation of ['create', 'pay'])
      await check(
        `text/plain ${status} on ${operation} preserves cart and never repeats a POST`,
        async () => {
          await fresh();
          const refreshes = fixture.counts.refresh;
          let writes = 0;
          await page.route(
            operation === 'create'
              ? '**/api/v1/orders'
              : '**/api/v1/orders/*/pay',
            async (route) => {
              if (route.request().method() !== 'POST') return route.continue();
              writes++;
              await route.fulfill({
                status,
                contentType: 'text/plain',
                body: 'Gateway authentication failure',
              });
            },
          );
          await page.locator('.cart-nav').click();
          await page
            .locator('.cart-modal')
            .getByRole('button', { name: '주문하기', exact: true })
            .click();
          await page
            .getByRole('button', { name: '결제 금액 확인', exact: true })
            .click();
          if (operation === 'pay')
            await page.getByRole('button', { name: /원 모의 결제$/ }).click();
          if (status === 401)
            await page
              .getByText(/로그인 상태가 변경되어 주문을 중단/)
              .waitFor();
          else if (operation === 'pay')
            await page.getByText(/처리 결과를 확인할 수 없어요/).waitFor();
          else
            await page
              .getByText(/주문 준비 결과를 확인하지 못했어요/)
              .waitFor();
          assert.equal(writes, 1);
          assert.equal(fixture.counts.refresh, refreshes);
          assert.deepEqual(await cart(), originalCart);
          assert.equal(await page.locator('.mock-order-number').count(), 0);
        },
      );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  await browser.close();
  await fixture.close();
}
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
