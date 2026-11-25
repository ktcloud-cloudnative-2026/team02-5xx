import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startAdminIntegrationFixture } from './admin-integration-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(
  process.env.ROLE_QA_OUTPUT ?? resolve(tmpdir(), 'peak-order-304-roles'),
);
await mkdir(output, { recursive: true });
const fixture = await startAdminIntegrationFixture({
  initialScenario: 'entry',
});
const browser = await chromium.launch({ headless: true }),
  results = [];
const adminPaths = [
  '#admin',
  '#admin/menus',
  '#admin/orders',
  '#admin/inventory',
  '#admin/cooking',
];
const customerPaths = [
  '#home',
  '#menu-list',
  '#cart',
  '#checkout',
  '#orders',
  '#orders/1',
  '#account',
  '#account/profile',
  '#account/password',
];
const cart = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
async function scenario(name, run, { sample = 'entry', width = 1440 } = {}) {
  fixture.reset(sample);
  Object.assign(fixture.controls, { restoreDelay: 0, apiDelay: 0 });
  const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await run(page, context);
    assert.deepEqual(errors, []);
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack });
    await page.screenshot({
      path: resolve(output, `FAIL-${results.length}.png`),
      fullPage: true,
    });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}
async function home(page) {
  await page.waitForFunction(() => location.hash === '#home');
  await page.locator('.customer-home').waitFor();
  assert.equal(await page.locator('.admin-navigation').count(), 0);
}
async function admin(page, hash = '#admin') {
  await page.waitForFunction((hash) => location.hash === hash, hash);
  await page.locator('.admin-navigation').waitFor();
  assert.equal(
    await page
      .locator('.app-shell, .login-modal, .checkout-page, .cart-modal')
      .count(),
    0,
  );
}
async function login(page, email = 'customer@example.test') {
  if (!(await page.locator('.login-modal').count()))
    await page
      .locator('.customer-header')
      .getByRole('button', { name: '로그인', exact: true })
      .click();
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function logout(page) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await home(page);
}
async function hash(page, value) {
  await page.evaluate((value) => {
    location.hash = value;
  }, value);
}
const adminCalls = () =>
  fixture.requests.filter((r) => r.path.startsWith('/api/v1/admin/'));
const customerCalls = () =>
  fixture.requests.filter((r) =>
    /^\/api\/v1\/(orders|payments)(\/|\?|$)/.test(r.path),
  );
