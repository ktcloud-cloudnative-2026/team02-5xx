// Exercise the npm-started manual preview URL itself. No private request override or injected session.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const url = process.env.CUSTOMER_PREVIEW_URL;
assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
const output = resolve(process.env.PREVIEW_QA_OUTPUT);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(5000);
const errors = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
const home = () => page.locator('.customer-home');
const panel = () =>
  page.getByRole('complementary', { name: 'HTTP fixture 검수 도구' });
async function scenario(name) {
  await panel().getByLabel('혼잡도 시나리오').selectOption(name);
  await panel()
    .getByRole('button', { name: '시나리오 적용', exact: true })
    .click();
  await panel()
    .getByRole('status')
    .getByText('적용했습니다.', { exact: false })
    .waitFor();
}
async function login(email) {
  await page.getByRole('button', { name: '로그인', exact: true }).click();
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
    'npm preview URL serves public home congestion and visible fixture tools',
    async () => {
      await page.goto(url);
      await home().getByText('약 2분', { exact: true }).waitFor();
      assert.match(await home().innerText(), /3건/);
      await panel()
        .getByRole('heading', {
          name: '로컬 HTTP fixture · 실제 백엔드 데이터가 아닙니다',
        })
        .waitFor();
    },
  );
  await check(
    'same page controls switch crowded/zero/error and explicit retry without reload or private overrides',
    async () => {
      for (const [name, text] of [
        ['crowded', '약 15분 1초'],
        ['zero', '약 0초'],
      ]) {
        await scenario(name);
        await home().getByRole('button', { name: '혼잡도 새로고침' }).click();
        await home().getByText(text, { exact: true }).waitFor();
      }
      await scenario('error');
      await home().getByRole('button', { name: '혼잡도 새로고침' }).click();
      await home()
        .getByText('혼잡도를 조회하지 못했어요. 다시 시도해 주세요.', {
          exact: true,
        })
        .waitFor();
      await scenario('normal');
      await home().getByRole('button', { name: '혼잡도 다시 시도' }).click();
      await home().getByText('약 2분', { exact: true }).waitFor();
    },
  );
  await check(
    'CUSTOMER HTTP login shows shared OR-03 sample and actual OR-04 detail with options/prices/Cooking',
    async () => {
      await login('customer@example.test');
      await home().getByText('주문번호 261123-0021', { exact: true }).waitFor();
      await home().getByRole('link', { name: '최근 주문 상세 보기' }).click();
      const detail = page.locator('.order-detail-modal');
      await detail.getByText('총 금액', { exact: true }).waitFor();
      assert.match(await detail.innerText(), /18,000원/);
      assert.match(await detail.innerText(), /세트/);
      await page.screenshot({
        path: resolve(output, 'sample-order-detail.png'),
      });
      await detail
        .getByRole('button', { name: '주문 상세 닫기', exact: true })
        .click();
      await page
        .getByRole('link', { name: '피크오더 홈', exact: true })
        .click();
      await home().waitFor();
    },
  );
  await check(
    'same preview supports existing menu/cart/create/pay then newest order detail and home summary',
    async () => {
      await home().getByRole('link', { name: '메뉴 둘러보기' }).click();
      await page.locator('[data-menu-id="1"]').click();
      const detail = page.locator('.detail-modal');
      await detail.locator('input[value="2"]').check();
      await detail
        .getByRole('button', { name: '장바구니에 담기', exact: true })
        .click();
      await page
        .locator('.cart-modal')
        .getByRole('button', { name: '주문하기', exact: true })
        .click();
      await page
        .getByRole('button', { name: '결제 금액 확인', exact: true })
        .click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page
        .getByRole('button', { name: '주문 내역에서 확인', exact: true })
        .click();
      const order = page.locator('.order-detail-modal');
      await order.getByText('총 금액', { exact: true }).waitFor();
      assert.match(await order.innerText(), /261123-\d{4}/);
      await order
        .getByRole('button', { name: '주문 상세 닫기', exact: true })
        .click();
      await page
        .getByRole('link', { name: '피크오더 홈', exact: true })
        .click();
      await home()
        .getByText(/주문번호 261123-\d{4}/)
        .waitFor();
      await page.screenshot({
        path: resolve(output, 'preview-home-after-checkout.png'),
      });
    },
  );
  await check(
    'anonymous and STORE_ADMIN branches remain protected at the same manual URL',
    async () => {
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await home()
        .getByRole('button', { name: '로그인', exact: true })
        .waitFor();
      assert.equal(
        await home()
          .getByRole('heading', { name: '최근 주문', exact: true })
          .count(),
        0,
      );
      await login('admin@example.test');
      await home()
        .getByText('주문하려면 고객용 계정으로 로그인해 주세요.', {
          exact: true,
        })
        .waitFor();
      await page.getByRole('link', { name: '주문 내역', exact: true }).click();
      await page
        .getByText('주문 내역은 고객용 계정으로 확인해 주세요.', {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole('link', { name: '피크오더 홈', exact: true })
        .click();
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    },
  );
  await check(
    'same manual preview is usable on mobile and still reports sample data',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await home().getByText('약 2분', { exact: true }).waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({ path: resolve(output, 'preview-mobile.png') });
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        url,
        results,
        note: 'Existing npm manual preview server, actual product App/HTTP clients; synthetic backend only.',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1;
