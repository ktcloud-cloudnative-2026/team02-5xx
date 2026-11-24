import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startAdminOrdersPreview } from './admin-orders-preview.mjs';
import { ORDER_STATUSES } from '../src/admin-orders/adminOrderApi.js';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(process.env.ADMIN_ORDERS_QA_OUTPUT);
await mkdir(output, { recursive: true });
const preview = await startAdminOrdersPreview();
const browser = await chromium.launch({ headless: true });
let context, page, errors;
const results = [];
const row = (id) => page.locator(`[data-order-id="${id}"]`);
const listCalls = () =>
  preview.calls.filter(
    (call) =>
      new URL(call.path, 'http://fixture').pathname === '/api/v1/admin/orders',
  );
async function fresh(scenario = 'normal', width = 1440) {
  await context?.close();
  preview.reset();
  preview.calls.length = 0;
  context = await browser.newContext({
    viewport: { width, height: width === 1440 ? 1000 : 844 },
  });
  page = await context.newPage();
  errors = [];
  page.setDefaultTimeout(6000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${preview.url}?scenario=${scenario}#admin-orders`);
  if (['normal', 'detail-error', 'missing', 'delayed'].includes(scenario))
    await row(47).waitFor();
}
async function search() {
  await page.getByRole('button', { name: '검색', exact: true }).click();
}
async function open(id) {
  await row(id).getByRole('button').click();
  await page.locator('.ao-detail .ao-detail-status').waitFor();
  return page.locator('.ao-detail');
}
async function close() {
  await page.keyboard.press('Escape');
  await page.locator('.ao-detail').waitFor({ state: 'detached' });
}
async function check(name, run) {
  await run();
  assert.deepEqual(errors, []);
  assert.equal(
    preview.calls.every(
      (call) => !call.hasUserId && !call.hasUserRole && !call.hasBearer,
    ),
    true,
  );
  results.push({ name, status: 'PASS' });
  console.log(`PASS: ${name}`);
}
try {
  await check(
    'StrictMode initial list, latest order, pagination and browser history',
    async () => {
      await fresh();
      assert.equal(listCalls().length, 1);
      assert.equal(await page.locator('tbody tr').count(), 20);
      const originalHash = await page.evaluate(() => location.hash);
      await page.locator('.ao-skip').focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        'ao-main',
      );
      assert.equal(await page.evaluate(() => location.hash), originalHash);
      await page.screenshot({
        path: resolve(output, 'desktop-list.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await row(27).waitFor();
      assert.equal(
        new URL(listCalls().at(-1).path, 'http://fixture').searchParams.get(
          'page',
        ),
        '1',
      );
      await page.goBack();
      await row(47).waitFor();
      await page.evaluate(() => {
        location.hash = '#admin-orders?page=-1';
      });
      await page.getByRole('alert').filter({ hasText: '페이지' }).waitFor();
      await page.getByRole('button', { name: '초기화', exact: true }).click();
      await row(47).waitFor();
    },
  );
  await check(
    'all seven server states, manual review filter and no client sorting invention',
    async () => {
      await fresh();
      for (const [status, label] of Object.entries(ORDER_STATUSES)) {
        await page
          .getByLabel('주문 상태', { exact: true })
          .selectOption(status);
        await search();
        await page.waitForFunction((label) => {
          const badges = [
            ...document.querySelectorAll('tbody .ao-badge:not(.ao-attention)'),
          ];
          return (
            badges.length > 0 &&
            badges.every((element) => element.textContent === label)
          );
        }, label);
        assert.equal(
          new URL(listCalls().at(-1).path, 'http://fixture').searchParams.get(
            'status',
          ),
          status,
        );
      }
      await page.getByLabel('주문 상태', { exact: true }).selectOption('');
      await page.getByLabel('취소 후속 처리 수동 확인만').check();
      await search();
      await row(45).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 3);
      assert.equal(
        new URL(listCalls().at(-1).path, 'http://fixture').searchParams.get(
          'manualReviewRequired',
        ),
        'true',
      );
      assert.equal(await row(46).count(), 0);
    },
  );
  await check(
    'exact number-only search omits both dates and finds an old order; empty result and date validation',
    async () => {
      await fresh();
      await page.getByRole('radio', { name: '주문번호 · 전체 기간' }).check();
      await page
        .getByRole('searchbox', { name: '주문번호', exact: true })
        .fill('PO-20200101-0001');
      await search();
      await row(1).waitFor();
      const params = new URL(listCalls().at(-1).path, 'http://fixture')
        .searchParams;
      assert.equal(params.has('from'), false);
      assert.equal(params.has('to'), false);
      await page
        .getByRole('searchbox', { name: '주문번호', exact: true })
        .fill('NOT-A-REAL-ORDER');
      await search();
      await page.getByRole('heading', { name: '검색 결과가 없어요' }).waitFor();
      await page.getByRole('button', { name: '초기화', exact: true }).click();
      await row(47).waitFor();
      await page.getByLabel('시작일 (KST)').fill('2026-10-01');
      await page.getByLabel('종료일 (KST)').fill('2026-11-01');
      const calls = listCalls().length;
      await search();
      await page.getByRole('alert').filter({ hasText: '최대 31일' }).waitFor();
      assert.equal(listCalls().length, calls);
    },
  );
  await check(
    'temporary order optional fields, items/options/amount and keyboard Escape focus restoration',
    async () => {
      await fresh();
      const opener = row(47).getByRole('button');
      const detail = await open(47);
      await detail
        .getByRole('heading', { name: '주문번호 미발급 · #47' })
        .waitFor();
      assert.match(await detail.innerText(), /사용자 ID 1002/);
      assert.match(await detail.innerText(), /세트 \(\+2,500원\)/);
      assert.equal(
        (await detail.getByText('기록 없음', { exact: true }).count()) > 0,
        true,
      );
      await page.screenshot({
        path: resolve(output, 'desktop-created-detail.png'),
      });
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('.ao-detail').contains(document.activeElement),
        ),
        true,
      );
      await close();
      assert.equal(
        await opener.evaluate((el) => el === document.activeElement),
        true,
      );
    },
  );
  await check(
    'manual cancellation and FAILED refund-needed are distinct; completed refund/restoration records',
    async () => {
      await fresh();
      let detail = await open(45);
      await detail
        .getByText('취소 후속 처리 · 수동 확인 필요', { exact: true })
        .waitFor();
      await detail
        .getByText('REFUND_NOT_REFUNDABLE', { exact: true })
        .waitFor();
      await page.screenshot({
        path: resolve(output, 'desktop-manual-review.png'),
      });
      await close();
      detail = await open(46);
      await detail
        .getByText('실패 주문 · 환불 미완료 확인 필요', { exact: true })
        .waitFor();
      assert.equal(
        await detail.getByText('수동 확인 필요', { exact: true }).count(),
        0,
      );
      await page.screenshot({
        path: resolve(output, 'desktop-failed-refund.png'),
      });
      await close();
      detail = await open(44);
      assert.match(await detail.innerText(), /완료 ·/);
      await close();
    },
  );
  await check(
    'detail errors, missing order, disabled API, 401/403 and explicit retry',
    async () => {
      await fresh('detail-error');
      await row(47).getByRole('button').click();
      let detail = page.locator('.ao-detail');
      await detail.getByRole('alert').waitFor();
      preview.controls.detailStatus = 200;
      await detail
        .getByRole('button', { name: '다시 조회', exact: true })
        .click();
      await detail
        .getByRole('heading', { name: '주문번호 미발급 · #47' })
        .waitFor();
      await close();
      await fresh('missing');
      await row(47).getByRole('button').click();
      await page
        .locator('.ao-detail')
        .getByText(/주문을 찾을 수/)
        .waitFor();
      await fresh('disabled');
      await page.getByRole('alert').filter({ hasText: '비활성화' }).waitFor();
      await fresh('forbidden');
      await page.getByRole('heading', { name: '조회 권한이 없어요' }).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 0);
      await fresh('unauthorized');
      await page
        .getByRole('heading', { name: '관리자 인증 확인이 필요해요' })
        .waitFor();
      await fresh('list-error');
      await page
        .getByRole('alert')
        .filter({ hasText: '조회하지 못' })
        .waitFor();
      preview.controls.listStatus = 200;
      await page
        .getByRole('button', { name: '다시 조회', exact: true })
        .click();
      await row(47).waitFor();
    },
  );
  await check(
    'network error and non-JSON proxy 404 never display fake data',
    async () => {
      await fresh();
      await page.route('**/api/v1/admin/orders?*', (route) =>
        route.abort('failed'),
      );
      await page.getByRole('button', { name: '목록 새로고침' }).click();
      await page.getByText(/서버에 연결하지 못/).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 0);
      await page.unroute('**/api/v1/admin/orders?*');
      await page.route('**/api/v1/admin/orders?*', (route) =>
        route.fulfill({
          status: 404,
          contentType: 'text/plain',
          body: 'proxy',
        }),
      );
      await page
        .getByRole('button', { name: '다시 조회', exact: true })
        .click();
      await page.getByText(/비활성화/).waitFor();
    },
  );
  await check(
    'delayed list/detail responses are discarded after a newer search, another detail or closing',
    async () => {
      await fresh();
      preview.controls.listDelay = 300;
      await page
        .getByLabel('주문 상태', { exact: true })
        .selectOption('CREATED');
      await search();
      await page
        .getByText('주문 목록을 불러오는 중이에요.', { exact: true })
        .waitFor();
      preview.controls.listDelay = 0;
      await page
        .getByLabel('주문 상태', { exact: true })
        .selectOption('COOKING');
      await search();
      await row(43).waitFor();
      await page.waitForTimeout(400);
      assert.equal(await row(47).count(), 0);
      await page.getByRole('button', { name: '초기화', exact: true }).click();
      await row(47).waitFor();
      preview.controls.detailDelay = 300;
      await row(45).getByRole('button').click();
      await page
        .getByText('주문 상세를 불러오는 중이에요.', { exact: true })
        .waitFor();
      preview.controls.detailDelay = 0;
      await page.evaluate(() => {
        const params = new URLSearchParams(location.hash.split('?')[1]);
        params.set('orderId', '46');
        location.hash = '#admin-orders?' + params;
      });
      await page
        .getByText('실패 주문 · 환불 미완료 확인 필요', { exact: true })
        .waitFor();
      await page.waitForTimeout(400);
      assert.equal(
        await page
          .getByText('취소 후속 처리 · 수동 확인 필요', { exact: true })
          .count(),
        0,
      );
      await close();
      preview.controls.detailDelay = 300;
      await row(47).getByRole('button').click();
      await page
        .getByText('주문 상세를 불러오는 중이에요.', { exact: true })
        .waitFor();
      await close();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.ao-detail').count(), 0);
    },
  );
  for (const width of [390, 320])
    await check(
      `mobile ${width}px cards, filters, detail scroll, Tab and Escape`,
      async () => {
        await fresh('normal', width);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: resolve(output, `mobile-${width}-list.png`),
          fullPage: true,
        });
        const detail = await open(45);
        assert.equal(
          await detail.evaluate((el) => el.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({
          path: resolve(output, `mobile-${width}-detail.png`),
        });
        await detail.locator('.ao-detail-body').evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() =>
            document
              .querySelector('.ao-detail')
              .contains(document.activeElement),
          ),
          true,
        );
        await close();
        assert.equal(
          await row(45)
            .getByRole('button')
            .evaluate((el) => document.activeElement === el),
          true,
        );
      },
    );
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'FAIL.png'), fullPage: true });
  throw error;
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  await browser.close();
  await preview.close();
}
