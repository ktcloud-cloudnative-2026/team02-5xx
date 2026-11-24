// Run explicitly with an existing external Playwright installation. No dependency install.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startAuthFixture } from './auth-http-fixture.mjs';

if (!process.env.PLAYWRIGHT_PACKAGE)
  throw new Error('기존 Playwright 패키지 경로가 필요합니다.');
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const directory = resolve(
  process.env.AUTH_QA_OUTPUT || join(tmpdir(), `peak156-auth-${Date.now()}`),
);
await mkdir(directory, { recursive: true });
const fixture = await startAuthFixture();
const browser = await chromium.launch({ headless: true });
const results = [];
const pageErrors = [];
const unexpectedResponses = [];
const login = async (
  page,
  email = 'customer@example.test',
  password = 'fixture-only-password',
) => {
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.locator('.login-form button[type="submit"]').click();
};
async function scenario(name, run, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  console.log(`시작: ${name}`);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/api/v1/auth/'))
      unexpectedResponses.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
  });
  fixture.controls.delay = 0;
  fixture.controls.loginStatus = 200;
  fixture.controls.logoutStatus = 204;
  try {
    const before = { ...fixture.counts };
    await page.goto(fixture.url + '#menu-list');
    await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
    await run(page, context, before);
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
  } finally {
    // Never capture typed credentials or cookie/token values.
    await page
      .locator('input[type="password"]')
      .evaluateAll((inputs) =>
        inputs.forEach((input) => {
          input.value = '';
        }),
      )
      .catch(() => {});
    await page.screenshot({
      path: join(directory, `${results.length}.png`),
      fullPage: true,
      timeout: 5000,
    });
    console.log(
      `${results.at(-1).status}: ${name}${results.at(-1).error ? ` — ${results.at(-1).error}` : ''}`,
    );
    await context.close();
  }
}
try {
  await scenario(
    'StrictMode 최초 복원 1회·비회원 메뉴 조회',
    async (page, context, before) => {
      assert.equal(fixture.counts.refresh - before.refresh, 1);
      assert.equal(fixture.counts.login - before.login, 0);
      assert.ok(await page.locator('.menu-card').count());
      assert.equal(await page.locator('dialog[open]').count(), 0);
    },
  );
  await scenario(
    '비회원 담기 1회·선택·검색 보존·이후 수동 로그인·기존 저장 구조',
    async (page) => {
      await page.getByRole('searchbox').fill('버거');
      await page.getByRole('button', { name: '버거', exact: true }).click();
      await page
        .getByRole('combobox', { name: '메뉴 정렬' })
        .selectOption('priceAsc');
      await page.locator('.menu-card:not([disabled])').first().click();
      const detail = page.locator('.detail-modal');
      await detail.locator('input[type="radio"][value="2"]').check();
      await detail.getByRole('button', { name: '수량 늘리기' }).click();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await page.locator('.cart-modal[open]').waitFor();
      assert.equal(await page.locator('.login-modal').count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(
        await detail.getByLabel('선택 수량', { exact: true }).textContent(),
        '2',
      );
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.getByLabel('로그인 유지', { exact: true }).check();
      await login(page);
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('searchbox').inputValue(), '버거');
      assert.equal(
        await page.getByRole('combobox', { name: '메뉴 정렬' }).inputValue(),
        'priceAsc',
      );
      assert.equal(
        await page
          .getByRole('button', { name: '버거', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(fixture.getLastRememberMe(), true);
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('peak-order.cart.v1')),
      );
      assert.equal(saved.version, 1);
      assert.equal(saved.items.length, 1);
      assert.equal(saved.items[0].quantity, 2);
      assert.deepEqual(saved.items[0].optionIds, [2]);
      assert.deepEqual(Object.keys(saved.items[0]).sort(), [
        'menuId',
        'optionIds',
        'quantity',
      ]);
      const storage = await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      );
      assert.doesNotMatch(
        storage,
        /fixture-access|fixture-refresh|password|accessToken/,
      );
      await page.locator('.header-cart').click();
      await page.locator('.cart-modal[open]').waitFor();
      assert.equal(
        await page
          .getByLabel('장바구니 전체 합계', { exact: true })
          .textContent(),
        '18,000원',
      );
      assert.ok(
        (await page.locator('.cart-modal').textContent()).includes('주문'),
      );
    },
  );
  await scenario(
    '로그인 401 안내·재시도·중복 제출 차단',
    async (page, context, before) => {
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await login(page, 'customer@example.test', 'wrong-fixture-value');
      await page.getByRole('alert').filter({ hasText: '비밀번호' }).waitFor();
      assert.equal(fixture.counts.refresh - before.refresh, 1);
      assert.equal(
        await page.getByLabel('비밀번호', { exact: true }).inputValue(),
        '',
      );
      fixture.controls.delay = 150;
      await page
        .getByLabel('비밀번호', { exact: true })
        .fill('fixture-only-password');
      await page.locator('.login-form').evaluate((form) => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      });
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      assert.equal(fixture.counts.login - before.login, 2);
      assert.equal(fixture.getLastRememberMe(), false);
    },
  );
  await scenario(
    'STORE_ADMIN 브라우저 장바구니 허용·두 주문 경로 거부',
    async (page) => {
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await login(page, 'admin@example.test');
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      await page.locator('[data-menu-id="1"]').click();
      await page
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      assert.match(
        await page.locator('.cart-modal .action-notice').textContent(),
        /CUSTOMER/,
      );
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      assert.match(
        await page.locator('.detail-modal .selection-feedback').textContent(),
        /CUSTOMER/,
      );
    },
  );
  await scenario(
    'HttpOnly 쿠키 복원·AU02·204 로그아웃·저장 보존',
    async (page, context, before) => {
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await login(page);
      await page.locator('.login-modal').waitFor({ state: 'detached' });
      const cookie = (await context.cookies()).find(
        (entry) => entry.name === 'fixtureRefresh',
      );
      assert.equal(cookie.httpOnly, true);
      await page.locator('.menu-card:not([disabled])').first().click();
      await page
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      const saved = await page.evaluate(() =>
        localStorage.getItem('peak-order.cart.v1'),
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => location.hash !== '#cart');
      await page.reload();
      await page
        .getByRole('button', { name: '로그아웃', exact: true })
        .waitFor();
      assert.equal(fixture.counts.refresh - before.refresh, 2);
      assert.equal(fixture.counts.me - before.me, 2);
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
      assert.equal(fixture.counts.logout - before.logout, 1);
      assert.equal((await context.cookies()).length, 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        saved,
      );
    },
  );
  await scenario(
    '중첩 모달 Escape·Tab·포커스·스크롤·선택 복원',
    async (page) => {
      await page.locator('.menu-card:not([disabled])').first().click();
      const add = page.getByRole('button', {
        name: '이 메뉴만 바로 주문',
        exact: true,
      });
      await add.click();
      const modal = page.locator('.login-modal');
      await modal
        .getByRole('button', { name: '선택한 화면으로 돌아가기' })
        .focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute('aria-label'),
        ),
        '로그인 안내 닫기',
      );
      await page.keyboard.press('Shift+Tab');
      assert.match(
        await page.evaluate(() => document.activeElement?.textContent),
        /돌아가기/,
      );
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
      assert.equal(
        await add.evaluate((button) => button === document.activeElement),
        true,
      );
      assert.equal(await page.locator('.detail-modal[open]').count(), 1);
      assert.equal(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.notEqual(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
    },
  );
  await scenario('닫은 로그인 늦은 응답 적용 거부', async (page) => {
    fixture.controls.delay = 300;
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await login(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.equal(
      await page.getByRole('button', { name: '로그아웃', exact: true }).count(),
      0,
    );
    await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
  });
  await scenario(
    '네트워크 오류·403 무갱신·수동 재시도',
    async (page, context, before) => {
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.route('**/api/v1/auth/login', (route) =>
        route.abort('failed'),
      );
      await login(page);
      await page.getByRole('alert').filter({ hasText: '연결' }).waitFor();
      await page.unroute('**/api/v1/auth/login');
      fixture.controls.loginStatus = 403;
      await login(page);
      await page.getByRole('alert').filter({ hasText: '허용' }).waitFor();
      assert.equal(fixture.counts.refresh - before.refresh, 1);
      fixture.controls.loginStatus = 200;
      await login(page);
      await page.locator('.login-modal').waitFor({ state: 'detached' });
    },
  );
  await scenario(
    '모바일 로그인 입력·성공 후 장바구니·로그아웃 실패 재시도',
    async (page) => {
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await login(page);
      await page.locator('.header-cart').click();
      await page.locator('.cart-modal[open]').waitFor();
      assert.ok(
        await page
          .locator('.cart-modal')
          .evaluate(
            (element) =>
              element.getBoundingClientRect().width <= window.innerWidth,
          ),
      );
      await page.keyboard.press('Escape');
      fixture.controls.logoutStatus = 503;
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await page.getByRole('button', { name: '로그아웃 다시 시도' }).waitFor();
      fixture.controls.logoutStatus = 204;
      await page.getByRole('button', { name: '로그아웃 다시 시도' }).click();
      await page
        .getByRole('button', { name: '로그아웃 다시 시도' })
        .waitFor({ state: 'detached' });
    },
    true,
  );
} finally {
  await browser.close();
  await fixture.close();
  await writeFile(
    join(directory, 'results.json'),
    JSON.stringify(
      {
        browser: '실제 Windows Playwright Chromium',
        scope: '계약 Mock HTTP, 실제 Auth 미검증',
        results,
        pageErrors,
        unexpectedResponses,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(directory, 'gallery.html'),
    `<!doctype html><meta charset="utf-8"><title>#156 계약 Mock Chromium</title><h1>실제 Auth 서버 검증 아님</h1>${results.map((result, index) => `<h2>${result.status} ${result.name}</h2><img style="max-width:100%" src="${index + 1}.png">`).join('')}`,
  );
}
console.log(
  JSON.stringify(
    { directory, results, pageErrors, unexpectedResponses },
    null,
    2,
  ),
);
if (
  results.some((result) => result.status !== 'PASS') ||
  pageErrors.length ||
  unexpectedResponses.length
)
  process.exitCode = 1;
