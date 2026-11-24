import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.CUSTOMER_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startCustomerHttpFixture({
  input: resolve('tests/integration-boundary-entry.jsx'),
});
const browser = await chromium.launch({ headless: true });
const results = [];
let context, page, errors, consoleErrors, networkFailures;
const original = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
async function fresh(
  scenario = 'success',
  mobile = false,
  initialCart = original,
) {
  await context?.close();
  Object.assign(fixture.checkoutControls, {
    scenario,
    delay: 0,
    priceDelta: 0,
  });
  fixture.requests.length = 0;
  context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  errors = [];
  consoleErrors = [];
  networkFailures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
      if (!message.text().includes('Failed to load resource'))
        errors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    networkFailures.push(failure);
    if (!failure.includes('ERR_ABORTED')) errors.push(failure);
  });
  await page.route('**/api/v1/menus/*', async (route) => {
    const id = Number(
      new URL(route.request().url()).pathname.split('/').at(-1),
    );
    if (id >= 101 && id <= 121)
      await route.fulfill({
        json: {
          success: true,
          data: {
            id,
            categoryId: 1,
            name: `계약 메뉴 ${id}`,
            description: null,
            imageUrl: null,
            basePrice: 6500,
            status: 'ON_SALE',
            options: [
              {
                id: 1,
                name: '단품',
                extraPrice: 0,
                active: true,
                isDefault: true,
              },
            ],
          },
          message: 'Contract only',
        },
      });
    else await route.continue();
  });
  await page.addInitScript((value) => {
    if (localStorage.getItem('peak-order.cart.v1') === null)
      localStorage.setItem('peak-order.cart.v1', JSON.stringify(value));
  }, initialCart);
  await page.goto(fixture.url + '#menu-list');
  await page.locator('[data-menu-id="1"]').waitFor();
}
async function login(email = 'customer@example.test') {
  if (!(await page.locator('.login-modal').count()))
    await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function enterCart() {
  await login();
  await page.locator('.header-cart').click();
  await page
    .locator('.cart-modal')
    .getByRole('button', { name: '주문하기', exact: true })
    .click();
  await page
    .getByRole('button', { name: '임시 주문 만들기', exact: true })
    .waitFor();
}
async function create() {
  await page
    .getByRole('button', { name: '임시 주문 만들기', exact: true })
    .click();
  await page.getByRole('button', { name: /원 모의 결제$/ }).waitFor();
}
async function pay() {
  await page.getByRole('button', { name: /원 모의 결제$/ }).click();
}
const cart = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('peak-order.cart.v1')));
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    assert.ok(fixture.requests.every((r) => !r.hasFakeIdentity));
    results.push({
      name,
      status: 'PASS',
      expectedHttpResourceErrors: consoleErrors.length,
      expectedCancelledRequests: networkFailures.length,
    });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await page.screenshot({
      path: resolve(output, `FAIL-${results.length}.png`),
    });
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  await check(
    'product Menu HTTP + Auth login + cart checkout + confirmed quantity cleanup + menu/history',
    async () => {
      await fresh();
      await enterCart();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        0,
      );
      await create();
      await page.screenshot({ path: resolve(output, 'checkout-desktop.png') });
      await pay();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await cart(), { version: 1, items: [] });
      assert.ok(
        fixture.requests
          .filter((r) => r.path.startsWith('/api/v1/orders'))
          .every((r) => r.hasBearer),
      );
      await page
        .locator('.payment-success')
        .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
        .click();
      await page.waitForFunction(() => location.hash === '#menu-list');
      await page.goBack();
      await page.goForward();
      assert.equal(await page.locator('.checkout-page').count(), 0);
    },
  );
  await check(
    'anonymous immediate order resumes selection once after login; existing cart unchanged; mobile',
    async () => {
      await fresh('success', true);
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('.detail-modal');
      await detail.locator('input[value="2"]').check();
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await login();
      await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      assert.match(await page.locator('.checkout-summary').innerText(), /× 2/);
      await create();
      assert.deepEqual(
        fixture.requests.find((r) => r.path === '/api/v1/orders').body,
        { items: original.items },
      );
      await page.screenshot({ path: resolve(output, 'checkout-mobile.png') });
      assert.ok(
        await page
          .locator('.checkout-page')
          .evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
      );
      await pay();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await cart(), original);
      await page
        .locator('.payment-success')
        .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll('dialog[open]').length === 0,
      );
    },
  );
  await check(
    'HTTP response loss then explicit state lookup confirms once and preserves added quantities',
    async () => {
      await fresh('unknown-paid');
      await enterCart();
      await create();
      await pay();
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .waitFor();
      assert.deepEqual(await cart(), original);
      await page.evaluate(() =>
        localStorage.setItem(
          'peak-order.cart.v1',
          JSON.stringify({
            version: 1,
            items: [{ menuId: 1, optionIds: [2], quantity: 5 }],
          }),
        ),
      );
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual((await cart()).items, [
        { menuId: 1, optionIds: [2], quantity: 3 },
      ]);
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        1,
      );
    },
  );
  await check(
    'CREATED lookup preserves cart and offers only explicit same-order recovery',
    async () => {
      await fresh('unknown');
      await enterCart();
      await create();
      await pay();
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .click();
      await page
        .getByText('아직 확정되지 않았어요.', { exact: false })
        .waitFor();
      assert.deepEqual(await cart(), original);
      assert.equal(
        await page
          .getByRole('button', { name: '같은 주문 처리 이어가기', exact: true })
          .isEnabled(),
        true,
      );
      assert.equal(
        await page.getByRole('button', { name: /원 모의 결제$/ }).count(),
        0,
      );
    },
  );
  for (const scenario of ['declined', 'stock', 'closed', 'unavailable'])
    await check(
      `HTTP ${scenario} shows explicit failure without cart mutation`,
      async () => {
        await fresh(scenario);
        await enterCart();
        await page
          .getByRole('button', { name: '임시 주문 만들기', exact: true })
          .click();
        if (scenario === 'declined') {
          await page.getByRole('button', { name: /원 모의 결제$/ }).click();
        }
        await page
          .getByRole('button', { name: '새 임시 주문으로 다시 확인' })
          .waitFor();
        assert.deepEqual(await cart(), original);
      },
    );
  await check(
    'server recalculated amount requires explicit confirmation before pay',
    async () => {
      await fresh();
      fixture.checkoutControls.priceDelta = 1000;
      await enterCart();
      await create();
      await page
        .getByText(
          '메뉴 가격이 변경되어 서버 확인 금액이 예상 금액과 달라요.',
          { exact: false },
        )
        .waitFor();
      assert.match(
        await page.locator('.checkout-summary').innerText(),
        /20,000원/,
      );
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        0,
      );
    },
  );
  await check('hold expiry disables pay and preserves cart', async () => {
    await fresh('expired');
    await enterCart();
    await create();
    assert.equal(
      await page.getByRole('button', { name: /원 모의 결제$/ }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: '만료 상태 확인' }).click();
    await page
      .getByRole('button', { name: '새 임시 주문으로 다시 확인' })
      .waitFor();
    assert.deepEqual(await cart(), original);
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
      0,
    );
  });
  await check(
    'estimate outage retries through HTTP without creating an order',
    async () => {
      await fresh('estimate-error');
      await enterCart();
      await page.getByRole('button', { name: '예상시간 다시 조회' }).waitFor();
      fixture.checkoutControls.scenario = 'success';
      await page.getByRole('button', { name: '예상시간 다시 조회' }).click();
      await create();
    },
  );
  await check(
    'real Refresh-cookie contract session restoration then logout revokes customer UI',
    async () => {
      await fresh();
      await login();
      const prior = fixture.counts.refresh;
      await page.reload();
      await page
        .getByRole('button', { name: '로그아웃', exact: true })
        .waitFor();
      assert.equal(fixture.counts.refresh, prior + 1);
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
      assert.deepEqual(await cart(), original);
    },
  );
  await check('STORE_ADMIN cannot enter checkout', async () => {
    await fresh();
    await login('admin@example.test');
    await page.locator('.header-cart').click();
    await page
      .locator('.cart-modal')
      .getByRole('button', { name: '주문하기', exact: true })
      .click();
    await page
      .getByText('주문·결제는 CUSTOMER 계정만 이용할 수 있어요.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator('.checkout-page').count(), 0);
    assert.equal(fixture.requests.length, 0);
  });
  await check(
    '21 verified cart lines are blocked before Cooking or Order requests',
    async () => {
      const large = {
        version: 1,
        items: Array.from({ length: 21 }, (_, index) => ({
          menuId: 101 + index,
          quantity: 1,
          optionIds: [1],
        })),
      };
      await fresh('success', false, large);
      await login();
      await page.locator('.header-cart').click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .getByText('주문할 메뉴를 1~20개 선택해 주세요.', { exact: true })
        .waitFor();
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.equal(fixture.requests.length, 0);
      assert.deepEqual(await cart(), large);
    },
  );
  await check(
    'explicit HTTP recovery uses the same expired order once and subtracts only ordered quantity',
    async () => {
      await fresh('unknown');
      await enterCart();
      await create();
      await pay();
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: '같은 주문 처리 이어가기' })
          .count(),
        0,
      );
      await page.route('**/api/v1/orders/*', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const json = await response.json();
        json.data.holdExpiresAt = '2020-01-01T00:00:00Z';
        await route.fulfill({ response, json });
      });
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .click();
      const recover = page.getByRole('button', {
        name: '같은 주문 처리 이어가기',
        exact: true,
      });
      await recover.waitFor();
      await page.evaluate(() =>
        localStorage.setItem(
          'peak-order.cart.v1',
          JSON.stringify({
            version: 1,
            items: [{ menuId: 1, optionIds: [2], quantity: 5 }],
          }),
        ),
      );
      fixture.checkoutControls.scenario = 'success';
      await recover.evaluate((button) => {
        button.click();
        button.click();
      });
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await cart(), {
        version: 1,
        items: [{ menuId: 1, optionIds: [2], quantity: 3 }],
      });
      const pays = fixture.requests.filter((r) => r.path.endsWith('/pay'));
      assert.equal(pays.length, 2);
      assert.equal(pays[0].path, pays[1].path);
      assert.ok(
        pays.every(
          (r) => r.body === null && !r.hasPaymentKey && !r.hasFakeIdentity,
        ),
      );
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
    },
  );
  await check(
    'immediate-order HTTP recovery keeps the existing cart unchanged',
    async () => {
      await fresh('unknown');
      await login();
      await page.locator('[data-menu-id="1"]').click();
      await page
        .locator('.detail-modal')
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await create();
      await pay();
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .click();
      fixture.checkoutControls.scenario = 'success';
      await page
        .getByRole('button', { name: '같은 주문 처리 이어가기', exact: true })
        .click();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(await cart(), original);
      const creates = fixture.requests.filter(
        (r) => r.path === '/api/v1/orders',
      );
      assert.equal(creates.length, 1);
      assert.equal(creates[0].body.items[0].quantity, 1);
    },
  );
  await check(
    '409 in progress requires another explicit lookup before retry and never creates another order',
    async () => {
      await fresh('in-progress');
      await enterCart();
      await create();
      await pay();
      await page.getByText('안내 코드: ORDER_PAY_IN_PROGRESS').waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: '새 임시 주문으로 다시 확인' })
          .count(),
        0,
      );
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .click();
      await page
        .getByRole('button', { name: '같은 주문 처리 이어가기', exact: true })
        .click();
      await page.getByText('안내 코드: ORDER_PAY_IN_PROGRESS').waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: '같은 주문 처리 이어가기' })
          .count(),
        0,
      );
      await page.waitForTimeout(150);
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        2,
      );
      assert.deepEqual(await cart(), original);
      fixture.checkoutControls.scenario = 'success';
      await page
        .getByRole('button', { name: '주문 상태 확인', exact: true })
        .click();
      await page
        .getByRole('button', { name: '같은 주문 처리 이어가기', exact: true })
        .click();
      await page.locator('.mock-order-number').waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
      assert.equal(
        fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
        3,
      );
    },
  );
  for (const action of ['logout', 'switch', 'close'])
    await check(
      `late recovered HTTP PAID after ${action} cannot change cart`,
      async () => {
        await fresh('unknown');
        await enterCart();
        await create();
        await pay();
        await page
          .getByRole('button', { name: '주문 상태 확인', exact: true })
          .click();
        fixture.checkoutControls.scenario = 'success';
        let release, received;
        const gate = new Promise((done) => {
          release = done;
        });
        const arrived = new Promise((done) => {
          received = done;
        });
        await page.route('**/api/v1/orders/*/pay', async (route) => {
          const response = await route.fetch();
          received();
          await gate;
          await route.fulfill({ response }).catch(() => {});
        });
        await page
          .getByRole('button', { name: '같은 주문 처리 이어가기', exact: true })
          .click();
        await arrived;
        if (action === 'close') {
          await page
            .getByRole('button', { name: '주문 확인에서 뒤로가기' })
            .click();
          await page
            .getByRole('button', { name: '안내 확인 후 나가기' })
            .click();
        } else
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
        assert.deepEqual(await cart(), original);
        assert.equal(await page.locator('.mock-order-number').count(), 0);
        assert.equal(
          fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
          2,
        );
      },
    );
  for (const action of ['logout', 'switch', 'close'])
    await check(
      `late HTTP PAID response after ${action} cannot clear cart or resume order`,
      async () => {
        await fresh();
        await enterCart();
        await create();
        let release, received;
        const gate = new Promise((done) => {
          release = done;
        });
        const arrived = new Promise((done) => {
          received = done;
        });
        await page.route('**/api/v1/orders/*/pay', async (route) => {
          const response = await route.fetch();
          received();
          await gate;
          await route.fulfill({ response }).catch(() => {});
        });
        await pay();
        await arrived;
        if (action === 'close') {
          await page
            .getByRole('button', { name: '주문 확인에서 뒤로가기' })
            .click();
          await page
            .getByRole('button', { name: '안내 확인 후 나가기' })
            .click();
        } else
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
        assert.deepEqual(await cart(), original);
        assert.equal(await page.locator('.mock-order-number').count(), 0);
        assert.equal(
          fixture.requests.filter((r) => r.path.endsWith('/pay')).length,
          1,
        );
      },
    );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        passed: results.filter((r) => r.status === 'PASS').length,
        failed: results.filter((r) => r.status === 'FAIL').length,
        note: 'Actual Chromium + local contract HTTP double; no actual dev services/Gateway.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
