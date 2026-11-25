// Actual Chromium + the existing loopback Menu/Auth/Checkout fixture; no dev claims.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.HOME_QA_OUTPUT);
await mkdir(output, { recursive: true });
const normal = {
  level: 'NORMAL',
  waitingCount: 0,
  cookingCount: 0,
  expectedWaitSec: 0,
};
const crowded = {
  level: 'CROWDED',
  waitingCount: 12,
  cookingCount: 1,
  expectedWaitSec: 901,
};
const controls = {},
  calls = [];
const fixture = await startCustomerHttpFixture({
  input: resolve('tests/integration-boundary-entry.jsx'),
  async handleRequest(req, res, user) {
    const path = req.url.split('?')[0];
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: status === 200,
          data,
          message: 'HTTP fixture only',
        }),
      );
    };
    if (path === '/api/v1/cooking/congestion') {
      calls.push({ path, headers: req.headers });
      const data = structuredClone(controls.data),
        status = controls.status,
        delay = controls.delay;
      if (delay) await new Promise((done) => setTimeout(done, delay));
      send(status, data);
      return true;
    }
    if (path === '/api/v1/orders' && req.method === 'GET') {
      calls.push({ path, user: user?.id });
      const delay = controls.ordersDelay;
      if (delay) await new Promise((done) => setTimeout(done, delay));
      if (!user) send(401, null);
      else if (user.role !== 'CUSTOMER') send(403, null);
      else
        send(200, {
          page: 0,
          size: 20,
          totalElements: controls.empty ? 0 : 1,
          items: controls.empty
            ? []
            : [
                {
                  orderId: user.id,
                  orderNo: `HOME-${user.id}`,
                  status: 'PAID',
                  orderedAt: '2026-11-23T09:00:00Z',
                  totalAmount: 9000,
                  itemCount: 1,
                  representativeMenuName: `사용자${user.id} 주문`,
                },
              ],
        });
      return true;
    }
    if (/^\/api\/v1\/orders\/\d+$/.test(path) && req.method === 'GET') {
      const id = Number(path.split('/').at(-1));
      if (fixture.orders.has(id)) return false;
      if (!user) send(401, null);
      else if (id !== user.id) send(404, null);
      else
        send(200, {
          orderId: id,
          orderNo: `HOME-${id}`,
          status: 'PAID',
          orderedAt: '2026-11-23T09:00:00Z',
          totalAmount: 9000,
          items: [
            {
              menuId: 1,
              menuName: '클래식 버거',
              unitPrice: 6500,
              quantity: 1,
              lineAmount: 9000,
              options: [{ optionId: 2, optionName: '세트', extraPrice: 2500 }],
            },
          ],
          cooking: {
            lookup: 'OK',
            status: 'WAITING',
            expectedWaitSec: 120,
            expectedReadySec: 360,
          },
        });
      return true;
    }
    return false;
  },
});
const browser = await chromium.launch({ headless: true });
let context, page, errors;
const results = [];
async function fresh(hash = '', width = 1440, clock = false) {
  await context?.close();
  Object.assign(controls, {
    data: normal,
    status: 200,
    delay: 0,
    ordersDelay: 0,
    empty: false,
  });
  calls.length = 0;
  context = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : 1000 },
  });
  page = await context.newPage();
  if (clock) await page.clock.install();
  page.setDefaultTimeout(5000);
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'peak-order.cart.v1',
      JSON.stringify({
        version: 1,
        items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
      }),
    ),
  );
  await page.goto(fixture.url + hash);
  await page.waitForFunction(
    () => window.__integration.session.getSnapshot().phase === 'anonymous',
  );
}
const home = () => page.locator('.customer-home');
const congestion = () => page.locator('.congestion-card');
const publicCalls = () => calls.filter((c) => c.path.endsWith('/congestion'));
async function login(email = 'customer@example.test') {
  if (!(await page.locator('.login-modal').count()))
    await page
      .locator('.customer-header')
      .getByRole('button', { name: '로그인', exact: true })
      .click();
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type=submit]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    assert.ok(
      publicCalls().every(
        (c) =>
          !c.headers.authorization &&
          !c.headers.cookie &&
          !c.headers['x-user-id'] &&
          !c.headers['x-user-role'],
      ),
    );
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
    await page
      .screenshot({ path: resolve(output, `FAIL-${results.length}.png`) })
      .catch(() => {});
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  await check(
    'initial anonymous home, exact public zero response, logo and keyboard skip link',
    async () => {
      await fresh();
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      assert.equal(
        await home().getByRole('button', { name: '로그인' }).count(),
        0,
      );
      assert.equal(calls.filter((c) => c.path === '/api/v1/orders').length, 0);
      await page.getByRole('link', { name: '메뉴 둘러보기' }).click();
      await page.locator('[data-menu-id="1"]').waitFor();
      await page
        .getByRole('link', { name: '피크오더 홈', exact: true })
        .click();
      await home().waitFor();
      await page.locator('.skip-link').focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        'home-heading',
      );
      assert.equal(await page.evaluate(() => location.hash), '#home');
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, 'home-desktop.png') });
    },
  );
  await check(
    'crowded counts and 15m1s start-wait, never completion-time claim',
    async () => {
      controls.data = crowded;
      await page.getByRole('button', { name: '혼잡도 새로고침' }).click();
      await congestion().getByText('약 15분 1초', { exact: true }).waitFor();
      assert.match(await congestion().innerText(), /12건/);
      assert.match(await congestion().innerText(), /혼잡/);
    },
  );
  await check(
    'HTTP failure marks prior data stale; explicit retry restores zero',
    async () => {
      controls.status = 503;
      await page.getByRole('button', { name: '혼잡도 새로고침' }).click();
      await congestion().getByRole('alert').waitFor();
      assert.match(await congestion().innerText(), /마지막 확인 정보/);
      controls.status = 200;
      controls.data = normal;
      await page.getByRole('button', { name: '혼잡도 다시 시도' }).click();
      await congestion().getByText('약 0초', { exact: true }).waitFor();
    },
  );
  await check(
    'invalid first response never fabricates NORMAL or zero and can retry',
    async () => {
      await fresh('#menu-list');
      controls.data = { ...normal, expectedWaitSec: -1 };
      await page.getByRole('link', { name: '홈', exact: true }).click();
      await congestion().getByRole('alert').waitFor();
      assert.equal(await congestion().locator('dl').count(), 0);
      controls.data = crowded;
      await page.getByRole('button', { name: '혼잡도 다시 시도' }).click();
      await congestion().getByText('약 15분 1초', { exact: true }).waitFor();
    },
  );
  await check(
    'home-only 30s polling pauses hidden, returns fresh, and stops after departure',
    async () => {
      await fresh('#home', 1440, true);
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      const before = publicCalls().length;
      await page.clock.runFor(30010);
      await page.waitForFunction(
        () =>
          document
            .querySelector('.congestion-card')
            ?.getAttribute('aria-busy') === 'false',
      );
      assert.equal(publicCalls().length, before + 1);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.runFor(90000);
      assert.equal(publicCalls().length, before + 1);
      controls.data = crowded;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await congestion().getByText('약 15분 1초', { exact: true }).waitFor();
      await page.getByRole('link', { name: '메뉴 둘러보기' }).click();
      const count = publicCalls().length;
      await page.clock.runFor(90000);
      assert.equal(publicCalls().length, count);
    },
  );
  await check(
    'slow old congestion response cannot replace a new home visit; duplicate refresh blocked',
    async () => {
      await fresh('#menu-list');
      controls.delay = 350;
      controls.data = crowded;
      await page.getByRole('link', { name: '홈', exact: true }).click();
      await page.waitForTimeout(70);
      assert.equal(
        await page
          .getByRole('button', { name: '혼잡도 새로고침' })
          .isDisabled(),
        true,
      );
      await page.getByRole('link', { name: '메뉴 둘러보기' }).click();
      controls.delay = 0;
      controls.data = normal;
      await page.getByRole('link', { name: '홈', exact: true }).click();
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      await page.waitForTimeout(400);
      assert.equal(
        await congestion().getByText('약 15분 1초', { exact: true }).count(),
        0,
      );
    },
  );
  await check(
    'CUSTOMER recent OR-03, detail URL and logout fences old user data',
    async () => {
      await fresh();
      await login();
      await home().getByText('사용자1 주문', { exact: true }).waitFor();
      await page.getByRole('button', { name: '혼잡도 새로고침' }).click();
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      await page.getByRole('link', { name: '최근 주문 상세 보기' }).click();
      await page.waitForFunction(() => location.hash === '#orders/1');
      await page
        .locator('.order-detail-modal')
        .getByText('총 금액', { exact: true })
        .waitFor();
      // Detail is modal: browser History leaves it without bypassing modal focus.
      await page.goBack();
      await home().waitFor();
      controls.ordersDelay = 300;
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
      await page.waitForTimeout(350);
      assert.equal(
        await home().getByText('사용자1 주문', { exact: true }).count(),
        0,
      );
    },
  );
  await check(
    'session switch and batched logout/login never reveal prior recent order',
    async () => {
      await fresh();
      await login();
      await home().getByText('사용자1 주문', { exact: true }).waitFor();
      controls.ordersDelay = 200;
      await page.evaluate(() =>
        window.__integration.session.login({
          email: 'other@example.test',
          password: 'fixture-only-password',
        }),
      );
      await home().getByText('사용자3 주문', { exact: true }).waitFor();
      assert.equal(
        await home().getByText('사용자1 주문', { exact: true }).count(),
        0,
      );
      await page.evaluate(async () => {
        const s = window.__integration.session;
        await s.logout();
        await s.login({
          email: 'other@example.test',
          password: 'fixture-only-password',
        });
      });
      await home().getByText('사용자3 주문', { exact: true }).waitFor();
    },
  );
  await check(
    'late recent-order responses after logout or switch never leak previous identity',
    async () => {
      for (const action of ['logout', 'switch']) {
        await fresh();
        controls.ordersDelay = 300;
        await login();
        assert.equal(
          await home().getByText('사용자1 주문', { exact: true }).count(),
          0,
        );
        await page.evaluate(
          (action) =>
            action === 'logout'
              ? window.__integration.session.logout()
              : window.__integration.session.login({
                  email: 'other@example.test',
                  password: 'fixture-only-password',
                }),
          action,
        );
        if (action === 'switch')
          await home().getByText('사용자3 주문', { exact: true }).waitFor();
        else {
          await page
            .getByRole('button', { name: '로그인', exact: true })
            .waitFor();
          await page.waitForTimeout(350);
        }
        assert.equal(
          await home().getByText('사용자1 주문', { exact: true }).count(),
          0,
        );
      }
    },
  );
  await check(
    'recent empty list is honest and reload restores authenticated home',
    async () => {
      await fresh();
      controls.empty = true;
      await login();
      await home()
        .getByText('아직 주문 내역이 없어요.', { exact: true })
        .waitFor();
      await page.reload();
      await home()
        .getByText('아직 주문 내역이 없어요.', { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .count(),
        1,
      );
    },
  );
  await check(
    'STORE_ADMIN sees customer restriction and never fetches own customer orders',
    async () => {
      await fresh();
      await login('admin@example.test');
      await home()
        .locator('.home-card')
        .getByText('주문하려면 고객용 계정으로 로그인해 주세요.')
        .waitFor();
      assert.equal(calls.filter((c) => c.path === '/api/v1/orders').length, 0);
    },
  );
  await check(
    'menu filters and detail option/quantity survive home/back; cart close returns home',
    async () => {
      await fresh('#menu-list');
      await page.getByLabel('메뉴 검색', { exact: true }).fill('버거');
      await page.locator('[data-menu-id="1"]').click();
      const d = page.locator('.detail-modal');
      await d.locator('input[value="2"]').check();
      await d.getByRole('button', { name: '수량 늘리기', exact: true }).click();
      await page.evaluate(() => {
        location.hash = '#home';
      });
      await home().waitFor();
      assert.equal(await page.locator('.detail-modal[open]').count(), 0);
      await page.goBack();
      await d.waitFor();
      assert.equal(await d.locator('input[value="2"]').isChecked(), true);
      assert.equal(
        await d.getByLabel('선택 수량', { exact: true }).innerText(),
        '2',
      );
      await d.getByRole('button', { name: '메뉴 상세 닫기' }).click();
      assert.equal(
        await page.getByLabel('메뉴 검색', { exact: true }).inputValue(),
        '버거',
      );
      await page.getByRole('link', { name: '홈', exact: true }).click();
      await home().getByRole('button', { name: '장바구니 보기' }).click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '홈으로 돌아가기' })
        .click();
      await home().waitFor();
    },
  );
  await check(
    'mobile common nav, reload/deep links and no overflow at 390/320',
    async () => {
      for (const width of [390, 320]) {
        await fresh('#home', width);
        await congestion().getByText('약 0초', { exact: true }).waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        for (const item of await page.locator('.sidebar .nav-item').all()) {
          const box = await item.boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width);
        }
        await page.getByRole('link', { name: '메뉴 둘러보기' }).click();
        await page.locator('[data-menu-id="1"]').waitFor();
        await page.reload();
        await page.locator('[data-menu-id="1"]').waitFor();
        await page
          .getByRole('link', { name: '피크오더 홈', exact: true })
          .click();
        await home().waitFor();
        await congestion().getByText('약 0초', { exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, `home-${width}.png`) });
      }
    },
  );
  await check(
    'home to menu to cart to authenticated Checkout and order detail preserves single payment',
    async () => {
      await fresh();
      await page.getByRole('link', { name: '메뉴 둘러보기' }).click();
      await page.locator('.cart-nav').click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await login();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page
        .getByRole('button', { name: '주문 내역에서 확인', exact: true })
        .click();
      await page
        .locator('.order-detail-modal')
        .getByText('총 금액', { exact: true })
        .waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        1,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        { version: 1, items: [] },
      );
      await page.goBack();
      await page.goForward();
      assert.equal(await page.locator('.checkout-page').count(), 0);
    },
  );
  await check(
    'CO-01 browser timeout is unknown, retry succeeds; checkout reload never creates an order',
    async () => {
      await fresh('#menu-list');
      controls.delay = 11000;
      await page.getByRole('link', { name: '홈', exact: true }).click();
      await congestion()
        .getByText('혼잡도 조회 시간이 초과됐어요. 다시 시도해 주세요.', {
          exact: true,
        })
        .waitFor({ timeout: 12000 });
      assert.equal(await congestion().locator('dl').count(), 0);
      controls.delay = 0;
      await page.getByRole('button', { name: '혼잡도 다시 시도' }).click();
      await congestion().getByText('약 0초', { exact: true }).waitFor();
      await page.goto(fixture.url + '#checkout');
      await page.waitForFunction(() => location.hash === '#menu-list');
      assert.equal(await page.locator('.checkout-page').count(), 0);
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        note: 'Chromium + loopback HTTP fixture, not dev Gateway E2E.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1;
