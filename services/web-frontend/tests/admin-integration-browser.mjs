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
  process.env.ADMIN_INTEGRATION_QA_OUTPUT ??
    resolve(tmpdir(), 'peak-order-admin304-qa'),
);
await mkdir(output, { recursive: true });
const fixture = await startAdminIntegrationFixture(),
  browser = await chromium.launch({ headless: true });
const results = [];
const routes = [
  ['#admin', '대시보드'],
  ['#admin/menus', '메뉴 관리'],
  ['#admin/orders', '주문 관리'],
  ['#admin/inventory', '재고 관리'],
  ['#admin/cooking', '주문·조리 현황'],
];
async function scenario(name, run, { sample = 'normal', width = 1440 } = {}) {
  fixture.reset(sample);
  const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  try {
    await run(page);
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
async function open(page, hash = '#admin') {
  await page.goto(`${fixture.url}/${hash}`);
  await page.locator('.admin-navigation').waitFor();
}
async function heading(page, title) {
  await page
    .getByRole('heading', { level: 1, name: title, exact: true })
    .waitFor();
}
async function commonHome(page) {
  await page.locator('.app-shell').waitFor();
  await page.waitForFunction(() => window.location.hash === '#home');
  assert.equal(await page.locator('.admin-navigation').count(), 0);
}
async function nav(page, title) {
  await page
    .getByRole('navigation', { name: '관리자 화면' })
    .getByRole('link', { name: title, exact: true })
    .click();
  await heading(page, title);
}
try {
  await scenario(
    'all five routes, dashboard return, active link and single layout',
    async (page) => {
      await open(page);
      for (const [, title] of routes) {
        await nav(page, title);
        assert.equal(await page.locator('main').count(), 1);
        assert.equal(await page.locator('[aria-current="page"]').count(), 1);
        assert.equal(await page.locator('h1').count(), 1);
      }
      await nav(page, '대시보드');
      await nav(page, '메뉴 관리');
      await nav(page, '대시보드');
      await page.getByTestId('waiting-kpi').waitFor();
    },
  );
  for (const [hash, title] of routes)
    await scenario(`direct entry and refresh: ${title}`, async (page) => {
      await open(page, hash);
      await heading(page, title);
      await page.reload();
      await heading(page, title);
      assert.equal(new URL(page.url()).hash, hash);
    });
  await scenario('back/forward and route heading focus', async (page) => {
    await open(page);
    await nav(page, '메뉴 관리');
    await nav(page, '재고 관리');
    await page.goBack();
    await heading(page, '메뉴 관리');
    await page.goForward();
    await heading(page, '재고 관리');
    await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  });
  for (const sample of ['anonymous', 'customer'])
    await scenario(
      `${sample} guard makes no protected requests`,
      async (page) => {
        await page.goto(`${fixture.url}/#admin/inventory`);
        await commonHome(page);
        assert.equal(
          fixture.requests.filter((r) => r.path.startsWith('/api/v1/admin/'))
            .length,
          0,
        );
        assert.equal(await page.locator('.ai-app').count(), 0);
      },
      { sample },
    );
  await scenario(
    'common login redirects administrator to dashboard',
    async (page) => {
      await page.goto(`${fixture.url}/#admin/menus`);
      await commonHome(page);
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page
        .getByLabel('이메일', { exact: true })
        .fill('admin@example.test');
      await page
        .getByLabel('비밀번호', { exact: true })
        .fill('fixture-only-password');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '로그인', exact: true })
        .click();
      await heading(page, '대시보드');
      assert.equal(new URL(page.url()).hash, '#admin');
    },
    { sample: 'anonymous' },
  );
  await scenario(
    'session expiration clears protected data',
    async (page) => {
      await page.goto(`${fixture.url}/#admin`);
      await commonHome(page);
      assert.equal(await page.locator('.ad-shell').count(), 0);
    },
    { sample: 'expired' },
  );
  await scenario(
    'GET refresh recovers once',
    async (page) => {
      await open(page, '#admin/menus');
      await page.locator('.am-menu-row').first().waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/auth/refresh')
          .length,
        2,
      );
    },
    { sample: 'refresh' },
  );
  await scenario(
    'logout removes data and returns to common home',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await commonHome(page);
      assert.equal(await page.locator('.admin-navigation').count(), 0);
      await page.reload();
      await commonHome(page);
    },
  );
  await scenario(
    'unknown admin route stays in guarded layout',
    async (page) => {
      await open(page, '#admin/missing');
      await heading(page, '페이지를 찾을 수 없어요');
      await nav(page, '대시보드');
    },
  );
  for (const sample of ['forbidden', 'not-found', 'outage'])
    for (const [hash, title] of routes)
      await scenario(
        `${title}: ${sample}`,
        async (page) => {
          await open(page, hash);
          await heading(page, title);
          await page
            .locator(
              '[role="alert"]:visible, .ad-error:visible, .ac-error:visible',
            )
            .first()
            .waitFor();
          assert.equal(await page.locator('.admin-navigation').count(), 1);
        },
        { sample },
      );
  await scenario(
    'restore loading hides protected UI; navigation rejects old response',
    async (page) => {
      await page.goto(`${fixture.url}/#admin`);
      await page
        .getByRole('status')
        .filter({ hasText: '로그인 정보를 확인하고 있어요' })
        .waitFor();
      assert.equal(await page.locator('.ad-shell').count(), 0);
      await page.locator('.admin-navigation').waitFor();
      await nav(page, '메뉴 관리');
      await nav(page, '주문·조리 현황');
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('.am-shell').count(), 0);
    },
    { sample: 'slow' },
  );
  await scenario('polling ends on navigation', async (page) => {
    await open(page, '#admin/cooking');
    await page.waitForTimeout(400);
    await nav(page, '메뉴 관리');
    const count = fixture.requests.filter((r) =>
      r.path.includes('/cooking/'),
    ).length;
    await page.waitForTimeout(6000);
    assert.equal(
      fixture.requests.filter((r) => r.path.includes('/cooking/')).length,
      count,
    );
  });
  await scenario(
    'menu edit save, focus return and hidden status restoration',
    async (page) => {
      await open(page, '#admin/menus');
      const edit = page.locator('.am-edit-button').first();
      await edit.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.locator('input[name="name"]').fill('통합 검수 메뉴');
      await dialog.getByRole('button', { name: '변경 저장' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page
        .getByRole('button', { name: '통합 검수 메뉴', exact: true })
        .waitFor();
      await page.locator('.am-row-state').first().click();
      await page.getByLabel('변경할 판매 상태').selectOption('HIDDEN');
      await page.getByRole('button', { name: '상태 저장' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.locator('.am-row-state').first().click();
      await page.getByLabel('변경할 판매 상태').selectOption('ON_SALE');
      await page.getByRole('button', { name: '상태 저장' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(
        fixture.requests.filter((r) => r.method === 'PATCH').length,
        3,
      );
    },
  );
  await scenario(
    'menu dialog Escape and page Back release focus/scroll lock',
    async (page) => {
      await open(page);
      await nav(page, '메뉴 관리');
      const edit = page.locator('.am-edit-button').first();
      await edit.click();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(
        await edit.evaluate((el) => document.activeElement === el),
        true,
      );
      await edit.click();
      await page.goBack();
      await heading(page, '대시보드');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.notEqual(
        await page.locator('body').evaluate((el) => el.style.overflow),
        'hidden',
      );
    },
  );
  await scenario(
    'unknown menu mutation cannot resubmit',
    async (page) => {
      await open(page, '#admin/menus');
      await page.locator('.am-edit-button').first().click();
      await page
        .getByRole('dialog')
        .locator('input[name="name"]')
        .fill('결과 확인');
      await page.getByRole('button', { name: '변경 저장' }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(
        await page.getByRole('button', { name: '변경 저장' }).isDisabled(),
        true,
      );
      assert.equal(
        fixture.requests.filter((r) => r.method === 'PATCH').length,
        1,
      );
    },
    { sample: 'write-unknown' },
  );
  await scenario(
    'inventory edit modal and navigation cleanup',
    async (page) => {
      await open(page);
      await nav(page, '재고 관리');
      await page.locator('.ai-card').waitFor();
      await page.getByRole('button', { name: /입고/ }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await nav(page, '대시보드');
    },
  );
  for (const width of [1440, 390, 320])
    await scenario(
      `all pages responsive and keyboard skip: ${width}px`,
      async (page) => {
        await open(page);
        for (const [, title] of routes) {
          await nav(page, title);
          await page.waitForTimeout(100);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            title,
          );
          const link = page.locator('nav [aria-current="page"]');
          const box = await link.boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width);
        }
        await page.screenshot({
          path: resolve(output, `cooking-${width}.png`),
          fullPage: true,
        });
        await page.locator('.admin-skip').focus();
        await page.keyboard.press('Enter');
        assert.equal(
          await page
            .locator('#admin-content')
            .evaluate((el) => document.activeElement === el),
          true,
        );
      },
      { width },
    );
  await scenario(
    'administrator cannot switch to customer layout or business APIs',
    async (page) => {
      await open(page);
      assert.equal(
        await page
          .getByRole('link', { name: '고객 화면', exact: true })
          .count(),
        0,
      );
      await page.evaluate(() => {
        window.location.hash = '#home';
      });
      await page.waitForFunction(() => window.location.hash === '#admin');
      await heading(page, '대시보드');
      assert.equal(await page.locator('.app-shell').count(), 0);
      assert.equal(
        fixture.requests.filter((r) => r.path.startsWith('/api/v1/orders'))
          .length,
        0,
      );
    },
  );
  for (const [hash, title] of routes)
    await scenario(
      `${title}: empty HTTP data`,
      async (page) => {
        await open(page, hash);
        await heading(page, title);
        await page.waitForTimeout(200);
        assert.equal(
          await page
            .locator('.am-menu-row, [data-order-id], .ai-row-actions')
            .count(),
          0,
        );
        assert.equal(await page.locator('.admin-navigation').count(), 1);
      },
      { sample: 'empty' },
    );
  await scenario(
    'static logo loads without modifying original asset',
    async (page) => {
      await open(page);
      const logo = page.getByRole('img', { name: 'Peak Order', exact: true });
      assert.ok(
        await logo.evaluate((el) => el.complete && el.naturalWidth === 1100),
      );
      assert.equal(
        (
          await page.request.get(
            `${fixture.url}/images/brand/peakorder-logo-a.png`,
          )
        ).status(),
        200,
      );
    },
  );
  await scenario(
    'order detail keeps integrated route through back and forward',
    async (page) => {
      await open(page, '#admin/orders');
      await page.locator('[data-order-id]').first().click();
      await page.getByRole('dialog').waitFor();
      assert.ok(new URL(page.url()).hash.startsWith('#admin/orders?'));
      await page.goBack();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.goForward();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await nav(page, '대시보드');
    },
  );
  await scenario(
    'inventory restock saves through authenticated HTTP once',
    async (page) => {
      await open(page, '#admin/inventory');
      await page
        .getByRole('button', { name: '재고 101 입고', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/^추가 입고 수량/).fill('3');
      await dialog.getByRole('button', { name: '입고 반영' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        fixture.requests.filter(
          (r) => r.method === 'POST' && r.path.includes('/adjustments'),
        ).length,
        1,
      );
    },
  );
  await scenario(
    'menu creation and option editing use HTTP contracts',
    async (page) => {
      await open(page, '#admin/menus');
      await page.getByRole('button', { name: /새 메뉴 등록/ }).click();
      const dialog = page.getByRole('dialog');
      for (const [name, value] of [
        ['name', '신규 통합 메뉴'],
        ['basePrice', '6500'],
        ['cookTimeSec', '120'],
      ])
        await dialog.locator(`input[name="${name}"]`).fill(value);
      await dialog
        .getByRole('button', { name: '+ 옵션 추가', exact: true })
        .click();
      await dialog.locator('input[name="options.0.name"]').fill('추가 치즈');
      await dialog
        .getByRole('button', { name: '메뉴 등록', exact: true })
        .click();
      await dialog.waitFor({ state: 'detached' });
      const row = page
        .locator('.am-menu-row')
        .filter({ hasText: '신규 통합 메뉴' });
      await row.locator('.am-edit-button').click();
      await dialog.locator('input[name="options.0.extraPrice"]').fill('500');
      await dialog.getByRole('button', { name: '변경 저장' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        fixture.requests.filter(
          (r) => r.method === 'POST' && r.path === '/api/v1/admin/menus',
        ).length,
        1,
      );
    },
  );
  await scenario(
    'mutation 401 clears protected UI and is never replayed',
    async (page) => {
      await open(page, '#admin/menus');
      let writes = 0;
      await page.route('**/api/v1/admin/menus/*', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        writes++;
        await route.fulfill({
          status: 401,
          contentType: 'text/plain',
          body: 'expired',
        });
      });
      await page.locator('.am-edit-button').first().click();
      await page
        .getByRole('dialog')
        .locator('input[name="name"]')
        .fill('만료 확인');
      await page.getByRole('button', { name: '변경 저장' }).click();
      await commonHome(page);
      assert.equal(writes, 1);
      assert.equal(await page.locator('.am-menu-row').count(), 0);
    },
  );
  await scenario(
    'logout failure clears data and retains a visible warning',
    async (page) => {
      await open(page);
      await page.route('**/api/v1/auth/logout', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            data: null,
            errorCode: 'FIXTURE_ERROR',
            message: 'offline',
          }),
        }),
      );
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await commonHome(page);
      await page
        .getByRole('alert')
        .filter({ hasText: '로그아웃 요청을 확인하지 못했어요' })
        .waitFor();
      assert.equal(await page.locator('.ad-shell').count(), 0);
    },
  );
  for (const [hash, title] of routes)
    await scenario(
      `${title}: loading HTTP state`,
      async (page) => {
        await open(page, hash);
        await heading(page, title);
        await page
          .getByRole('main')
          .getByText(/불러오는 중/)
          .first()
          .waitFor();
        await page.waitForTimeout(1500);
        assert.equal(await page.locator('main').count(), 1);
      },
      { sample: 'slow' },
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
