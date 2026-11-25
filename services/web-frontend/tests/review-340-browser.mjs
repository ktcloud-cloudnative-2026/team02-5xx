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
  process.env.REVIEW_340_QA_OUTPUT ??
    resolve(tmpdir(), 'peak-order-review-340'),
);
await mkdir(output, { recursive: true });
const fixture = await startAdminIntegrationFixture(),
  browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, run, { sample = 'normal', width = 1440 } = {}) {
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
  assert.equal(
    await page.locator('.admin-navigation, .am-menu-row').count(),
    0,
  );
}
async function open(page) {
  await page.goto(`${fixture.url}/#admin/menus`);
  await page.locator('.am-menu-row').first().waitFor();
}
async function login(page, email) {
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
const retry = (page) =>
  page.getByRole('button', { name: '로그아웃 다시 시도', exact: true });
const logoutCalls = () =>
  fixture.requests.filter((request) => request.path === '/api/v1/auth/logout')
    .length;
const refreshCalls = () =>
  fixture.requests.filter((request) => request.path === '/api/v1/auth/refresh')
    .length;
async function refreshList(page) {
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
}
async function backgroundRefresh(page) {
  await page
    .getByRole('button', { name: '새로고침', exact: true })
    .evaluate((button) => button.click());
}
async function deniedPage(page) {
  await page.locator('.am-list-error').waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.am-menu-row, .am-dialog[open]').length === 0,
  );
  assert.equal(await page.locator('.am-create').isDisabled(), true);
  assert.equal(await page.locator('.admin-navigation').count(), 1);
}
try {
  for (const sample of ['customer', 'normal'])
    await scenario(
      `${sample}: logout failure, duplicate retry, failed retry, success, and no duplicate notices`,
      async (page) => {
        fixture.controls.logoutStatus = 503;
        await page.goto(
          `${fixture.url}/${sample === 'normal' ? '#admin/menus' : '#account'}`,
        );
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .waitFor();
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .click();
        await home(page);
        await retry(page).waitFor();
        assert.equal(
          await page
            .getByRole('alert')
            .filter({ hasText: '로그아웃 요청을 확인하지 못했어요' })
            .count(),
          1,
        );
        assert.match(await page.getByRole('alert').innerText(), /새로고침/);
        const before = logoutCalls();
        fixture.controls.logoutDelay = 350;
        await retry(page).evaluate((button) => {
          button.click();
          button.click();
        });
        assert.equal(await retry(page).isDisabled(), true);
        await page.waitForFunction(
          () => !document.querySelector('.logout-recovery button')?.disabled,
        );
        assert.equal(logoutCalls(), before + 1);
        await retry(page).waitFor();
        fixture.controls.logoutStatus = 204;
        fixture.controls.logoutDelay = 0;
        await retry(page).click();
        await retry(page).waitFor({ state: 'detached' });
        assert.equal(await page.locator('.logout-recovery').count(), 0);
        await home(page);
        await page.reload();
        await home(page);
      },
      { sample },
    );
  for (const [sample, email] of [
    ['customer', 'admin@example.test'],
    ['normal', 'customer@example.test'],
  ])
    await scenario(
      `${sample}: new login clears previous logout error and a stale retry callback cannot log out the new account`,
      async (page) => {
        fixture.controls.logoutStatus = 503;
        await page.goto(`${fixture.url}/#home`);
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .click();
        await home(page);
        await retry(page).waitFor();
        await retry(page).evaluate((button) => {
          window.__oldRetryButton = button;
        });
        const count = logoutCalls();
        await login(page, email);
        if (email.startsWith('admin'))
          await page.locator('.admin-navigation').waitFor();
        else await page.getByLabel('로그인 사용자').waitFor();
        await page.evaluate(() => window.__oldRetryButton.click());
        await page.waitForTimeout(100);
        assert.equal(logoutCalls(), count);
        assert.equal(await retry(page).count(), 0);
        assert.equal(await page.locator('.logout-recovery').count(), 0);
      },
      { sample },
    );
  for (const requestType of ['initial', 'retry'])
    await scenario(
      `new login cannot overtake an in-flight ${requestType} logout; subsequent login survives the old response`,
      async (page) => {
        fixture.controls.logoutStatus = 503;
        fixture.controls.logoutDelay = requestType === 'initial' ? 600 : 0;
        await page.goto(`${fixture.url}/#admin`);
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .click();
        await home(page);
        if (requestType === 'retry') {
          await retry(page).waitFor();
          fixture.controls.logoutDelay = 600;
          await retry(page).click();
        }
        await page
          .locator('.customer-header')
          .getByRole('button', { name: '로그인', exact: true })
          .click();
        await page
          .getByLabel('이메일', { exact: true })
          .fill('customer@example.test');
        await page
          .getByLabel('비밀번호', { exact: true })
          .fill('fixture-only-password');
        await page.locator('.login-form button[type=submit]').click();
        await page.locator('.login-modal [role=alert]').waitFor();
        assert.equal(
          fixture.requests.filter(
            (request) => request.path === '/api/v1/auth/login',
          ).length,
          0,
        );
        await page.waitForTimeout(700);
        fixture.controls.logoutDelay = 0;
        await page
          .getByLabel('비밀번호', { exact: true })
          .fill('fixture-only-password');
        await page.locator('.login-form button[type=submit]').click();
        await page.getByLabel('로그인 사용자').waitFor();
        assert.equal(await retry(page).count(), 0);
      },
    );
  for (const sample of ['customer', 'normal'])
    await scenario(
      `${sample}: failed logout leaves a Refresh cookie and reload restores it (unchanged policy, not server logout success)`,
      async (page, context) => {
        fixture.controls.logoutStatus = 503;
        await page.goto(
          `${fixture.url}/${sample === 'normal' ? '#admin/menus' : '#account'}`,
        );
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .click();
        await home(page);
        await retry(page).waitFor();
        assert.ok(
          (await context.cookies()).some((cookie) =>
            cookie.name.startsWith('adminIntegration_'),
          ),
        );
        const count = refreshCalls();
        await page.reload();
        if (sample === 'normal')
          await page.locator('.admin-navigation').waitFor();
        else await page.getByLabel('로그인 사용자').waitFor();
        assert.equal(refreshCalls(), count + 1);
        assert.equal(await retry(page).count(), 0);
      },
      { sample },
    );
  await scenario(
    'menu 403 requery hides old rows and restores work only after a fresh successful list, without Refresh/logout',
    async (page) => {
      await open(page);
      const count = refreshCalls();
      fixture.controls.menuListStatus = 403;
      await refreshList(page);
      await deniedPage(page);
      assert.equal(refreshCalls(), count);
      assert.equal(logoutCalls(), 0);
      fixture.controls.menuListStatus = 200;
      await page
        .getByRole('button', { name: '다시 불러오기', exact: true })
        .click();
      await page.locator('.am-menu-row').first().waitFor();
      await page.locator('.am-edit-button').first().click();
      await page.getByRole('dialog', { name: '메뉴 수정' }).waitFor();
    },
  );
  for (const type of ['create', 'detail', 'edit', 'status'])
    await scenario(
      `menu list 403 closes an open ${type} modal and blocks its old work`,
      async (page) => {
        await open(page);
        if (type === 'create') await page.locator('.am-create').click();
        else if (type === 'detail')
          await page.locator('.am-menu-name').first().click();
        else if (type === 'edit')
          await page.locator('.am-edit-button').first().click();
        else await page.locator('.am-row-state').first().click();
        await page.getByRole('dialog').waitFor();
        fixture.controls.menuListStatus = 403;
        await backgroundRefresh(page);
        await deniedPage(page);
        const count = fixture.requests.filter(
          (request) =>
            request.method !== 'GET' &&
            request.path.startsWith('/api/v1/admin/menus'),
        ).length;
        await page.keyboard.press('Enter');
        assert.equal(
          fixture.requests.filter(
            (request) =>
              request.method !== 'GET' &&
              request.path.startsWith('/api/v1/admin/menus'),
          ).length,
          count,
        );
      },
    );
  await scenario(
    'late menu detail success cannot restore revoked data or a closed dialog',
    async (page) => {
      await open(page);
      let release, started;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const requested = new Promise((resolve) => {
        started = resolve;
      });
      await page.route(/\/api\/v1\/admin\/menus\/\d+$/, async (route) => {
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response }).catch(() => {});
      });
      await page.locator('.am-menu-name').first().click();
      await requested;
      fixture.controls.menuListStatus = 403;
      await backgroundRefresh(page);
      await deniedPage(page);
      release();
      await page.waitForTimeout(150);
      await deniedPage(page);
    },
  );
  for (const status of [503, 'network'])
    await scenario(
      `menu ${status} list failure preserves previous data and permission`,
      async (page) => {
        await open(page);
        const before = await page.locator('.am-menu-row').count();
        if (status === 503) fixture.controls.menuListStatus = 503;
        else
          await page.route('**/api/v1/admin/menus?**', (route) =>
            route.abort(),
          );
        await refreshList(page);
        await page.locator('.am-list-error').waitFor();
        assert.equal(await page.locator('.am-menu-row').count(), before);
        assert.equal(
          await page.locator('.am-edit-button').first().isDisabled(),
          false,
        );
      },
    );
  await scenario(
    'menu 401 after one GET recovery clears all protected UI and returns home',
    async (page) => {
      await open(page);
      fixture.controls.menuListStatus = 401;
      const count = refreshCalls();
      await refreshList(page);
      await home(page);
      assert.equal(refreshCalls(), count + 1);
    },
  );
  await scenario(
    'menu mutation 403 clears the editor and data without automatic resubmission or session logout',
    async (page) => {
      await open(page);
      await page.locator('.am-edit-button').first().click();
      await page
        .getByRole('dialog')
        .locator('input[name=name]')
        .fill('권한 검수');
      fixture.controls.menuWriteStatus = 403;
      const count = refreshCalls();
      await page
        .getByRole('button', { name: '변경 저장', exact: true })
        .click();
      await deniedPage(page);
      assert.equal(
        fixture.requests.filter(
          (request) =>
            request.method === 'PATCH' &&
            request.path.startsWith('/api/v1/admin/menus'),
        ).length,
        1,
      );
      assert.equal(refreshCalls(), count);
      assert.equal(logoutCalls(), 0);
    },
  );
  for (const width of [390, 320])
    await scenario(
      `logout recovery is visible and fits ${width}px`,
      async (page) => {
        fixture.controls.logoutStatus = 503;
        await page.goto(`${fixture.url}/#admin`);
        await page
          .getByRole('button', { name: '로그아웃', exact: true })
          .click();
        await home(page);
        await retry(page).waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: resolve(output, `logout-retry-${width}.png`),
          fullPage: true,
        });
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
  `${results.filter((result) => result.status === 'PASS').length}/${results.length} PASS`,
);
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
