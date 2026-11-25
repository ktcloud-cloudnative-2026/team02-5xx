import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  startDashboardFixture,
  dashboardSample,
} from './admin-dashboard-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(
  process.env.DASHBOARD_QA_OUTPUT ?? '../../admin-dashboard-qa',
);
await mkdir(output, { recursive: true });
const fixture = await startDashboardFixture({ menuPreview: true });
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, run, { width = 1440, scenario = 'normal' } = {}) {
  fixture.reset(scenario);
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
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
const open = async (page) => {
  await page.goto(fixture.origin);
  await page
    .getByTestId('completed-kpi')
    .getByText('42', { exact: false })
    .waitFor();
};
const check = async (page, selector, expected) => {
  assert.equal(
    await page
      .getByRole('switch', { name: selector })
      .getAttribute('aria-checked'),
    String(expected),
  );
};
const waitReady = async (page) => {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="switch"]')].every(
      (button) => !button.disabled,
    ),
  );
};
const changeScenario = async (page, id) => {
  await page.getByLabel('시나리오', { exact: true }).selectOption(id);
};
const envelope = (data) => ({ success: true, data, message: 'OK' });
try {
  await scenario(
    '1440px: KPI, FIFO tie order, quantities, menu names and contract-only identifiers',
    async (page) => {
      await open(page);
      await waitReady(page);
      await page.getByRole('heading', { name: '트러플 버섯 덮밥' }).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 3);
      assert.deepEqual(
        await page.locator('tbody tr td:nth-child(2) small').allTextContents(),
        ['주문 ID 301', '주문 ID 299', '주문 ID 305'],
      );
      await page
        .getByRole('heading', { name: '메뉴 ID 999', exact: true })
        .waitFor();
      await page
        .getByText('메뉴 ID 999 · 이름 조회 불가', { exact: false })
        .waitFor();
      assert.equal(await page.locator('.ad-badge-out').count(), 2);
      assert.equal(await page.locator('.ad-quantities').count(), 4);
      assert.equal(
        fixture.controls.requests.filter((request) => request.method === 'GET')
          .length,
        6,
      );
      assert.ok(
        fixture.controls.requests.every(
          (request) =>
            !request.headers['x-user-id'] &&
            !request.headers['x-user-role'] &&
            !request.headers.authorization,
        ),
      );
      await page.screenshot({
        path: resolve(output, 'dashboard-1440.png'),
        fullPage: true,
      });
    },
  );
  await scenario(
    'independent operation switches and authoritative PATCH updates',
    async (page) => {
      await open(page);
      await waitReady(page);
      await page.getByRole('switch', { name: '영업 상태 변경' }).click();
      await page.getByText('서버의 운영 상태를 반영했어요.').waitFor();
      await check(page, '영업 상태 변경', false);
      await check(page, '주문 접수 상태 변경', true);
      assert.deepEqual(
        fixture.controls.requests.find((request) => request.method === 'PATCH')
          .body,
        { isOpen: false },
      );
      await page.getByRole('switch', { name: '주문 접수 상태 변경' }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll('[role="switch"]')[1]
            .getAttribute('aria-checked') === 'false',
      );
      assert.equal(fixture.controls.writeCount, 2);
      assert.deepEqual(
        fixture.controls.requests.filter(
          (request) => request.method === 'PATCH',
        )[1].body,
        { acceptingOrders: false },
      );
    },
  );
  await scenario(
    'delayed PATCH disables both switches; repeated pointer and Space cannot duplicate',
    async (page) => {
      await open(page);
      await waitReady(page);
      const button = page.getByRole('switch', { name: '영업 상태 변경' });
      await button.click();
      await page
        .getByText('변경 결과를 확인하고 있어요.', { exact: false })
        .waitFor();
      assert.equal(await button.isDisabled(), true);
      assert.equal(
        await page
          .getByRole('switch', { name: '주문 접수 상태 변경' })
          .isDisabled(),
        true,
      );
      const box = await button.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.press('Space');
      await page.waitForFunction(
        () => document.querySelector('[role="switch"]').disabled === false,
      );
      assert.equal(fixture.controls.writeCount, 1);
      await check(page, '영업 상태 변경', false);
    },
    { scenario: 'write-delay' },
  );
  await scenario(
    '400 write rejection keeps previous values and does not retry automatically',
    async (page) => {
      await open(page);
      await waitReady(page);
      await page.getByRole('switch', { name: '영업 상태 변경' }).click();
      await page
        .getByText('입력한 변경은 자동 재전송하지 않아요.', { exact: false })
        .waitFor();
      await check(page, '영업 상태 변경', true);
      assert.equal(fixture.controls.writeCount, 1);
      await waitReady(page);
    },
    { scenario: 'write-rejected' },
  );
  for (const id of ['write-unknown', 'write-network'])
    await scenario(
      `${id}: explicit GET reconciliation, no automatic PATCH replay`,
      async (page) => {
        await open(page);
        await waitReady(page);
        await page.getByRole('switch', { name: '영업 상태 변경' }).click();
        await page
          .getByRole('button', { name: '현재 서버 상태 확인' })
          .waitFor();
        assert.equal(
          await page
            .getByRole('switch', { name: '영업 상태 변경' })
            .isDisabled(),
          true,
        );
        assert.equal(fixture.controls.writeCount, 1);
        await check(page, '영업 상태 변경', true);
        if (id === 'write-unknown') {
          fixture.controls.overrides.set('operations', 503);
          await page
            .getByRole('button', { name: '현재 서버 상태 확인' })
            .click();
          await page
            .getByRole('button', { name: '운영 상태 다시 조회' })
            .waitFor();
          assert.equal(
            await page
              .getByRole('switch', { name: '영업 상태 변경' })
              .isDisabled(),
            true,
          );
          fixture.controls.overrides.delete('operations');
          await page
            .getByRole('button', { name: '운영 상태 다시 조회' })
            .click();
        } else {
          await page
            .getByRole('button', { name: '현재 서버 상태 확인' })
            .click();
        }
        await page
          .getByText('서버 상태를 다시 확인했어요.', { exact: false })
          .waitFor();
        await waitReady(page);
        await check(page, '영업 상태 변경', false);
        assert.equal(fixture.controls.writeCount, 1);
      },
      { scenario: id },
    );
  await scenario(
    'one congestion 503 does not erase overview, queue or stock; retry recovers',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '혼잡도 다시 조회' }).waitFor();
      assert.equal(
        await page
          .getByTestId('congestion-kpi')
          .locator('.ad-kpi-value')
          .innerText(),
        '—',
      );
      assert.match(await page.getByTestId('completed-kpi').innerText(), /42/);
      assert.equal(await page.locator('tbody tr').count(), 3);
      assert.equal(await page.locator('.ad-stock-list li').count(), 4);
      fixture.controls.scenario = 'normal';
      await page.getByRole('button', { name: '혼잡도 다시 조회' }).click();
      await page
        .getByTestId('congestion-kpi')
        .getByText('혼잡', { exact: true })
        .waitFor();
    },
    { scenario: 'partial' },
  );
  for (const status of [401, 403, 404, 503])
    await scenario(
      `operations ${status}: explicit message, controls locked, other resources intact`,
      async (page) => {
        await open(page);
        await page
          .getByRole('button', { name: '운영 상태 다시 조회' })
          .waitFor();
        assert.equal(
          await page
            .getByRole('switch', { name: '영업 상태 변경' })
            .isDisabled(),
          true,
        );
        assert.match(await page.getByTestId('completed-kpi').innerText(), /42/);
        const text = await page.locator('.ad-operations').innerText();
        assert.match(
          text,
          status === 401
            ? /인증/
            : status === 403
              ? /STORE_ADMIN/
              : status === 404
                ? /비활성화/
                : /일시적/,
        );
        fixture.controls.scenario = 'normal';
        await page.getByRole('button', { name: '운영 상태 다시 조회' }).click();
        await waitReady(page);
      },
      { scenario: `status-${status}` },
    );
  await scenario(
    'stock 503 is unknown, not zero or sold out',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '재고 다시 조회' }).waitFor();
      assert.match(
        await page
          .getByTestId('stock-kpi')
          .locator('.ad-kpi-value')
          .innerText(),
        /—/,
      );
      assert.equal(await page.locator('.ad-stock-list li').count(), 0);
      assert.equal(await page.locator('tbody tr').count(), 3);
    },
    { scenario: 'stock-error' },
  );
  await scenario(
    'menu lookup failure uses IDs, keeps validated stock and unlinked state',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '메뉴 이름 다시 조회' }).waitFor();
      await page
        .getByRole('heading', { name: '메뉴 ID 1', exact: true })
        .waitFor();
      await page
        .getByRole('heading', { name: '메뉴 미연결 재고', exact: true })
        .waitFor();
      assert.equal(await page.locator('.ad-quantities').count(), 4);
      fixture.controls.scenario = 'normal';
      await page.getByRole('button', { name: '메뉴 이름 다시 조회' }).click();
      await page.getByRole('heading', { name: '트러플 버섯 덮밥' }).waitFor();
    },
    { scenario: 'menu-error' },
  );
  await scenario(
    'failed refresh retains old queue with stale warning, manual retry recovers',
    async (page) => {
      await open(page);
      await page.locator('tbody tr').first().waitFor();
      fixture.controls.overrides.set('queue', 503);
      await page.getByRole('button', { name: '대기열 새로고침' }).click();
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      assert.equal(await page.locator('tbody tr').count(), 3);
      await page
        .locator('.ad-queue')
        .getByText('이전 조회값', { exact: false })
        .waitFor();
      fixture.controls.overrides.delete('queue');
      await page.getByRole('button', { name: '대기열 다시 조회' }).click();
      await page.waitForFunction(
        () => !document.querySelector('.ad-queue .ad-warning'),
      );
      assert.equal(await page.locator('tbody tr').count(), 3);
    },
  );
  await scenario(
    'empty result and optional cookingOrderNo are honest zeros/absence',
    async (page) => {
      await page.goto(fixture.origin);
      await page.getByText('현재 대기 중인 주문이 없어요.').waitFor();
      await page.getByText('재고 부족·품절 알림이 없어요.').waitFor();
      await page.getByText('현재 주문번호 정보 없음').waitFor();
      assert.equal(await page.locator('tbody tr').count(), 0);
      await check(page, '영업 상태 변경', false);
    },
    { scenario: 'empty' },
  );
  await scenario(
    'loading is visible before delayed HTTP completion',
    async (page) => {
      await page.goto(fixture.origin);
      await page.getByText('불러오는 중…', { exact: true }).first().waitFor();
      assert.match(
        await page
          .getByTestId('completed-kpi')
          .locator('.ad-kpi-value')
          .innerText(),
        /—/,
      );
      await page
        .getByTestId('completed-kpi')
        .getByText('42', { exact: false })
        .waitFor();
    },
    { scenario: 'slow' },
  );
  await scenario(
    'late response after scenario unmount cannot overwrite new dashboard',
    async (page) => {
      let release;
      const gate = new Promise((done) => {
        release = done;
      });
      let intercepted = false;
      await page.route('**/api/v1/admin/cooking/queue', async (route) => {
        if (intercepted) {
          await route.continue();
          return;
        }
        intercepted = true;
        await gate;
        await route
          .fulfill({ status: 200, json: envelope(dashboardSample().queue) })
          .catch(() => {});
      });
      await open(page);
      await changeScenario(page, 'empty');
      await page.getByText('현재 대기 중인 주문이 없어요.').waitFor();
      release();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('tbody tr').count(), 0);
    },
  );
  await scenario(
    '30s polling, hidden pause, visibility return refresh; failed resource stays stopped',
    async (page) => {
      await page.clock.install();
      await open(page);
      await waitReady(page);
      await page.waitForFunction(
        () => !document.body.innerText.includes('불러오는 중'),
      );
      const counts = { ...fixture.controls.readCount };
      fixture.controls.overrides.set('queue', 503);
      const response = page.waitForResponse((response) =>
        response.url().includes('/api/v1/admin/cooking/overview'),
      );
      await page.clock.runFor(30001);
      await response;
      await page.waitForFunction(
        () => !document.body.innerText.includes('새로 확인 중'),
      );
      assert.ok(fixture.controls.readCount.overview > counts.overview);
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      const failedCount = fixture.controls.readCount.queue;
      const nextResponse = page.waitForResponse((response) =>
        response.url().includes('/api/v1/admin/cooking/overview'),
      );
      await page.clock.runFor(30001);
      await nextResponse;
      assert.equal(fixture.controls.readCount.queue, failedCount);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const hidden = { ...fixture.controls.readCount };
      await page.clock.runFor(90000);
      assert.deepEqual(fixture.controls.readCount, hidden);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(
        () => !document.body.innerText.includes('새로 확인 중'),
      );
      assert.ok(fixture.controls.readCount.overview > hidden.overview);
    },
  );
  await scenario(
    'keyboard switch with Space, focus remains on control and no unsupported navigation',
    async (page) => {
      await open(page);
      await waitReady(page);
      const button = page.getByRole('switch', { name: '영업 상태 변경' });
      await button.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="switch"]')
            .getAttribute('aria-checked') === 'false',
      );
      assert.equal(
        await button.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(
        await page
          .getByRole('link', { name: '주문 관리', exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole('link', { name: '재고 관리', exact: true })
          .count(),
        0,
      );
      await page.keyboard.press('Escape');
      await check(page, '영업 상태 변경', false);
    },
  );
  await scenario(
    'merged #132 menu Mock navigation opens existing standalone preview',
    async (page) => {
      await open(page);
      await page
        .getByRole('link', { name: '메뉴 관리 · Mock', exact: true })
        .first()
        .click();
      await page
        .getByRole('heading', { name: '메뉴 관리', exact: true })
        .waitFor();
      assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/);
      assert.notEqual(new URL(page.url()).origin, fixture.origin);
      await page.screenshot({
        path: resolve(output, 'existing-menu-132.png'),
        fullPage: true,
      });
    },
  );
  for (const width of [390, 320])
    await scenario(
      `${width}px: responsive cards, switches, stock and internal FIFO scrolling`,
      async (page) => {
        await open(page);
        await waitReady(page);
        await page.getByRole('heading', { name: '트러플 버섯 덮밥' }).waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.getByRole('switch', { name: '주문 접수 상태 변경' }).click();
        await page.waitForFunction(
          () =>
            document
              .querySelectorAll('[role="switch"]')[1]
              .getAttribute('aria-checked') === 'false',
        );
        await page.locator('.ad-stock').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.ad-quantities').count(), 4);
        await page.screenshot({
          path: resolve(output, `dashboard-${width}.png`),
          fullPage: true,
        });
      },
      { width },
    );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  await browser.close();
  await fixture.close();
}
console.log(
  `Admin dashboard Chromium: ${results.filter((result) => result.status === 'PASS').length}/${results.length} PASS`,
);
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
