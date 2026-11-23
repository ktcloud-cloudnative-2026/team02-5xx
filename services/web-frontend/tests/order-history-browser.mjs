// Issue #236 only: reuse #233's Auth/Menu/Checkout loopback fixture and App entry.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.ORDER_HISTORY_QA_OUTPUT);
await mkdir(output, { recursive: true });
const records = new Map(),
  calls = [],
  controls = {};
const sample = (id) => ({
  orderId: id,
  orderNo: `TEST-${id}`,
  status: 'PAID',
  orderedAt: '2026-11-23T09:00:00+09:00',
  paidAt: '2026-11-23T09:01:00+09:00',
  totalAmount: 18000,
  items: [
    {
      menuId: 1,
      menuName: '클래식 버거',
      unitPrice: 6500,
      quantity: 2,
      lineAmount: 18000,
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
function reset() {
  records.clear();
  for (let i = 1; i <= 21; i++) records.set(i, sample(i));
  records.get(2).cooking.status = 'COOKING';
  records.get(2).cooking.startedAt = '2026-11-23T09:02:00+09:00';
  records.get(2).cooking.expectedWaitSec = 0;
  records.get(3).status = 'COMPLETED';
  records.get(4).status = 'CANCELED';
  delete records.get(4).orderNo;
  delete records.get(4).paidAt;
  records.get(5).cooking = { lookup: 'PENDING' };
  records.get(6).cooking = { lookup: 'UNAVAILABLE' };
  records.get(7).cooking.status = 'DONE';
  Object.assign(controls, {
    listStatus: 200,
    empty: false,
    cancel: 'success',
    delay: 0,
  });
  calls.length = 0;
}
reset();
let fixture;
fixture = await startCustomerHttpFixture({
  input: resolve('tests/integration-boundary-entry.jsx'),
  async handleRequest(req, res, user) {
    const url = new URL(req.url, 'http://fixture');
    if (
      !url.pathname.startsWith('/api/v1/orders') ||
      (req.method === 'POST' && !url.pathname.endsWith('/cancel'))
    )
      return false;
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({
      path: url.pathname,
      method: req.method,
      body,
      hasIdentity: 'x-user-id' in req.headers,
    });
    const send = (status, data, errorCode) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: status === 200,
          data,
          ...(errorCode ? { errorCode } : {}),
        }),
      );
    };
    if (!user) {
      send(401, null, 'UNAUTHORIZED');
      return true;
    }
    if (user.role !== 'CUSTOMER') {
      send(403, null, 'FORBIDDEN');
      return true;
    }
    const owned = user.id === 1;
    if (url.pathname === '/api/v1/orders') {
      if (controls.listStatus !== 200) {
        send(
          controls.listStatus,
          null,
          controls.listStatus === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
        );
        return true;
      }
      const all =
        owned && !controls.empty
          ? [...records.values(), ...fixture.orders.values()]
              .filter((o) => !['CREATED', 'FAILED'].includes(o.status))
              .sort((a, b) => b.orderId - a.orderId)
          : [];
      const page = Number(url.searchParams.get('page')),
        size = 20;
      send(200, {
        page,
        size,
        totalElements: all.length,
        items: all.slice(page * size, (page + 1) * size).map((o) => ({
          orderId: o.orderId,
          orderNo: o.orderNo,
          status: o.status,
          totalAmount: o.totalAmount,
          orderedAt: o.orderedAt,
          itemCount: o.items.length,
          representativeMenuName: o.items[0].menuName,
        })),
      });
      return true;
    }
    const id = Number(url.pathname.split('/')[4]),
      order = owned ? (records.get(id) ?? fixture.orders.get(id)) : null;
    if (!order) {
      send(404, null, 'ORDER_NOT_FOUND');
      return true;
    }
    if (req.method === 'GET') {
      send(200, order);
      return true;
    }
    if (controls.delay)
      await new Promise((done) => setTimeout(done, controls.delay));
    if (controls.cancel === 'race') {
      order.cooking = {
        lookup: 'OK',
        status: 'COOKING',
        expectedWaitSec: 0,
        expectedReadySec: 180,
      };
      send(409, null, 'COOKING_ALREADY_STARTED');
    } else if (controls.cancel === 'unknown')
      send(503, null, 'COOKING_SERVICE_UNAVAILABLE');
    else {
      Object.assign(order, {
        status: 'CANCELED',
        canceledAt: new Date().toISOString(),
        cooking: undefined,
      });
      send(200, order);
    }
    return true;
  },
});
const browser = await chromium.launch({ headless: true });
let context, page, errors;
const results = [];
const stored = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
async function fresh(hash = '#orders', mobile = false, clock = false) {
  await context?.close();
  reset();
  fixture.orders.clear();
  fixture.requests.length = 0;
  context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  if (clock) await page.clock.install();
  page.setDefaultTimeout(5000);
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (cart) => localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
    stored,
  );
  const restored = page.waitForResponse((r) =>
    r.url().includes('/api/v1/auth/refresh'),
  );
  await page.goto(fixture.url + hash);
  await restored;
  await page.waitForFunction(
    () => window.__integration.session.getSnapshot().phase === 'anonymous',
  );
}
async function login(email = 'customer@example.test') {
  await page.getByRole('button', { name: '고객 로그인', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type=submit]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
const modal = () => page.locator('.order-detail-modal');
async function ready(id = 1) {
  await fresh(`#orders/${id}`);
  await login();
  await modal().getByText('총 금액', { exact: true }).waitFor();
}
const posts = () => calls.filter((c) => c.method === 'POST');
async function cancel() {
  await modal().getByRole('button', { name: '주문 취소', exact: true }).click();
  await page
    .getByRole('dialog', { name: '주문을 취소할까요?' })
    .getByRole('button', { name: '취소 요청 확인' })
    .click();
}
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    assert.ok(calls.every((c) => !c.hasIdentity));
    assert.ok(posts().every((c) => c.body === ''));
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
    'anonymous gate, login, list pagination, detail close/back and page refresh',
    async () => {
      await fresh();
      assert.equal(calls.length, 0);
      await login();
      await page.locator('.order-card').first().waitFor();
      assert.equal(await page.locator('.order-card').count(), 20);
      await page.screenshot({ path: resolve(output, 'orders-desktop.png') });
      await page.getByRole('button', { name: '다음 페이지' }).click();
      await page
        .getByRole('heading', { name: '주문번호 TEST-1', exact: true })
        .waitFor();
      await page
        .locator('.order-card')
        .getByRole('link', { name: '상세 보기 ›' })
        .click();
      await modal().getByText('총 금액', { exact: true }).waitFor();
      await page.reload();
      await modal().getByText('총 금액', { exact: true }).waitFor();
      await page.getByRole('button', { name: '주문 상세 닫기' }).click();
      await page
        .getByRole('heading', { name: '주문번호 TEST-1', exact: true })
        .waitFor();
      assert.match(page.url(), /page=1/);
      await page.waitForFunction(
        () => document.activeElement?.dataset.orderLink === '1',
      );
    },
  );
  await check(
    'detail uses base/option prices, Cooking times, confirmation and one cancellation',
    async () => {
      await ready();
      await modal().getByText('기본가 6,500원').waitFor();
      await modal().getByText('세트 +2,500원').waitFor();
      await modal().getByText('약 2분 후').waitFor();
      await modal().getByText('약 6분 후').waitFor();
      await page.screenshot({
        path: resolve(output, 'order-detail-desktop.png'),
      });
      await modal()
        .getByRole('button', { name: '주문 취소', exact: true })
        .click();
      await page.getByRole('button', { name: '돌아가기', exact: true }).click();
      assert.equal(posts().length, 0);
      controls.delay = 100;
      await modal()
        .getByRole('button', { name: '주문 취소', exact: true })
        .click();
      await page
        .getByRole('button', { name: '취소 요청 확인' })
        .evaluate((b) => {
          b.click();
          b.click();
        });
      await modal().getByText('취소됨', { exact: true }).waitFor();
      assert.equal(posts().length, 1);
      assert.equal(posts()[0].path, '/api/v1/orders/1/cancel');
      await modal()
        .getByText('환불과 재고 복원 완료를 의미하지는 않습니다.', {
          exact: false,
        })
        .waitFor();
    },
  );
  await check(
    'Cooking pending/unavailable/started/done and Order completed do not enable cancellation',
    async () => {
      await ready(2);
      for (const [id, label] of [
        [2, '조리 중'],
        [5, '조리 접수 대기'],
        [6, '조리 상태 확인 필요'],
        [7, '픽업 대기'],
        [3, '완료'],
        [4, '취소됨'],
      ]) {
        await page.evaluate((id) => {
          location.hash = `#orders/${id}`;
        }, id);
        await modal()
          .locator('.order-badge')
          .getByText(label, { exact: true })
          .waitFor();
        assert.equal(
          await modal()
            .getByRole('button', { name: '주문 취소', exact: true })
            .isDisabled(),
          true,
        );
        if (id === 2 || id === 7)
          await modal().getByText('시작됨', { exact: true }).waitFor();
        if (id === 7)
          await modal().getByText('조리 완료', { exact: true }).waitFor();
      }
      assert.equal(posts().length, 0);
    },
  );
  await check(
    'empty list and failed list retry preserve pagination meaning',
    async () => {
      await fresh();
      controls.listStatus = 500;
      await login();
      await page
        .getByText('주문 요청을 완료하지 못했어요.', { exact: false })
        .waitFor();
      controls.listStatus = 200;
      controls.empty = true;
      await page
        .getByRole('button', { name: '다시 조회', exact: true })
        .click();
      await page.getByText('아직 주문 내역이 없어요').waitFor();
      assert.equal(await page.locator('.order-card').count(), 0);
    },
  );
  await check(
    'admin sends no Order request and HTTP 403 stays a permission error',
    async () => {
      await fresh();
      await login('admin@example.test');
      await page
        .getByText('주문 내역은 CUSTOMER 계정만 확인할 수 있어요.')
        .waitFor();
      assert.equal(calls.length, 0);
      await fresh();
      controls.listStatus = 403;
      await login();
      await page
        .getByText('주문 요청 권한 또는 요청 출처가 허용되지 않았어요.')
        .waitFor();
      assert.equal(
        await page.getByRole('button', { name: '고객 로그인' }).count(),
        0,
      );
    },
  );
  await check(
    'safe GET 401 refreshes once and restores only the current CUSTOMER',
    async () => {
      await fresh();
      let once = true;
      await page.route('**/api/v1/orders?*', async (route) => {
        if (once) {
          once = false;
          await route.fulfill({
            status: 401,
            json: { success: false, errorCode: 'UNAUTHORIZED' },
          });
        } else await route.continue();
      });
      const before = fixture.counts.refresh;
      await login();
      await page.locator('.order-card').first().waitFor();
      assert.equal(fixture.counts.refresh, before + 1);
    },
  );
  await check(
    'cancel race reloads authoritative Cooking status without inventing cancellation',
    async () => {
      await ready();
      controls.cancel = 'race';
      await cancel();
      await modal().getByText('조리가 시작되어 취소할 수 없어요.').waitFor();
      await modal()
        .locator('.order-badge')
        .getByText('조리 중', { exact: true })
        .waitFor();
      assert.equal(posts().length, 1);
      await modal()
        .getByRole('button', { name: '취소 결과 다시 확인' })
        .click();
      await modal()
        .getByRole('button', { name: '주문 취소', exact: true })
        .waitFor();
      assert.equal(
        await modal()
          .getByRole('button', { name: '주문 취소', exact: true })
          .isDisabled(),
        true,
      );
    },
  );
  await check(
    'uncertain cancel is not retried automatically; explicit review and confirmation can retry',
    async () => {
      await ready();
      controls.cancel = 'unknown';
      await cancel();
      await modal()
        .getByText('취소 요청 결과를 확인하지 못했어요.', { exact: false })
        .waitFor();
      assert.equal(posts().length, 1);
      await page.waitForTimeout(100);
      assert.equal(posts().length, 1);
      await modal()
        .locator('.order-badge')
        .getByText('조리 대기', { exact: true })
        .waitFor();
      controls.cancel = 'success';
      await modal()
        .getByRole('button', { name: '취소 결과 다시 확인' })
        .click();
      await cancel();
      await modal().getByText('취소됨', { exact: true }).waitFor();
      assert.equal(posts().length, 2);
    },
  );
  await check(
    'direct missing order and invalid route do not fabricate order data',
    async () => {
      await ready();
      await page.evaluate(() => {
        location.hash = '#orders/999';
      });
      await modal()
        .getByText('주문을 찾을 수 없어요.', { exact: false })
        .waitFor();
      assert.equal(
        await modal().getByText('총 금액', { exact: true }).count(),
        0,
      );
      await page.evaluate(() => {
        location.hash = '#orders/../../9';
      });
      await page
        .getByRole('heading', { name: '주문 주소를 확인해 주세요' })
        .waitFor();
      assert.equal(await page.locator('.order-detail-modal').count(), 0);
    },
  );
  await check(
    'mobile modal scroll, Escape focus and navigation to existing public cart',
    async () => {
      await fresh('#orders/1', true);
      await login();
      await modal().getByText('총 금액', { exact: true }).waitFor();
      assert.ok(
        await modal().evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
      );
      await page.screenshot({
        path: resolve(output, 'order-detail-mobile.png'),
      });
      await page.keyboard.press('Escape');
      await page.locator('.order-card').first().waitFor();
      await page.locator('.cart-nav').click();
      await page.locator('.cart-modal').waitFor();
      assert.equal(await page.locator('.orders-page').count(), 0);
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
        .click();
      await page.locator('.orders-page .order-card').first().waitFor();
      await page.setViewportSize({ width: 320, height: 700 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({ path: resolve(output, 'orders-mobile-320.png') });
    },
  );
  for (const action of ['logout', 'switch', 'close'])
    await check(
      `late cancellation after ${action} does not resurrect or leak order data`,
      async () => {
        await ready();
        let release, received;
        const gate = new Promise((done) => {
            release = done;
          }),
          arrived = new Promise((done) => {
            received = done;
          });
        await page.route('**/api/v1/orders/1/cancel', async (route) => {
          const response = await route.fetch();
          received();
          await gate;
          await route.fulfill({ response }).catch(() => {});
        });
        await cancel();
        await arrived;
        if (action === 'close')
          await page.getByRole('button', { name: '주문 상세 닫기' }).click();
        else
          await page.evaluate(async (action) => {
            await window.__integration.session.logout();
            if (action === 'switch')
              await window.__integration.session.login({
                email: 'other@example.test',
                password: 'fixture-only-password',
              });
          }, action);
        release();
        await page.waitForTimeout(120);
        assert.equal(
          await page.locator('.order-detail-modal .order-lines').count(),
          0,
        );
        if (action === 'logout')
          await page.getByRole('button', { name: '고객 로그인' }).waitFor();
        if (action === 'switch')
          await modal()
            .getByText('주문을 찾을 수 없어요.', { exact: false })
            .waitFor();
        assert.equal(posts().length, 1);
      },
    );
  await check(
    'Checkout HTTP completion links to the same order without replaying checkout',
    async () => {
      await fresh();
      await login();
      await page.getByRole('link', { name: '메뉴', exact: true }).click();
      await page.locator('.cart-nav').click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .getByRole('button', { name: '임시 주문 만들기', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page
        .getByRole('button', { name: '주문 내역에서 확인', exact: true })
        .click();
      await modal().getByText('총 금액', { exact: true }).waitFor();
      assert.match(page.url(), /#orders\/101$/);
      assert.equal(await page.locator('.checkout-page').count(), 0);
      await page.goBack();
      await page.goForward();
      assert.ok(!page.url().includes('#checkout'));
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        1,
      );
    },
  );
  await check(
    'Cooking DONE continues polling until Order COMPLETED, then stops',
    async () => {
      await fresh('#orders/7', false, true);
      await login();
      await modal()
        .locator('.order-badge')
        .getByText('픽업 대기', { exact: true })
        .waitFor();
      const before = calls.filter((c) => c.path === '/api/v1/orders/7').length;
      const polled = page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/orders/7'),
      );
      await page.clock.fastForward(10020);
      await polled;
      await page.waitForTimeout(80);
      assert.ok(
        calls.filter((c) => c.path === '/api/v1/orders/7').length > before,
      );
      records.get(7).status = 'COMPLETED';
      const completed = page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/orders/7'),
      );
      await page.clock.fastForward(10020);
      await completed;
      await modal()
        .locator('.order-badge')
        .getByText('완료', { exact: true })
        .waitFor();
      const stopped = calls.length;
      await page.clock.fastForward(20020);
      assert.equal(calls.length, stopped);
    },
  );
  await check(
    'cancel POST 401 logs out without refresh or automatic POST replay',
    async () => {
      await ready();
      const before = fixture.counts.refresh;
      let posts = 0;
      await page.route('**/api/v1/orders/1/cancel', async (route) => {
        posts++;
        await route.fulfill({
          status: 401,
          json: { success: false, errorCode: 'UNAUTHORIZED' },
        });
      });
      await cancel();
      await page
        .getByRole('button', { name: '고객 로그인', exact: true })
        .waitFor();
      assert.equal(posts, 1);
      assert.equal(fixture.counts.refresh, before);
      assert.equal(await page.locator('.order-detail-modal').count(), 0);
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        pass: results.filter((r) => r.status === 'PASS').length,
        fail: results.filter((r) => r.status === 'FAIL').length,
        note: 'Actual Chromium + reused #233 loopback HTTP fixture. No actual dev Gateway/Auth/Order success.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