const orderWrites = () => customerCalls().filter((r) => r.method === 'POST');
try {
  await scenario(
    'guest root home and public menu without protected requests',
    async (page) => {
      await page.goto(fixture.url);
      await home(page);
      await hash(page, '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      assert.equal(adminCalls().length, 0);
      assert.equal(customerCalls().length, 0);
    },
  );
  for (const path of adminPaths)
    await scenario(
      `guest direct ${path} returns home without admin request`,
      async (page) => {
        await page.goto(`${fixture.url}/${path}`);
        await home(page);
        assert.equal(adminCalls().length, 0);
      },
    );
  await scenario(
    'same login form: CUSTOMER keeps home then logout/admin login redirects to dashboard',
    async (page) => {
      await page.goto(fixture.url);
      await home(page);
      await login(page);
      await page
        .getByLabel('로그인 사용자')
        .filter({ hasText: '검수 고객' })
        .waitFor();
      await home(page);
      assert.equal(adminCalls().length, 0);
      await logout(page);
      await login(page, 'admin@example.test');
      await admin(page);
      assert.equal(
        await page
          .getByRole('link', { name: '고객 화면', exact: true })
          .count(),
        0,
      );
      assert.equal(await page.locator('.header-cart').count(), 0);
      for (const path of adminPaths) {
        await page.locator(`.admin-navigation nav a[href="${path}"]`).click();
        await admin(page, path);
      }
      await logout(page);
      await login(page);
      await home(page);
      assert.equal(await page.locator('.admin-navigation').count(), 0);
    },
  );
  for (const path of adminPaths)
    await scenario(
      `CUSTOMER blocks direct ${path} and makes zero admin calls`,
      async (page) => {
        await page.goto(fixture.url);
        await home(page);
        await login(page);
        await page.goto(`${fixture.url}/${path}`);
        await home(page);
        assert.equal(adminCalls().length, 0);
      },
    );
  for (const path of customerPaths)
    await scenario(
      `STORE_ADMIN blocks direct ${path} and makes zero customer business calls`,
      async (page) => {
        await page.goto(fixture.url);
        await admin(page);
        await page.goto(`${fixture.url}/${path}`);
        await admin(page);
        assert.equal(customerCalls().length, 0);
      },
      { sample: 'normal' },
    );
  await scenario(
    'unsupported role is rejected by Auth contract before either protected app loads',
    async (page) => {
      await page.goto(`${fixture.url}/#admin/orders`);
      await home(page);
      assert.equal(adminCalls().length, 0);
      assert.equal(customerCalls().length, 0);
    },
    { sample: 'unknown-role' },
  );
  for (const path of ['#menu-list', '#orders', '#account/profile'])
    await scenario(
      `CUSTOMER restoration and refresh retain ${path}`,
      async (page) => {
        await page.goto(fixture.url);
        await home(page);
        await login(page);
        await page.goto(`${fixture.url}/${path}`);
        await page.locator('.app-shell').waitFor();
        await page.waitForTimeout(150);
        assert.equal(new URL(page.url()).hash, path);
        await page.reload();
        await page.locator('.app-shell').waitFor();
        assert.equal(new URL(page.url()).hash, path);
        assert.equal(adminCalls().length, 0);
      },
    );
  await scenario(
    'wrong-role History entries replace rather than push or loop for CUSTOMER',
    async (page) => {
      await page.goto(fixture.url);
      await home(page);
      await login(page);
      await hash(page, '#menu-list');
      await page.locator('[data-menu-id="1"]').waitFor();
      const before = await page.evaluate(() => history.length);
      await hash(page, '#admin/orders');
      await home(page);
      assert.equal(await page.evaluate(() => history.length), before + 1);
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#menu-list');
      await page.goForward();
      await home(page);
      assert.equal(adminCalls().length, 0);
    },
  );
  await scenario(
    'wrong-role History entries replace rather than push or loop for STORE_ADMIN',
    async (page) => {
      await page.goto(`${fixture.url}/#admin/menus`);
      await admin(page, '#admin/menus');
      const before = await page.evaluate(() => history.length);
      await hash(page, '#orders');
      await admin(page);
      assert.equal(await page.evaluate(() => history.length), before + 1);
      await page.goBack();
      await admin(page, '#admin/menus');
      await page.goForward();
      await admin(page);
      assert.equal(customerCalls().length, 0);
    },
    { sample: 'normal' },
  );
  for (const sample of ['customer', 'normal'])
    await scenario(
      `${sample} slow restoration mounts neither app or data before verification`,
      async (page) => {
        fixture.controls.restoreDelay = 800;
        await page.goto(`${fixture.url}/#orders`);
        await page
          .getByRole('status')
          .filter({ hasText: '로그인 정보를 확인' })
          .waitFor();
        assert.equal(
          await page.locator('.app-shell, .admin-navigation').count(),
          0,
        );
        assert.equal(customerCalls().length + adminCalls().length, 0);
        if (sample === 'normal') await admin(page);
        else await page.locator('.orders-page').waitFor();
      },
      { sample },
    );
  for (const role of ['customer', 'admin'])
    for (const recover of [true, false])
      await scenario(
        `${role} expired GET refresh ${recover ? 'success' : 'failure'} and data isolation`,
        async (page) => {
          await page.goto(fixture.url);
          await home(page);
          await login(
            page,
            role === 'admin' ? 'admin@example.test' : 'customer@example.test',
          );
          if (role === 'admin') await admin(page);
          const initial = fixture.requests.filter(
            (r) => r.path === '/api/v1/auth/refresh',
          ).length;
          fixture.expire({ recover });
          await hash(page, role === 'admin' ? '#admin/menus' : '#orders');
          if (!recover) {
            await home(page);
            assert.equal(
              await page
                .locator('.am-menu-row, .ao-app, .checkout-page')
                .count(),
              0,
            );
          } else if (role === 'admin') {
            await page.locator('.am-menu-row').first().waitFor();
          } else {
            await page.locator('.orders-page').waitFor();
          }
          assert.equal(
            fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
              .length,
            initial + 1,
          );
        },
      );
  await scenario(
    'customer detail immediate-order login preserves option and quantity; completes one mock payment',
    async (page) => {
      await page.goto(`${fixture.url}/#menu-list`);
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('.detail-modal');
      await detail.locator('input[value="2"]').check();
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await login(page);
      await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await page
        .getByRole('button', { name: '임시 주문 만들기', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.equal(
        orderWrites().filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
      assert.equal(
        orderWrites().filter((r) => r.path.endsWith('/pay')).length,
        1,
      );
      assert.equal(adminCalls().length, 0);
    },
  );
  await scenario(
    'cart login retains items/options/quantity and CUSTOMER order intent',
    async (page) => {
      await page.addInitScript(
        (cart) =>
          localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
        cart,
      );
      await page.goto(`${fixture.url}/#cart`);
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await login(page);
      await page
        .getByRole('button', { name: '임시 주문 만들기', exact: true })
        .waitFor();
      assert.match(await page.locator('.checkout-summary').innerText(), /× 2/);
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        cart,
      );
      assert.equal(orderWrites().length, 0);
    },
  );
  for (const entry of ['detail', 'cart'])
    await scenario(
      `administrator login cancels pending customer ${entry} order without any customer POST`,
      async (page) => {
        await page.addInitScript(
          (cart) =>
            localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
          cart,
        );
        await page.goto(
          `${fixture.url}/${entry === 'detail' ? '#menu-list' : '#cart'}`,
        );
        if (entry === 'detail') {
          await page.locator('[data-menu-id="1"]').click();
          await page
            .locator('.detail-modal')
            .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
            .click();
        } else
          await page
            .locator('.cart-modal')
            .getByRole('button', { name: '주문하기', exact: true })
            .click();
        await login(page, 'admin@example.test');
        await admin(page);
        await page.waitForTimeout(150);
        assert.equal(customerCalls().length, 0);
        assert.deepEqual(
          await page.evaluate(() =>
            JSON.parse(localStorage.getItem('peak-order.cart.v1')),
          ),
          cart,
        );
        await logout(page);
        await login(page);
        await home(page);
        assert.equal(orderWrites().length, 0);
        assert.equal(
          await page.locator('dialog[open], .checkout-page').count(),
          0,
        );
      },
    );
  await scenario(
    'customer identity change clears previous private data and keeps browser cart',
    async (page) => {
      await page.addInitScript(
        (cart) =>
          localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
        cart,
      );
      await page.goto(fixture.url);
      await home(page);
      await login(page);
      await hash(page, '#account');
      await page.getByText('검수 고객', { exact: true }).first().waitFor();
      await logout(page);
      await login(page, 'other@example.test');
      await hash(page, '#account');
      await page
        .getByLabel('로그인 사용자')
        .filter({ hasText: '다른 검수 고객' })
        .waitFor();
      assert.equal(
        await page.getByText('검수 고객', { exact: true }).count(),
        0,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        cart,
      );
    },
  );
  await scenario(
    'late customer requests are discarded and polling stops after switching to administrator',
    async (page) => {
      await page.goto(fixture.url);
      await home(page);
      await login(page);
      fixture.controls.apiDelay = 1600;
      const pending = page.waitForRequest((request) =>
        request.url().includes('/api/v1/orders?'),
      );
      await hash(page, '#orders');
      await pending;
      await logout(page);
      fixture.controls.apiDelay = 0;
      await login(page, 'admin@example.test');
      await admin(page);
      const count = customerCalls().length;
      await page.waitForTimeout(1800);
      assert.equal(customerCalls().length, count);
      assert.equal(
        await page
          .locator('.orders-page, .customer-home, .order-detail-modal')
          .count(),
        0,
      );
      assert.notEqual(
        await page.locator('body').evaluate((el) => el.style.overflow),
        'hidden',
      );
    },
  );
  await scenario(
    'customer mutation 401 goes home, preserves cart, and never refreshes or replays POST',
    async (page) => {
      await page.addInitScript(
        (cart) =>
          localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
        cart,
      );
      await page.goto(`${fixture.url}/#cart`);
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await login(page);
      let writes = 0;
      await page.route('**/api/v1/orders', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        writes++;
        await route.fulfill({
          status: 401,
          contentType: 'text/plain',
          body: 'expired',
        });
      });
      const refreshes = fixture.requests.filter(
        (r) => r.path === '/api/v1/auth/refresh',
      ).length;
      await page
        .getByRole('button', { name: '임시 주문 만들기', exact: true })
        .click();
      await home(page);
      assert.equal(writes, 1);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        refreshes,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        cart,
      );
    },
  );
  await scenario(
    'URL and stored role strings cannot grant administrator access',
    async (page) => {
      await page.addInitScript(() => {
        localStorage.setItem('role', 'STORE_ADMIN');
        localStorage.setItem(
          'user',
          JSON.stringify({ id: 2, role: 'STORE_ADMIN' }),
        );
      });
      await page.goto(`${fixture.url}/#admin`);
      await home(page);
      assert.equal(adminCalls().length, 0);
    },
  );
  await scenario(
    'administrator chunk loading unmounts customer layout and pending intent immediately',
    async (page) => {
      let release, requested;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        requested = resolve;
      });
      await page.route(/\/assets\/AdminApp-[^/]+\.js$/, async (route) => {
        requested();
        await held;
        await route.continue();
      });
      await page.goto(fixture.url);
      await home(page);
      await login(page, 'admin@example.test');
      await started;
      assert.equal(
        await page.locator('.app-shell, .cart-modal, .checkout-page').count(),
        0,
      );
      assert.equal(customerCalls().length + adminCalls().length, 0);
      release();
      await admin(page);
    },
  );
  await scenario(
    'restored administrator never loads the customer application chunk',
    async (page) => {
      const customerChunks = [];
      page.on('request', (request) => {
        if (/\/assets\/App-[^/]+\.js$/.test(request.url()))
          customerChunks.push(request.url());
      });
      await page.goto(`${fixture.url}/#checkout`);
      await admin(page);
      assert.deepEqual(customerChunks, []);
      assert.equal(customerCalls().length, 0);
    },
    { sample: 'normal' },
  );
  await scenario(
    'shared-host preview cookie is preserved through login and logout',
    async (page, context) => {
      await context.addCookies([
        {
          name: 'adminIntegration',
          value: 'other-preview-session',
          domain: '127.0.0.1',
          path: '/api/v1/auth',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      await page.goto(fixture.url);
      await home(page);
      await login(page, 'admin@example.test');
      await admin(page);
      await logout(page);
      assert.equal(
        (await context.cookies()).find(
          (cookie) => cookie.name === 'adminIntegration',
        )?.value,
        'other-preview-session',
      );
    },
  );
  await scenario(
    'plain 401 GET refresh succeeds with exactly one retry',
    async (page) => {
      let sends = 0;
      await page.route('**/api/v1/admin/menus**', async (route) => {
        sends++;
        if (sends === 1)
          await route.fulfill({
            status: 401,
            contentType: 'text/plain',
            body: 'Gateway denied',
          });
        else await route.continue();
      });
      await page.goto(`${fixture.url}/#admin/menus`);
      await page.locator('.am-menu-row').first().waitFor();
      assert.equal(sends, 2);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        2,
      );
    },
    { sample: 'normal' },
  );
  await scenario(
    'plain 401 after retry clears data and returns home without a retry loop',
    async (page) => {
      let sends = 0;
      await page.route('**/api/v1/admin/menus**', async (route) => {
        sends++;
        await route.fulfill({
          status: 401,
          contentType: 'text/plain',
          body: 'Gateway denied',
        });
      });
      await page.goto(`${fixture.url}/#admin/menus`);
      await home(page);
      assert.equal(sends, 2);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        2,
      );
      assert.equal(await page.locator('.am-menu-row').count(), 0);
    },
    { sample: 'normal' },
  );
  await scenario(
    'plain 401 with failed refresh clears the protected app and returns home',
    async (page) => {
      await page.goto(`${fixture.url}/#admin`);
      await admin(page);
      let sends = 0,
        refreshes = 0;
      await page.route('**/api/v1/admin/menus**', async (route) => {
        sends++;
        await route.fulfill({
          status: 401,
          contentType: 'text/plain',
          body: 'Gateway denied',
        });
      });
      await page.route('**/api/v1/auth/refresh', async (route) => {
        refreshes++;
        await route.fulfill({
          status: 403,
          contentType: 'text/plain',
          body: 'Refresh denied',
        });
      });
      await hash(page, '#admin/menus');
      await home(page);
      assert.equal(sends, 1);
      assert.equal(refreshes, 1);
      assert.equal(await page.locator('.admin-navigation').count(), 0);
    },
    { sample: 'normal' },
  );
  await scenario(
    'plain 403 across all five administrator pages never refreshes or logs out',
    async (page) => {
      await page.route('**/api/v1/admin/**', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'text/plain',
          body: 'Gateway denied',
        }),
      );
      await page.goto(`${fixture.url}/#admin`);
      await admin(page);
      for (const path of adminPaths) {
        await page.locator(`.admin-navigation nav a[href="${path}"]`).click();
        await admin(page, path);
        await page
          .locator(
            '[role="alert"]:visible, .ad-error:visible, .ac-error:visible',
          )
          .first()
          .waitFor();
      }
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        1,
      );
      await page.unroute('**/api/v1/admin/**');
      await page.locator('.admin-navigation nav a[href="#admin"]').click();
      await page
        .getByTestId('completed-kpi')
        .getByText('42', { exact: false })
        .waitFor();
    },
    { sample: 'normal' },
  );
  await scenario(
    'administrator POST plain 401 never refreshes or replays and returns home',
    async (page) => {
      await page.goto(`${fixture.url}/#admin/menus`);
      await page.locator('.am-create').click();
      let sends = 0;
      const dialog = page.getByRole('dialog');
      for (const [name, value] of [
        ['name', '인증 오류 검수'],
        ['basePrice', '6500'],
        ['cookTimeSec', '120'],
      ])
        await dialog.locator(`input[name="${name}"]`).fill(value);
      await page.route('**/api/v1/admin/menus**', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        sends++;
        await route.fulfill({
          status: 401,
          contentType: 'text/plain',
          body: 'Gateway denied',
        });
      });
      await dialog
        .getByRole('button', { name: '메뉴 등록', exact: true })
        .click();
      await home(page);
      assert.equal(sends, 1);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        1,
      );
    },
    { sample: 'normal' },
  );
  await scenario(
    'administrator PATCH plain 403 revokes the editor and data without refresh or automatic resubmit',
    async (page) => {
      await page.goto(`${fixture.url}/#admin/menus`);
      await page.locator('.am-edit-button').first().click();
      let sends = 0;
      const dialog = page.getByRole('dialog');
      await dialog.locator('input[name="name"]').fill('권한 오류 검수');
      await page.route('**/api/v1/admin/menus**', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        sends++;
        await route.fulfill({
          status: 403,
          contentType: 'text/plain',
          body: 'Gateway denied',
        });
      });
      await dialog
        .getByRole('button', { name: '변경 저장', exact: true })
        .click();
      await dialog.waitFor({ state: 'detached' });
      await page.locator('.am-list-error').waitFor();
      assert.equal(await page.locator('.am-menu-row').count(), 0);
      assert.equal(await page.locator('.am-create').isDisabled(), true);
      assert.equal(sends, 1);
      assert.equal(await page.locator('.admin-navigation').count(), 1);
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        1,
      );
      await admin(page, '#admin/menus');
      await page.unroute('**/api/v1/admin/menus**');
      await page
        .getByRole('button', { name: '다시 불러오기', exact: true })
        .click();
      await page.locator('.am-menu-row').first().waitFor();
      assert.equal(sends, 1);
    },
    { sample: 'normal' },
  );
  for (const width of [1440, 390, 320])
    await scenario(
      `common login and both roles responsive at ${width}px`,
      async (page) => {
        await page.goto(fixture.url);
        await home(page);
        await login(page);
        await home(page);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await logout(page);
        await login(page, 'admin@example.test');
        await admin(page);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: resolve(output, `roles-${width}.png`),
          fullPage: true,
        });
        await logout(page);
        await home(page);
      },
      { width },
    );
} finally {
  await browser.close();
  await fixture.close();
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
}
console.log(
  `${results.filter((r) => r.status === 'PASS').length}/${results.length} PASS`,
);
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
