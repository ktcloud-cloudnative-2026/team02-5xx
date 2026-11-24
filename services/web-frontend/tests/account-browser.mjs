import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startAccountFixture } from './account-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.ACCOUNT_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startAccountFixture();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(6000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const main = page.locator('main.account-page');
const patches = () =>
  fixture.requests.filter((r) => r.method === 'PATCH').length;
async function login(
  email = 'customer@example.test',
  password = 'fixture-only-password',
) {
  await main.getByRole('button', { name: '다시 로그인' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('이메일', { exact: true }).fill(email);
  await dialog.getByLabel('비밀번호', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '로그인', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await main
    .getByText('회원정보를 불러오는 중이에요.')
    .waitFor({ state: 'detached' });
}
async function route(hash) {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, hash);
}
async function passwordForm(current, next, confirm = next) {
  await main.getByLabel('현재 비밀번호', { exact: true }).fill(current);
  await main.getByLabel('새 비밀번호', { exact: true }).fill(next);
  await main.getByLabel('새 비밀번호 확인', { exact: true }).fill(confirm);
}
async function alert(text) {
  await main.getByRole('alert').filter({ hasText: text }).waitFor();
}
try {
  await page.goto(`${fixture.url}/#account`);
  await login();
  assert.match(await main.innerText(), /닉네임 미설정/);
  await page.screenshot({
    path: resolve(output, '01-account-desktop.png'),
    fullPage: true,
  });
  await main.getByRole('link', { name: '회원정보 수정' }).click();
  assert.equal(
    await main.getByLabel('이메일', { exact: true }).getAttribute('readonly'),
    '',
  );
  const nickname = main.getByLabel('닉네임', { exact: true });
  await nickname.fill(' ');
  await main.getByRole('button', { name: '저장', exact: true }).click();
  await alert('1~50');
  assert.equal(patches(), 0);
  await nickname.fill('😀'.repeat(51));
  await main.getByRole('button', { name: '저장', exact: true }).click();
  await alert('1~50');
  await nickname.fill(' 피크고객😀 ');
  fixture.controls.delay = 250;
  const before = patches();
  await main.getByRole('button', { name: '저장', exact: true }).dblclick();
  await main
    .getByRole('heading', { name: '마이페이지', exact: true })
    .waitFor();
  assert.equal(patches(), before + 1);
  assert.equal(await main.locator('h2').textContent(), ' 피크고객😀 ');
  await route('#menu-list');
  assert.equal(
    await page.getByLabel('로그인 사용자').textContent(),
    ' 피크고객😀 ',
  );
  await route('#account/profile');
  await page.screenshot({
    path: resolve(output, '02-profile-desktop.png'),
    fullPage: true,
  });
  fixture.controls.delay = 0;
  for (const status of [400, 403, 503]) {
    fixture.controls.status = status;
    await main.getByLabel('닉네임', { exact: true }).fill('error');
    await main.getByRole('button', { name: '저장', exact: true }).click();
    await alert(
      status === 400 ? '입력값' : status === 403 ? '권한' : '처리하지',
    );
  }
  fixture.controls.status = 200;
  await page.route('**/api/v1/auth/me', async (r) => {
    if (r.request().method() === 'PATCH') await r.abort('failed');
    else await r.continue();
  });
  await main.getByRole('button', { name: '저장', exact: true }).click();
  await alert('서버 연결');
  await page.unroute('**/api/v1/auth/me');
  await main.getByRole('link', { name: '취소', exact: true }).click();
  await main.getByRole('link', { name: '비밀번호 변경', exact: true }).click();
  await passwordForm('fixture-only-password', 'short');
  await main
    .getByRole('button', { name: '비밀번호 변경', exact: true })
    .click();
  await alert('12~64');
  await passwordForm(
    'fixture-only-password',
    'fixture-new-password',
    'different',
  );
  await main
    .getByRole('button', { name: '비밀번호 변경', exact: true })
    .click();
  await alert('확인이 일치');
  await passwordForm('incorrect-password', 'fixture-new-password');
  await main
    .getByRole('button', { name: '비밀번호 표시', exact: true })
    .click();
  assert.equal(
    await main
      .getByLabel('현재 비밀번호', { exact: true })
      .getAttribute('type'),
    'text',
  );
  await main
    .getByRole('button', { name: '비밀번호 숨기기', exact: true })
    .click();
  await main
    .getByRole('button', { name: '비밀번호 변경', exact: true })
    .click();
  await alert('현재 비밀번호가 일치');
  // Preserve the actual cart across password invalidation; product storage key.
  const { key } = await import('../src/cart.js').then((m) => ({
    key: m.CART_STORAGE_KEY,
  }));
  const cartKey = key ?? 'peak-order:cart:v1';
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      cartKey,
      JSON.stringify({
        version: 1,
        items: [{ menuId: 1, optionIds: [], quantity: 1 }],
      }),
    ],
  );
  const baseline = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  await page.screenshot({
    path: resolve(output, '03-password-desktop.png'),
    fullPage: true,
  });
  await passwordForm('fixture-only-password', 'fixture-new-password');
  const logoutBefore = fixture.requests.filter((r) =>
    r.path.endsWith('/logout'),
  ).length;
  await main
    .getByRole('button', { name: '비밀번호 변경', exact: true })
    .click();
  await main.getByRole('heading', { name: '비밀번호를 변경했어요' }).waitFor();
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/logout')).length,
    logoutBefore,
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
    baseline,
  );
  await page.screenshot({
    path: resolve(output, '04-relogin-desktop.png'),
    fullPage: true,
  });
  await login('customer@example.test', 'fixture-new-password');
  await route('#account');
  await main
    .getByRole('heading', { name: '마이페이지', exact: true })
    .waitFor();
  // Failed read and explicit retry.
  fixture.controls.meStatus = 503;
  await route('#menu-list');
  await page.getByLabel('로그인 사용자').waitFor();
  await route('#account');
  await alert('처리하지');
  fixture.controls.meStatus = 200;
  await main.getByRole('button', { name: '다시 조회' }).click();
  await main.getByRole('link', { name: '회원정보 수정' }).waitFor();
  // Mobile routes and keyboard focus.
  await route('#menu-list');
  await page.getByLabel('로그인 사용자').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [hash, name] of [
    ['#account', 'home'],
    ['#account/profile', 'profile'],
    ['#account/password', 'password'],
  ]) {
    await route(hash);
    await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
    await main
      .getByText('회원정보를 불러오는 중이에요.')
      .waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(output, `mobile-${name}.png`),
      fullPage: true,
    });
    await page.keyboard.press('Tab');
  }
  // 401 mutation logs out without refresh/replay.
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: resolve(output, 'mobile-320.png'),
    fullPage: true,
  });
  await route('#account/profile');
  fixture.controls.status = 401;
  await main.getByLabel('닉네임', { exact: true }).fill('expired');
  const refreshBefore = fixture.requests.filter((r) =>
    r.path.endsWith('/refresh'),
  ).length;
  await main.getByRole('button', { name: '저장', exact: true }).click();
  await main
    .getByText('인증이 만료됐어요. 다시 로그인해 주세요.', { exact: true })
    .waitFor();
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/refresh')).length,
    refreshBefore,
  );
  fixture.controls.status = 200;
  await login('admin@example.test', 'fixture-new-password');
  await main.getByRole('alert').filter({ hasText: 'CUSTOMER' }).waitFor();
  assert.equal(await main.locator('input').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Chromium desktop/mobile, AU-02/05/06, validation, 400/401/403/503/network, single submission, session/header sync, 204/relogin/no logout, cart storage, keyboard, CUSTOMER guard.',
  );
} finally {
  await browser.close();
  await fixture.close();
}
