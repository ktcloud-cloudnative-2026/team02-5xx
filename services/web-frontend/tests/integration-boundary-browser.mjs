import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startAuthFixture } from './auth-http-fixture.mjs';
import { menus } from '../src/data/mockMenus.js';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.BOUNDARY_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startAuthFixture({
  input: resolve('tests/integration-boundary-entry.jsx'),
});
const browser = await chromium.launch({ headless: true });
const original = {
  version: 1,
  items: [{ menuId: 2, optionIds: [1], quantity: 1 }],
};
const results = [];
const frame = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('peak-order.cart.v1')));
const writes = (page) => page.evaluate(() => window.__cartWrites);
async function sessionLogin(page, email = 'customer@example.test') {
  await page.evaluate(
    (email) =>
      window.__integration.session.login({
        email,
        password: 'fixture-only-password',
      }),
    email,
  );
  await frame(page);
}
async function choose(page, action = 'add') {
  await page.locator('[data-menu-id="1"]').click();
  const detail = page.locator('.detail-modal');
  await detail.locator('input[type="radio"][value="2"]').check();
  await detail.getByRole('button', { name: '수량 늘리기' }).click();
  await detail
    .getByRole('button', {
      name: action === 'order' ? '이 메뉴만 바로 주문' : '장바구니에 담기',
      exact: true,
    })
    .click();
  return detail;
}
async function loginModal(page) {
  if (!(await page.locator('.login-modal').count())) return sessionLogin(page);
  await page
    .getByLabel('이메일', { exact: true })
    .fill('customer@example.test');
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
  await frame(page);
}
function response(price = 8500) {
  return {
    success: true,
    data: {
      ...menus.find((menu) => menu.id === 2),
      basePrice: price,
      imageUrl: null,
      description: null,
    },
    message: 'OK',
  };
}
async function blockCatalog(page) {
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  let count = 0;
  await page.route('**/api/v1/menus/2', async (route) => {
    count++;
    await gate;
    await route.fulfill({ json: response() });
  });
  return {
    count: () => count,
    async release() {
      const pending = page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/menus/2'),
      );
      release();
      await pending;
      await frame(page);
    },
    cleanup: release,
  };
}
async function scenario(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  const cleanups = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((original) => {
    localStorage.setItem('peak-order.cart.v1', JSON.stringify(original));
    window.__ignoreMenuAbort = true;
    window.__cartWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'peak-order.cart.v1') window.__cartWrites++;
      return set.call(this, key, value);
    };
  }, original);
  try {
    await run(page, cleanups);
    assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({
      name,
      status: 'FAIL',
      error: error.message,
      pageErrors: errors,
      diagnostics: await page
        .evaluate(() => ({
          writes: window.__cartWrites,
          storage: localStorage.getItem('peak-order.cart.v1'),
          notice: [...document.querySelectorAll('.action-notice')].map(
            (e) => e.textContent,
          ),
        }))
        .catch(() => null),
    });
  } finally {
    cleanups.forEach((cleanup) => cleanup());
    await context.close();
    console.log(`${results.at(-1).status}: ${name}`);
  }
}
async function pending(page, cleanups, action = 'add') {
  const gate = await blockCatalog(page);
  cleanups.push(gate.cleanup);
  await page.goto(fixture.url + '#menu-list');
  const detail = await choose(page, action);
  return { gate, detail };
}
try {
  await scenario(
    'A: cancel anonymous login preserves selection and never adds after late validation or later login',
    async (page, cleanups) => {
      const { gate, detail } = await pending(page, cleanups, 'order');
      await page.keyboard.press('Escape');
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      assert.equal(
        await page.evaluate(
          () => window.__integration.session.getSnapshot().authenticated,
        ),
        false,
      );
      await gate.release();
      await sessionLogin(page);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
      assert.equal(
        await detail.getByLabel('선택 수량', { exact: true }).textContent(),
        '2',
      );
      assert.equal(await detail.locator('input[value="2"]').isChecked(), true);
    },
  );
  await scenario(
    'B1: UI Logout cancels pending add before delayed validation, same-account new session cannot replay',
    async (page, cleanups) => {
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      // The header is behind the detail dialog; exercise the actual React UI handler.
      await page
        .getByRole('button', {
          name: '로그아웃',
          exact: true,
          includeHidden: true,
        })
        .evaluate((button) => button.click());
      await page.waitForFunction(
        () => !window.__integration.session.getSnapshot().authenticated,
      );
      await gate.release();
      await sessionLogin(page);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'B2: Store Logout outside UI also invalidates pending add before same-account relogin',
    async (page, cleanups) => {
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      await page.evaluate(() => window.__integration.session.logout());
      await frame(page);
      await sessionLogin(page);
      await gate.release();
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'C: CUSTOMER A pending add cannot execute under CUSTOMER B or replay after return to A',
    async (page, cleanups) => {
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      await sessionLogin(page, 'other@example.test');
      assert.equal(
        await page.evaluate(
          () => window.__integration.session.getSnapshot().user.id,
        ),
        3,
      );
      await gate.release();
      await sessionLogin(page);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'B3: refresh failure invalidates old pending add before same-account relogin',
    async (page, cleanups) => {
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      let reject = true;
      await page.route('**/api/v1/auth/me', (route) =>
        reject
          ? route.fulfill({
              status: 401,
              json: { success: false, errorCode: 'UNAUTHORIZED' },
            })
          : route.continue(),
      );
      await page.evaluate(() =>
        window.__integration.session.loadUser().catch(() => null),
      );
      await page.waitForFunction(
        () => !window.__integration.session.getSnapshot().authenticated,
      );
      await frame(page);
      reject = false;
      await sessionLogin(page);
      await gate.release();
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'D1: delayed duplicate HTTP completions resume exactly once across repeated profile updates',
    async (page, cleanups) => {
      const gate = await blockCatalog(page);
      cleanups.push(gate.cleanup);
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      await page.evaluate(() => {
        window.__integration.unmount();
        window.__integration.mount();
      });
      await choose(page);
      await loginModal(page);
      for (let i = 0; i < 3; i++)
        await page.evaluate(() => window.__integration.session.loadUser());
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
      assert.ok(
        gate.count() >= 2,
        'Remount must create old and current abort-ignoring HTTP work',
      );
      await gate.release();
      await page.waitForFunction(() => window.__cartWrites === 1);
      for (let i = 0; i < 3; i++)
        await page.evaluate(() => window.__integration.session.loadUser());
      await frame(page);
      assert.equal(await writes(page), 1);
      assert.equal(
        (await stored(page)).items.find((item) => item.menuId === 1).quantity,
        2,
      );
    },
  );
  await scenario(
    'D2: component cleanup blocks delayed responses and pending add after remount',
    async (page, cleanups) => {
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      await page.evaluate(() => window.__integration.unmount());
      await gate.release();
      await page.evaluate(() => window.__integration.mount());
      await page.locator('[data-menu-id="1"]').waitFor();
      await frame(page);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'D3: closing selected detail explicitly cancels post-login waiting action',
    async (page, cleanups) => {
      const { gate, detail } = await pending(page, cleanups);
      await loginModal(page);
      await detail.getByRole('button', { name: '메뉴 상세 닫기' }).click();
      await gate.release();
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'E1: failed catalog never mutates storage; UI retry validates fresh data before one add',
    async (page) => {
      let offline = true;
      await page.route('**/api/v1/menus/2', (route) =>
        offline
          ? route.fulfill({
              status: 503,
              json: { success: false, errorCode: 'INTERNAL_ERROR' },
            })
          : route.fulfill({ json: response(9000) }),
      );
      await page.goto(fixture.url + '#menu-list');
      const detail = await choose(page);
      await loginModal(page);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
      await detail.getByRole('button', { name: '장바구니 보기' }).click();
      const cart = page.locator('.cart-modal');
      await cart
        .getByText('장바구니를 확인하지 못했어요', { exact: true })
        .waitFor();
      assert.equal(await cart.getByLabel('장바구니 전체 합계').count(), 0);
      offline = false;
      await cart.getByRole('button', { name: '다시 확인' }).click();
      await page.waitForFunction(() => window.__cartWrites === 1);
      await cart
        .getByLabel('장바구니 전체 합계')
        .filter({ hasText: '27,000원' })
        .waitFor();
      assert.equal((await stored(page)).items.length, 2);
    },
  );
  await scenario(
    'E2: retry result wins over older abort-ignoring catalog success',
    async (page, cleanups) => {
      const gate = await blockCatalog(page);
      cleanups.push(gate.cleanup);
      await page.goto(fixture.url + '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      await sessionLogin(page);
      // Replace the handler for the retry while the old request remains blocked.
      await page.route('**/api/v1/menus/2', (route) =>
        route.fulfill({ json: response(10000) }),
      );
      await page.locator('.cart-nav').click();
      const total = page.getByLabel('장바구니 전체 합계', { exact: true });
      await total.filter({ hasText: '10,000원' }).waitFor();
      await gate.release();
      assert.equal(await total.textContent(), '10,000원');
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
  await scenario(
    'E3: waiting selection is revalidated and PAUSED response cannot be added',
    async (page, cleanups) => {
      let details = 0;
      await page.route('**/api/v1/menus/1', (route) => {
        details++;
        return route.fulfill({
          json: {
            success: true,
            data: {
              ...menus.find((menu) => menu.id === 1),
              imageUrl: null,
              description: null,
              status: details === 1 ? 'ON_SALE' : 'PAUSED',
            },
            message: 'OK',
          },
        });
      });
      const { gate } = await pending(page, cleanups);
      await loginModal(page);
      await gate.release();
      await page
        .getByText('현재 담을 수 없는 메뉴입니다.', { exact: true })
        .first()
        .waitFor();
      assert.ok(details >= 2);
      assert.deepEqual(await stored(page), original);
      assert.equal(await writes(page), 0);
    },
  );
} finally {
  await browser.close();
  await fixture.close();
}
await writeFile(
  resolve(output, 'results.json'),
  JSON.stringify({ results }, null, 2),
);
console.log(
  JSON.stringify({
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  }),
);
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
