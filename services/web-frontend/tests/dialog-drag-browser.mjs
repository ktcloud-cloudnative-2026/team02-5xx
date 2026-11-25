// Real Chromium mouse down/move/up against product components, never dispatchEvent(click).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
import { startUiFixture } from './ui-fixture.mjs';
import { startAdminPreview } from '../scripts/admin-preview.mjs';
import {
  dragMatrix,
  pointerGesture,
  exposeTestBackdrop,
} from './dialog-drag-helpers.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = process.env.DIALOG_QA_OUTPUT || '../../.local/dialog-drag-qa';
await mkdir(output, { recursive: true });
const customer = await startCustomerHttpFixture({
  preview: true,
  input: resolve('tests/integration-boundary-entry.jsx'),
});
const checkout = await startUiFixture({
  entryFile: 'tests/checkout-browser-entry.jsx',
});
const adminMenu = await startAdminPreview();
const browser = await chromium.launch({ headless: true });
const results = [];
let page, context;
async function fresh(url, width = 1440) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.addInitScript(() =>
    localStorage.setItem(
      'peak-order.cart.v1',
      JSON.stringify({
        version: 1,
        items: [{ menuId: 1, optionIds: [1], quantity: 1 }],
      }),
    ),
  );
  await page.goto(url);
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.fail('condition timed out');
}
const button = (name) => page.getByRole('button', { name, exact: true });
async function login() {
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
  await page.locator('.login-modal').waitFor({ state: 'detached' });
}
async function run(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await page.screenshot({
      path: `${output}/failure-${results.length}.png`,
      fullPage: false,
    });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
try {
  await run(
    '메뉴 상세: 양방향 드래그·내부 클릭·바깥 down/up·포커스·스크롤',
    async () => {
      await fresh(customer.url + '/#menu-list');
      const trigger = page.locator('[data-menu-id="1"]');
      await trigger.click();
      const modal = page.locator('.detail-modal[open]');
      await modal.waitFor();
      await dragMatrix(page, modal);
      await exposeTestBackdrop(modal);
      const points = await dragMatrix(page, modal);
      assert.equal(points.outsideAvailable, true);
      await pointerGesture(page, points.outside, points.outside);
      await modal.waitFor({ state: 'detached' });
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
      );
      assert.notEqual(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
    },
  );
  await run(
    '중첩 로그인: 드래그 유지·최상단만 바깥 닫기·하위 상세 유지',
    async () => {
      await fresh(customer.url + '/#menu-list');
      await page.locator('[data-menu-id="1"]').click();
      const trigger = button('이 메뉴만 바로 주문');
      await trigger.click();
      const modal = page.locator('.login-modal[open]');
      const points = await dragMatrix(page, modal);
      await pointerGesture(page, points.outside, points.outside);
      await modal.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.detail-modal[open]').count(), 1);
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
      );
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
  await run('장바구니: 실제 포인터 드래그·바깥 닫기', async () => {
    await fresh(checkout.url + '/#cart');
    const modal = page.locator('.cart-modal[open]');
    await modal.waitFor();
    const points = await dragMatrix(page, modal);
    await pointerGesture(page, points.outside, points.outside);
    await modal.waitFor({ state: 'detached' });
  });
  await run('예상시간: 양방향 드래그·Escape·취소 시 선택 복원', async () => {
    await fresh(checkout.url + '/#menu-list');
    await page.locator('[data-menu-id="1"]').click();
    await button('이 메뉴만 바로 주문').click();
    const modal = page.locator('.estimate-modal[open]');
    await modal.waitFor();
    await dragMatrix(page, modal);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.detail-modal[open]').count(), 1);
    assert.equal(
      await page.evaluate(() => window.__checkoutQA.calls.create),
      0,
    );
  });
  await run(
    'Checkout: 드래그 유지·바깥 클릭은 이탈 확인·Escape·명시적 이탈',
    async () => {
      await fresh(checkout.url + '/#cart');
      await button('주문하기').click();
      await button('모의 주문 금액 확인').click();
      await page.getByRole('button', { name: /원 모의 결제$/ }).waitFor();
      const modal = page.locator('.checkout-page[open]');
      await dragMatrix(page, modal);
      await exposeTestBackdrop(modal);
      const points = await dragMatrix(page, modal);
      assert.equal(await page.locator('.exit-confirmation').count(), 0);
      await pointerGesture(page, points.outside, points.outside);
      await page.locator('.exit-confirmation').waitFor();
      assert.equal(await modal.evaluate((node) => node.open), true);
      await button('이 화면에서 계속 확인').click();
      await page.keyboard.press('Escape');
      await page.locator('.exit-confirmation').waitFor();
      await button('안내 확인 후 나가기').click();
      await modal.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.cart-modal[open]').count(), 1);
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        1,
      );
    },
  );
  await run(
    'Checkout 결제 진행 중: Escape는 확인만 표시·중복 결제 없음',
    async () => {
      await fresh(checkout.url + '/#cart');
      await button('주문하기').click();
      await button('모의 주문 금액 확인').click();
      const pay = page.getByRole('button', { name: /원 모의 결제$/ });
      await pay.waitFor();
      await page.evaluate(() => window.__checkoutQA.holdPaidResponse());
      await pay.click();
      await page.keyboard.press('Escape');
      await page.locator('.exit-confirmation').waitFor();
      assert.equal(await page.locator('.checkout-page[open]').count(), 1);
      assert.equal(await button('모의 결제 진행 중…').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 1);
      await button('이 화면에서 계속 확인').click();
      await until(() =>
        page.evaluate(() => window.__checkoutQA.paidResponseWaiting),
      );
      await page.evaluate(() => window.__checkoutQA.releasePaidResponse());
    },
  );
  await run(
    '주문 상세·취소 확인: 양방향 드래그·최상단 Escape·포커스 복귀',
    async () => {
      await fresh(customer.url + '/#orders');
      await login();
      const trigger = page.getByRole('link', { name: '상세 보기 ›' }).first();
      await trigger.click();
      const modal = page.locator('.order-detail-modal[open]');
      await modal.getByText('총 금액', { exact: true }).waitFor();
      await dragMatrix(page, modal);
      const cancel = button('주문 취소');
      await cancel.click();
      const confirm = page.locator('.order-confirm[open]');
      const points = await dragMatrix(page, confirm);
      await pointerGesture(page, points.outside, points.outside);
      await confirm.waitFor({ state: 'detached' });
      assert.equal(await modal.evaluate((node) => node.open), true);
      assert.equal(
        await cancel.evaluate((node) => node === document.activeElement),
        true,
      );
      await cancel.click();
      await page.keyboard.press('Escape');
      await confirm.waitFor({ state: 'detached' });
      assert.equal(await modal.evaluate((node) => node.open), true);
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
      assert.notEqual(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
    },
  );
  for (const width of [390, 320])
    await run(`${width}px: 고객 모달 내부 드래그·Escape·스크롤`, async () => {
      await fresh(customer.url + '/#menu-list', width);
      await page.locator('[data-menu-id="1"]').click();
      const modal = page.locator('.detail-modal[open]');
      await dragMatrix(page, modal);
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
    });
  // Inspect already-running unmerged preview without changing its source or process.
  if (process.env.ADMIN_ORDERS_AUDIT_URL) {
    await fresh(process.env.ADMIN_ORDERS_AUDIT_URL);
    const buttons = page.getByRole('button', { name: /^주문 .+ 상세$/ });
    let available = false;
    try {
      await buttons.first().waitFor({ timeout: 3000 });
      available = true;
    } catch (error) {
      results.push({
        name: '관리자 주문 #279',
        status: 'BLOCKED',
        reason:
          '기존 Vite 서버 5273 HTML은 응답하지만 현재 checkout에 없는 admin-orders-entry.jsx를 읽어 React가 표시되지 않음. 원본 브랜치 수정·복사 없이 정적 조사만 수행.',
        detail: error.message,
      });
    }
    if (available)
      await run('관리자 주문 #279', async () => {
        await buttons.first().click();
        const modal = page.locator('dialog[open]');
        await modal.waitFor();
        await dragMatrix(page, modal);
      });
  }
  await run(
    '관리자 메뉴 #132 (병합 main): 드래그 유지·바깥 닫기 금지·Escape',
    async () => {
      await fresh(adminMenu.origin);
      const trigger = page
        .getByRole('button', { name: /메뉴 등록|메뉴 추가/ })
        .first();
      await trigger.click();
      const modal = page.locator('dialog[open]');
      await modal.waitFor();
      const points = await dragMatrix(page, modal);
      if (points.outsideAvailable) {
        await pointerGesture(page, points.outside, points.outside);
        assert.equal(await modal.evaluate((node) => node.open), true);
      }
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
      );
    },
  );
  for (const width of [1440, 390, 320])
    await run(`회원가입 ${width}px: 드래그·바깥 닫기·포커스 복귀`, async () => {
      await fresh(customer.url + '/#menu-list', width);
      const trigger = button('로그인');
      await trigger.click();
      await button('회원가입').click();
      const modal = page.locator('.login-modal[open]');
      await page
        .getByRole('heading', { name: '회원가입', exact: true })
        .waitFor();
      const points = await dragMatrix(page, modal);
      if (points.outsideAvailable)
        await pointerGesture(page, points.outside, points.outside);
      else await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
      );
      assert.notEqual(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
    });
} finally {
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        results,
        note: 'PASS uses actual mouse down/move/up. Unmerged previews are audited, never modified.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  await customer.close();
  await checkout.close();
  await adminMenu.close();
}
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
