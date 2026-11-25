import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startRegistrationFixture } from './registration-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.REGISTRATION_QA_OUTPUT);
await mkdir(output, { recursive: true });
const fixture = await startRegistrationFixture(),
  browser = await chromium.launch({ headless: true });
let page, context, errors;
const results = [];
const cart = {
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
};
const modal = () => page.locator('.login-modal');
async function fresh(width = 1440, missing = false, ignore = false) {
  await context?.close();
  Object.assign(fixture.registrationControls, {
    checkDelay: 0,
    registerDelay: 0,
    registerStatus: 201,
    code: '',
    taken: new Set(['taken@example.test']),
    delays: new Map(),
  });
  fixture.registrationCounts.check = 0;
  fixture.registrationCounts.register = 0;
  fixture.protocol.length = 0;
  context = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ({ cart, ignore }) => {
      localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart));
      window.__ignoreRegistrationAbort = ignore;
    },
    { cart, ignore },
  );
  await page.goto(
    `${fixture.url}/${missing ? '?missing-terms' : ''}#menu-list`,
  );
  await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
}
async function open() {
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await modal().getByRole('button', { name: '회원가입', exact: true }).click();
  await modal()
    .getByRole('heading', { name: '회원가입', exact: true })
    .waitFor();
}
async function fill(
  email = 'new@example.test',
  password = 'fixture-only-password',
) {
  await modal().getByLabel('이메일', { exact: true }).fill(email);
  await modal().getByRole('button', { name: '이메일 중복 확인' }).click();
  await modal()
    .getByText('사용할 수 있는 이메일이에요.', { exact: true })
    .waitFor();
  await modal().getByLabel('가입 비밀번호', { exact: true }).fill(password);
  await modal()
    .getByLabel('가입 비밀번호 확인', { exact: true })
    .fill(password);
  await modal().getByLabel('전체 동의', { exact: true }).check();
}
async function check(name, run) {
  try {
    await run();
    assert.deepEqual(errors, []);
    assert.ok(
      fixture.protocol.every((r) => !r.authorization && !r.fakeIdentity),
    );
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
    await page
      ?.screenshot({ path: resolve(output, `FAIL-${results.length}.png`) })
      .catch(() => {});
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  await check(
    'signup/login backdrop requires both press and release outside; drags preserve form and close/Escape still work',
    async () => {
      for (const kind of ['signup', 'login']) {
        await fresh();
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        const dialog = modal();
        if (kind === 'signup') {
          await dialog
            .getByRole('button', { name: '회원가입', exact: true })
            .click();
          await fill('drag@example.test');
        }
        const box = await dialog.boundingBox();
        const inside = { x: box.x + box.width / 2, y: box.y + 35 };
        const outside = { x: box.x - 15, y: inside.y };
        async function drag(from, to) {
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 8 });
          await page.mouse.up();
        }
        for (const [from, to] of [
          [inside, inside],
          [inside, outside],
          [outside, inside],
        ]) {
          await drag(from, to);
          assert.equal(await dialog.isVisible(), true);
        }
        const heading = await dialog.locator('h2').first().boundingBox();
        await drag(
          { x: heading.x + 5, y: heading.y + 10 },
          { x: heading.x + Math.min(heading.width - 5, 90), y: heading.y + 10 },
        );
        assert.equal(await dialog.isVisible(), true);
        if (kind === 'signup') {
          assert.equal(
            await dialog.getByLabel('이메일', { exact: true }).inputValue(),
            'drag@example.test',
          );
          assert.equal(
            await dialog
              .getByLabel('가입 비밀번호', { exact: true })
              .inputValue(),
            'fixture-only-password',
          );
          assert.equal(
            await dialog.getByLabel('전체 동의', { exact: true }).isChecked(),
            true,
          );
        }
        await drag(outside, outside);
        await dialog.waitFor({ state: 'detached' });
      }
      for (const action of ['close', 'escape']) {
        await fresh();
        await open();
        if (action === 'escape') await page.keyboard.press('Escape');
        else await modal().locator('.close-button').click();
        await modal().waitFor({ state: 'detached' });
      }
    },
  );
  await check(
    'product terms absent: form reachable, AU-04 allowed, consents and registration disabled',
    async () => {
      await fresh(1440, true);
      await open();
      await modal()
        .getByText(
          '확정된 이용약관·개인정보 처리 동의 내용과 버전을 확인할 수 없어 현재 회원가입을 진행할 수 없어요.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await modal()
          .getByRole('button', { name: '회원가입 요청', exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await modal().getByLabel('전체 동의', { exact: true }).isDisabled(),
        true,
      );
      assert.equal(fixture.registrationCounts.register, 0);
      await page.screenshot({
        path: resolve(output, 'product-terms-blocked.png'),
      });
    },
  );
  await check(
    'demo-v1 full policies open/scroll/close by keyboard, preserving inputs, consent and dialog focus',
    async () => {
      for (const width of [1440, 390, 320]) {
        await fresh(width);
        await open();
        await fill(`policies${width}@example.test`);
        for (const title of ['시연용 이용약관', '시연용 개인정보 처리방침']) {
          const summary = modal().locator('summary').filter({ hasText: title });
          await summary.focus();
          await page.keyboard.press('Enter');
          const region = modal().getByRole('region', {
            name: `${title} 전문`,
            exact: true,
          });
          await region.waitFor({ state: 'visible' });
          assert.ok((await region.innerText()).length > 500);
          assert.equal(
            await summary
              .locator('..')
              .getByText('버전: demo-v1', { exact: true })
              .count(),
            1,
          );
          await region.focus();
          await page.keyboard.press('End');
          assert.ok(
            await region.evaluate((e) => e.scrollHeight > e.clientHeight),
          );
          assert.ok(
            await modal().evaluate((e) => e.scrollWidth <= e.clientWidth),
          );
          await page.screenshot({
            path: resolve(
              output,
              `policy-${title.includes('개인정보') ? 'privacy' : 'terms'}-${width}.png`,
            ),
          });
          await page.keyboard.press('Escape');
          assert.equal(
            await summary.evaluate((e) => e === document.activeElement),
            true,
          );
          assert.equal(await region.isVisible(), false);
          assert.equal(
            await modal().getByLabel('이메일', { exact: true }).inputValue(),
            `policies${width}@example.test`,
          );
          assert.equal(
            await modal().getByLabel('전체 동의', { exact: true }).isChecked(),
            true,
          );
          assert.equal(
            await page.evaluate(() => document.body.style.overflow),
            'hidden',
          );
        }
        const first = modal()
          .locator('button:not(:disabled),input:not(:disabled),summary')
          .first();
        await first.focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await modal()
            .getByRole('button', { name: '로그인으로 돌아가기', exact: true })
            .evaluate((e) => e === document.activeElement),
          true,
        );
      }
    },
  );
  await check(
    'desktop registration succeeds once, returns normalized email to login without session or cart mutation',
    async () => {
      await fresh();
      await open();
      await fill('Member@EXAMPLE.Test');
      await page.screenshot({
        path: resolve(output, 'registration-desktop.png'),
      });
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      await modal()
        .getByText(
          '회원가입을 완료했어요. 자동 로그인되지 않으니 새 계정으로 로그인해 주세요.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await modal().getByLabel('이메일', { exact: true }).inputValue(),
        'Member@example.test',
      );
      assert.equal(
        await modal().getByLabel('비밀번호', { exact: true }).inputValue(),
        '',
      );
      assert.equal(
        await page.evaluate(
          () => window.__registration.session.getSnapshot().authenticated,
        ),
        false,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        cart,
      );
      assert.equal(fixture.registrationCounts.register, 1);
      assert.equal(fixture.counts.login, 0);
      await page.screenshot({
        path: resolve(output, 'registration-success.png'),
      });
    },
  );
  await check(
    'email edit invalidates availability and ignores an abort-ignoring late previous response',
    async () => {
      await fresh(1440, false, true);
      await open();
      fixture.registrationControls.delays.set('old@example.test', 350);
      await modal()
        .getByLabel('이메일', { exact: true })
        .fill('old@example.test');
      await modal().getByRole('button', { name: '이메일 중복 확인' }).click();
      await modal()
        .getByLabel('이메일', { exact: true })
        .fill('taken@example.test');
      await modal().getByRole('button', { name: '이메일 중복 확인' }).click();
      await modal()
        .getByText('이미 가입된 이메일이에요.', { exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      assert.equal(
        await modal()
          .getByText('사용할 수 있는 이메일이에요.', { exact: true })
          .count(),
        0,
      );
      await modal()
        .getByLabel('이메일', { exact: true })
        .fill('fresh@example.test');
      await modal()
        .getByLabel('가입 비밀번호', { exact: true })
        .fill('fixture-only-password');
      await modal()
        .getByLabel('가입 비밀번호 확인', { exact: true })
        .fill('fixture-only-password');
      await modal().getByLabel('전체 동의', { exact: true }).check();
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      await modal()
        .getByText('현재 이메일의 중복 확인을 완료해 주세요.', { exact: true })
        .waitFor();
      assert.equal(fixture.registrationCounts.register, 0);
    },
  );
  await check(
    'password match/length, visibility and all/individual consent synchronize without premature POST',
    async () => {
      await fresh();
      await open();
      await fill();
      await modal()
        .getByLabel('가입 비밀번호 확인', { exact: true })
        .fill('different-password');
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      await modal()
        .getByText('비밀번호 확인이 일치하지 않아요.', { exact: true })
        .waitFor();
      await modal().getByLabel('가입 비밀번호', { exact: true }).fill('short');
      await modal()
        .getByLabel('가입 비밀번호 확인', { exact: true })
        .fill('short');
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      assert.equal(fixture.registrationCounts.register, 0);
      await modal()
        .getByRole('button', { name: '비밀번호 보기', exact: true })
        .click();
      assert.equal(
        await modal()
          .getByLabel('가입 비밀번호', { exact: true })
          .getAttribute('type'),
        'text',
      );
      await modal()
        .getByLabel('이용약관 동의 (필수)', { exact: true })
        .uncheck();
      assert.equal(
        await modal().getByLabel('전체 동의', { exact: true }).isChecked(),
        false,
      );
      assert.equal(
        await modal()
          .getByLabel('전체 동의', { exact: true })
          .evaluate((e) => e.indeterminate),
        true,
      );
      await modal().getByLabel('전체 동의', { exact: true }).check();
      assert.equal(
        await modal()
          .getByLabel('이용약관 동의 (필수)', { exact: true })
          .isChecked(),
        true,
      );
      await modal().getByLabel('전체 동의', { exact: true }).uncheck();
      assert.equal(
        await modal()
          .getByLabel('개인정보 수집·이용 동의 (필수)', { exact: true })
          .isChecked(),
        false,
      );
    },
  );
  await check(
    '409 after availability and server input/agreement/503 errors never echo sensitive responses or fake success',
    async () => {
      for (const [status, code] of [
        [409, 'EMAIL_ALREADY_EXISTS'],
        [400, 'INVALID_REQUEST'],
        [400, 'REQUIRED_AGREEMENT_MISSING'],
        [400, 'INVALID_AGREEMENT_VERSION'],
        [503, 'REGISTRATION_UNAVAILABLE'],
      ]) {
        await fresh();
        await open();
        await fill();
        Object.assign(fixture.registrationControls, {
          registerStatus: status,
          code,
        });
        await modal()
          .getByRole('button', { name: '회원가입 요청', exact: true })
          .click();
        await modal().locator('.login-error[role=alert]').waitFor();
        assert.equal(
          await modal()
            .getByRole('heading', { name: '회원가입', exact: true })
            .count(),
          1,
        );
        assert.equal(
          await modal()
            .getByLabel('가입 비밀번호', { exact: true })
            .inputValue(),
          '',
        );
        assert.equal(
          await modal()
            .getByText('사용할 수 있는 이메일이에요.', { exact: true })
            .count(),
          0,
        );
        assert.equal(fixture.registrationCounts.register, 1);
        await page.screenshot({
          path: resolve(output, `registration-error-${code}.png`),
        });
        if (code === 'INVALID_AGREEMENT_VERSION')
          assert.equal(
            await modal()
              .getByRole('button', { name: '회원가입 요청', exact: true })
              .isDisabled(),
            true,
          );
      }
    },
  );
  await check(
    'double check/submit start one request; closing pending registration fences late success',
    async () => {
      await fresh();
      await open();
      fixture.registrationControls.checkDelay = 120;
      await modal()
        .getByLabel('이메일', { exact: true })
        .fill('double@example.test');
      await modal()
        .getByRole('button', { name: '이메일 중복 확인' })
        .evaluate((b) => {
          b.click();
          b.click();
        });
      await modal()
        .getByText('사용할 수 있는 이메일이에요.', { exact: true })
        .waitFor();
      assert.equal(fixture.registrationCounts.check, 1);
      await modal()
        .getByLabel('가입 비밀번호', { exact: true })
        .fill('fixture-only-password');
      await modal()
        .getByLabel('가입 비밀번호 확인', { exact: true })
        .fill('fixture-only-password');
      await modal().getByLabel('전체 동의', { exact: true }).check();
      fixture.registrationControls.registerDelay = 300;
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .evaluate((b) => {
          b.click();
          b.click();
        });
      await page.keyboard.press('Escape');
      await modal().waitFor({ state: 'detached' });
      await page.waitForTimeout(350);
      assert.equal(fixture.registrationCounts.register, 1);
      assert.equal(await modal().count(), 0);
      assert.equal(fixture.counts.login, 0);
    },
  );
  await check(
    'unknown registration network result clears credentials/check state and never retries POST automatically',
    async () => {
      await fresh();
      await open();
      await fill('network@example.test');
      let attempts = 0;
      await page.route('**/api/v1/auth/register', (route) => {
        attempts++;
        return route.abort();
      });
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      await modal()
        .getByText(
          '연결이 끊겼어요. 이메일 중복 확인이나 로그인으로 가입 결과를 확인해 주세요.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await modal().getByLabel('가입 비밀번호', { exact: true }).inputValue(),
        '',
      );
      assert.equal(
        await modal()
          .getByText('사용할 수 있는 이메일이에요.', { exact: true })
          .count(),
        0,
      );
      assert.equal(attempts, 1);
      await page.waitForTimeout(100);
      assert.equal(attempts, 1);
    },
  );
  await check(
    'same dialog retains scroll lock, Tab/Escape behavior and login return focus with selected menu untouched',
    async () => {
      await fresh();
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('.detail-modal');
      await detail.locator('input[value="2"]').check();
      await detail
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await detail
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await modal()
        .getByRole('button', { name: '회원가입', exact: true })
        .click();
      const lock = await page.evaluate(() => document.body.style.overflow);
      assert.equal(lock, 'hidden');
      await modal()
        .getByRole('button', { name: '로그인으로 돌아가기', exact: true })
        .click();
      assert.equal(
        await modal()
          .getByRole('button', { name: '회원가입', exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await modal()
        .getByRole('button', { name: '회원가입', exact: true })
        .click();
      const controls = modal().locator(
        'button:not(:disabled),input:not(:disabled)',
      );
      await controls.last().focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await controls.first().evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press('Escape');
      await modal().waitFor({ state: 'detached' });
      assert.equal(await detail.locator('input[value="2"]').isChecked(), true);
      assert.equal(await detail.getByLabel('선택 수량').innerText(), '2');
      assert.equal(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    },
  );
  await check(
    'signup does not consume pending cart order; explicit existing-account login resumes once',
    async () => {
      await fresh();
      await page.locator('.cart-nav').click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await modal()
        .getByRole('button', { name: '회원가입', exact: true })
        .click();
      await fill('pending@example.test');
      await modal()
        .getByRole('button', { name: '회원가입 요청', exact: true })
        .click();
      await modal()
        .getByText('회원가입을 완료했어요.', { exact: false })
        .waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        0,
      );
      await modal()
        .getByLabel('이메일', { exact: true })
        .fill('customer@example.test');
      await modal()
        .getByLabel('비밀번호', { exact: true })
        .fill('fixture-only-password');
      await modal().locator('.login-form button[type=submit]').click();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .waitFor();
      assert.equal(fixture.counts.login, 1);
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).waitFor();
      assert.equal(
        fixture.requests.filter((r) => r.path === '/api/v1/orders').length,
        1,
      );
    },
  );
  await check(
    'History back during signup closes auth and preserves cart without delayed reopening',
    async () => {
      await fresh();
      await page.locator('.cart-nav').click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await modal()
        .getByRole('button', { name: '회원가입', exact: true })
        .click();
      await page.goBack();
      await modal().waitFor({ state: 'detached' });
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('peak-order.cart.v1')),
        ),
        cart,
      );
    },
  );
  await check(
    'mobile 390/320 forms scroll without horizontal overflow and keep action buttons reachable',
    async () => {
      for (const width of [390, 320]) {
        await fresh(width);
        await open();
        await fill(`mobile${width}@example.test`);
        await modal()
          .getByRole('button', { name: '회원가입 요청', exact: true })
          .scrollIntoViewIfNeeded();
        assert.ok(
          await modal().evaluate((e) => e.scrollWidth <= e.clientWidth),
        );
        await page.screenshot({
          path: resolve(output, `registration-${width}.png`),
        });
        await modal()
          .getByRole('button', { name: '회원가입 요청', exact: true })
          .click();
        await modal()
          .getByText('회원가입을 완료했어요.', { exact: false })
          .waitFor();
      }
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        note: 'Chromium + local HTTP fixture with synthetic terms only. Actual Auth/Gateway registration not verified.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1;
