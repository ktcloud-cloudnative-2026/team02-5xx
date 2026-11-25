import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { startAccountFixture } from './account-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output =
  process.env.ACCOUNT_RECOVERY_QA_OUTPUT || '../../.local/account-recovery';
await mkdir(output, { recursive: true });
const fixture = await startAccountFixture();
const browser = await chromium.launch({ headless: true });
const results = [];
let savedNickname = '';
let page, context, main;
const notice =
  '로그인을 다시 확인했어요. 입력한 내용을 확인하고 다시 저장해 주세요.';
const count = (ending) =>
  fixture.requests.filter((request) => request.path.endsWith(ending)).length;
const writes = () =>
  fixture.requests.filter((request) => request.method === 'PATCH');
const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.fail('condition timed out');
};
async function login(
  email = 'customer@example.test',
  password = 'fixture-only-password',
) {
  await main.getByRole('button', { name: '다시 로그인', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('이메일', { exact: true }).fill(email);
  await dialog.getByLabel('비밀번호', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '로그인', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
async function route(hash) {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
}
async function fresh(kind = 'password', email) {
  await context?.close();
  Object.assign(fixture.controls, {
    status: 200,
    delay: 0,
    meStatus: 200,
    refreshStatus: 200,
    refreshDelay: 0,
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  main = page.locator('main.account-page');
  await page.addInitScript(() => {
    localStorage.setItem(
      'peak-order.cart.v1',
      JSON.stringify({
        version: 1,
        items: [{ menuId: 1, optionIds: [1], quantity: 2 }],
      }),
    );
  });
  await page.goto(fixture.url + '/#account');
  await login(email);
  if (!email) {
    await route('#account/' + kind);
    await main
      .getByLabel(kind === 'profile' ? '닉네임' : '현재 비밀번호', {
        exact: true,
      })
      .waitFor();
  }
}
const field = (name) => main.getByLabel(name, { exact: true });
async function fill(kind) {
  if (kind === 'profile') await field('닉네임').fill(' keep 😀 ');
  else {
    await field('현재 비밀번호').fill('fixture-only-password');
    await field('새 비밀번호').fill('fixture-recovery-new-password');
    await field('새 비밀번호 확인').fill('fixture-recovery-new-password');
  }
}
const save = (kind) =>
  main.getByRole('button', {
    name: kind === 'profile' ? '저장' : '비밀번호 변경',
    exact: true,
  });
async function draft(kind, empty = false) {
  if (kind === 'profile')
    assert.ok(
      (await field('닉네임').inputValue()) ===
        (empty ? savedNickname : ' keep 😀 '),
      'nickname draft',
    );
  else
    for (const [name, value] of [
      ['현재 비밀번호', 'fixture-only-password'],
      ['새 비밀번호', 'fixture-recovery-new-password'],
      ['새 비밀번호 확인', 'fixture-recovery-new-password'],
    ])
      assert.ok(
        (await field(name).inputValue()) === (empty ? '' : value),
        'password draft state',
      );
}
const storage = () =>
  page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
async function run(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await page.screenshot({
      path: output + '/failure-' + results.length + '.png',
    });
    console.log('FAIL ' + name + ': ' + error.message);
  }
}
try {
  for (const kind of ['profile', 'password'])
    await run(
      `${kind}: 401 Refresh 성공·입력 유지·자동 PATCH 재전송 없음`,
      async () => {
        await fresh(kind);
        await fill(kind);
        const before = writes().length,
          refresh = count('/refresh'),
          saved = await storage();
        fixture.controls.status = 401;
        await save(kind).click();
        await main.getByRole('alert').filter({ hasText: notice }).waitFor();
        await draft(kind);
        assert.equal(writes().length, before + 1);
        assert.equal(count('/refresh'), refresh + 1);
        assert.equal(await storage(), saved);
        if (kind === 'profile') {
          fixture.controls.status = 200;
          await save(kind).click();
          await main
            .getByRole('heading', { name: '마이페이지', exact: true })
            .waitFor();
          assert.equal(writes().length, before + 2);
          assert.notEqual(
            writes().at(-1).accessVersion,
            writes().at(-2).accessVersion,
          );
          assert.equal(await main.locator('h2').textContent(), ' keep 😀 ');
          savedNickname = ' keep 😀 ';
        }
      },
    );
  for (const status of [401, 503, 'network'])
    await run(
      `Refresh ${status}: 인증 종료·재로그인 후 비밀번호 복원 없음`,
      async () => {
        await fresh();
        await fill('password');
        const before = writes().length,
          refresh = count('/refresh'),
          saved = await storage();
        fixture.controls.status = 401;
        if (status === 'network')
          await page.route('**/api/v1/auth/refresh', (route) =>
            route.abort('failed'),
          );
        else fixture.controls.refreshStatus = status;
        await save('password').click();
        await main
          .getByText('로그인이 만료됐어요. 다시 로그인해 주세요.', {
            exact: true,
          })
          .waitFor();
        assert.equal(writes().length, before + 1);
        if (status !== 'network') assert.equal(count('/refresh'), refresh + 1);
        await page.unroute('**/api/v1/auth/refresh');
        Object.assign(fixture.controls, { status: 200, refreshStatus: 200 });
        await login();
        await field('현재 비밀번호').waitFor();
        await draft('password', true);
        assert.equal(await storage(), saved);
      },
    );
  for (const status of [400, 403, 503])
    await run(`변경 ${status}: 불필요한 Refresh 없음·닉네임 유지`, async () => {
      await fresh('profile');
      await fill('profile');
      fixture.controls.status = status;
      const refresh = count('/refresh'),
        before = writes().length;
      await save('profile').click();
      await until(async () => !(await save('profile').isDisabled()));
      await draft('profile');
      assert.equal(count('/refresh'), refresh);
      assert.equal(writes().length, before + 1);
    });
  await run('Refresh 진행 중 중복 제출 잠금', async () => {
    await fresh('profile');
    await fill('profile');
    fixture.controls.status = 401;
    const before = writes().length,
      refresh = count('/refresh');
    let release;
    const held = new Promise((done) => {
      release = done;
    });
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await held;
      await route.continue();
    });
    const started = page.waitForRequest((request) =>
      request.url().endsWith('/auth/refresh'),
    );
    try {
      await save('profile').click();
      await started;
      assert.equal(
        await main.locator('button[type=submit]').isDisabled(),
        true,
      );
      await main.locator('form').evaluate((form) => form.requestSubmit());
    } finally {
      release();
    }
    await main.getByRole('alert').filter({ hasText: notice }).waitFor();
    assert.equal(writes().length, before + 1);
    assert.equal(count('/refresh'), refresh + 1);
    await page.unroute('**/api/v1/auth/refresh');
    await draft('profile');
  });
  for (const kind of ['profile', 'password'])
    await run(
      `${kind}: 취소 후 늦은 Refresh가 폼·안내를 복원하지 않음`,
      async () => {
        await fresh(kind);
        await fill(kind);
        if (kind === 'profile')
          await field('닉네임').fill(' cancelled unsaved draft ');
        fixture.controls.status = 401;
        const refresh = count('/refresh'),
          before = writes().length;
        const completed = page.waitForResponse((response) =>
          response.url().endsWith('/auth/refresh'),
        );
        let release;
        const held = new Promise((done) => {
          release = done;
        });
        await page.route('**/api/v1/auth/refresh', async (route) => {
          await held;
          await route.continue();
        });
        const started = page.waitForRequest((request) =>
          request.url().endsWith('/auth/refresh'),
        );
        await save(kind).click();
        await started;
        await main.getByRole('link', { name: '취소', exact: true }).click();
        release();
        await completed;
        await page.unroute('**/api/v1/auth/refresh');
        assert.equal(count('/refresh'), refresh + 1);
        await main
          .getByRole('heading', { name: '마이페이지', exact: true })
          .waitFor();
        await new Promise((done) => setTimeout(done, 60));
        assert.equal(await main.getByText(notice, { exact: true }).count(), 0);
        assert.equal(writes().length, before + 1);
        fixture.controls.status = 200;
        await route('#account/' + kind);
        await field(kind === 'profile' ? '닉네임' : '현재 비밀번호').waitFor();
        await draft(kind, true);
      },
    );
  await run(
    '로그아웃 후 늦은 Refresh가 이전 계정·입력을 복원하지 않음',
    async () => {
      await fresh();
      await fill('password');
      Object.assign(fixture.controls, { status: 401, refreshDelay: 500 });
      const refresh = count('/refresh');
      await save('password').click();
      await until(() => count('/refresh') === refresh + 1);
      await page
        .getByRole('button', { name: '로그아웃', exact: true })
        .first()
        .click();
      await until(() => count('/logout') > 0);
      await main
        .getByRole('button', { name: '다시 로그인', exact: true })
        .waitFor();
      assert.equal(await main.locator('input').count(), 0);
    },
  );
  await run('CUSTOMER 외 계정은 변경 입력·PATCH 진입 차단', async () => {
    await fresh('password', 'admin@example.test');
    await main.getByRole('alert').filter({ hasText: '고객용 계정' }).waitFor();
    const before = writes().length;
    await route('#account/password');
    await main.getByRole('alert').filter({ hasText: '고객용 계정' }).waitFor();
    assert.equal(await main.locator('input').count(), 0);
    assert.equal(writes().length, before);
  });
  await run(
    '비밀번호 401 복구 후 명시적 재제출·204·Refresh 전체 폐기 안내·추가 logout 없음',
    async () => {
      await fresh();
      await fill('password');
      fixture.controls.status = 401;
      const before = writes().length,
        logouts = count('/logout'),
        saved = await storage();
      await save('password').click();
      await main.getByRole('alert').filter({ hasText: notice }).waitFor();
      await draft('password');
      assert.match(await main.textContent(), /모든 기기.*자동 로그인/s);
      fixture.controls.status = 200;
      await save('password').click();
      await main
        .getByRole('heading', { name: '비밀번호를 변경했어요', exact: true })
        .waitFor();
      assert.equal(writes().length, before + 2);
      assert.notEqual(
        writes().at(-1).accessVersion,
        writes().at(-2).accessVersion,
      );
      assert.equal(count('/logout'), logouts);
      assert.equal(await storage(), saved);
      await login('customer@example.test', 'fixture-recovery-new-password');
      await field('현재 비밀번호').waitFor();
      await draft('password', true);
    },
  );
} finally {
  await writeFile(
    output + '/results.json',
    JSON.stringify({ results }, null, 2),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
