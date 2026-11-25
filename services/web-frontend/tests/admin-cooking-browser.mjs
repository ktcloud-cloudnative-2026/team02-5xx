import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  startCookingFixture,
  cookingSample,
} from './admin-cooking-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output = resolve(
  process.env.COOKING_QA_OUTPUT ?? '../../admin-cooking-qa',
);
await mkdir(output, { recursive: true });
const fixture = await startCookingFixture(),
  browser = await chromium.launch({ headless: true }),
  results = [];
async function scenario(name, run, { sample = 'normal', width = 1440 } = {}) {
  fixture.reset(sample);
  const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
async function open(page) {
  await page.goto(fixture.url);
  await page
    .getByTestId('completed-metric')
    .getByText('42', { exact: false })
    .waitFor();
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.ac-refresh-group button')
        .hasAttribute('aria-busy') ||
      document
        .querySelector('.ac-refresh-group button')
        .getAttribute('aria-busy') === 'false',
  );
}
async function select(page, value) {
  await page.getByLabel('시나리오', { exact: true }).selectOption(value);
}
try {
  await scenario(
    '1440px actual GETs, KST, complete FIFO and representative current order',
    async (page) => {
      await open(page);
      await ready(page);
      await page.locator('.ac-queue-list li').nth(7).waitFor();
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
      assert.equal(
        await page.getByTestId('current-order').innerText(),
        'P-20261124-0042',
      );
      assert.match(await page.getByTestId('wait-metric').innerText(), /30분/);
      assert.equal(await page.locator('.ac-next-label').count(), 1);
      assert.deepEqual(
        await page.locator('.ac-queue-order small').allTextContents(),
        [205, 201, 210, 211, 212, 213, 214, 215].map((id) => `주문 ID ${id}`),
      );
      assert.match(
        await page.locator('.ac-queue-list li').first().innerText(),
        /12:01:00 KST/,
      );
      assert.equal(fixture.controls.requests.length, 3);
      assert.ok(
        fixture.controls.requests.every(
          (req) =>
            req.method === 'GET' &&
            !req.headers['x-user-id'] &&
            !req.headers['x-user-role'] &&
            !req.headers.authorization,
        ),
      );
      assert.equal(
        await page
          .getByRole('button', { name: '조리 시작', exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole('button', { name: '조리 완료', exact: true })
          .count(),
        0,
      );
      assert.equal(new URL(page.url()).hash, '#admin/cooking');
      await page.screenshot({
        path: resolve(output, 'cooking-1440.png'),
        fullPage: true,
      });
    },
  );
  await scenario(
    'empty is real zero and no current order, not error fallback',
    async (page) => {
      await page.goto(fixture.url);
      await page.getByText('대기 중인 주문이 없어요.').waitFor();
      assert.equal(await page.getByTestId('current-order').innerText(), '없음');
      assert.match(await page.getByTestId('completed-metric').innerText(), /0/);
    },
    { sample: 'empty' },
  );
  await scenario(
    'multiple cooking orders display count and only one supplied representative',
    async (page) => {
      await open(page);
      await ready(page);
      assert.match(await page.getByTestId('cooking-metric').innerText(), /3건/);
      assert.equal(await page.locator('.ac-current-order').count(), 1);
      await page
        .getByText(
          '조리 중인 주문 가운데 서버가 제공한 대표 주문번호를 표시해요.',
        )
        .waitFor();
    },
    { sample: 'multiple' },
  );
  await scenario(
    'omitted order number is unavailable while cooking count remains positive',
    async (page) => {
      await open(page);
      assert.equal(
        await page.getByTestId('current-order').innerText(),
        '주문번호 미제공',
      );
      assert.match(await page.getByTestId('cooking-metric').innerText(), /1건/);
    },
    { sample: 'omitted' },
  );
  await scenario(
    'different query snapshots stay separate with explanation',
    async (page) => {
      await open(page);
      await page.locator('.ac-disagreement').waitFor();
      assert.match(await page.getByTestId('waiting-metric').innerText(), /6건/);
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
    },
    { sample: 'mismatch' },
  );
  await scenario(
    'congestion 503 affects only public metrics and explicit retry recovers',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '혼잡도 다시 조회' }).waitFor();
      assert.equal(
        await page
          .getByTestId('congestion-metric')
          .locator('.ac-value')
          .innerText(),
        '—',
      );
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
      fixture.controls.scenario = 'normal';
      await page.getByRole('button', { name: '혼잡도 다시 조회' }).click();
      await page
        .getByTestId('congestion-metric')
        .getByText('혼잡', { exact: true })
        .waitFor();
    },
    { sample: 'congestion-error' },
  );
  await scenario(
    'overview 503 keeps queue valid and does not claim no current order',
    async (page) => {
      await page.goto(fixture.url);
      await page.getByRole('button', { name: '조리 현황 다시 조회' }).waitFor();
      await page.getByText('현재 조리 주문을 확인할 수 없어요.').waitFor();
      assert.equal(await page.getByTestId('current-order').count(), 0);
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
    },
    { sample: 'overview-error' },
  );
  await scenario(
    'queue 503 remains unknown while overview succeeds',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      assert.equal(await page.getByText('대기 중인 주문이 없어요.').count(), 0);
      assert.equal(await page.locator('.ac-queue .ac-count').innerText(), '—');
    },
    { sample: 'queue-error' },
  );
  for (const status of [401, 403, 404])
    await scenario(
      `administrator ${status} explicit, public congestion stays usable`,
      async (page) => {
        await page.goto(fixture.url);
        await page
          .getByRole('button', { name: '조리 현황 다시 조회' })
          .waitFor();
        await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
        assert.match(
          await page.locator('.ac-source-status').innerText(),
          status === 401 ? /인증/ : status === 403 ? /STORE_ADMIN/ : /비활성화/,
        );
        await page
          .getByTestId('congestion-metric')
          .getByText('혼잡', { exact: true })
          .waitFor();
        assert.equal(await page.getByTestId('current-order').count(), 0);
      },
      { sample: String(status) },
    );
  await scenario(
    'network body interruption reports connection failure and retry recovers',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      assert.match(
        await page.locator('.ac-queue').innerText(),
        /네트워크 연결/,
      );
      fixture.controls.scenario = 'normal';
      await page.getByRole('button', { name: '대기열 다시 조회' }).click();
      await page.locator('.ac-queue-list li').nth(7).waitFor();
    },
    { sample: 'network' },
  );
  await scenario(
    'malformed FIFO response is rejected, not rendered as 99 orders',
    async (page) => {
      await open(page);
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      assert.match(await page.locator('.ac-queue').innerText(), /응답 형식/);
      assert.equal(await page.locator('.ac-queue-list li').count(), 0);
    },
    { sample: 'malformed' },
  );
  await scenario(
    'loading before delayed API and pointer repetition deduplicates refresh',
    async (page) => {
      await page.goto(fixture.url);
      await page.getByText('불러오는 중…', { exact: true }).first().waitFor();
      const button = page.getByRole('button', {
        name: '전체 새로고침',
        exact: false,
      });
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      const box = await button.boundingBox();
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.mouse.click(box.x + 10, box.y + 10);
      await ready(page);
      assert.equal(fixture.controls.requests.length, 3);
    },
    { sample: 'slow' },
  );
  await scenario(
    '10s timeout is explicit and manual retry alone creates the next queue GET',
    async (page) => {
      await open(page);
      await page
        .getByRole('button', { name: '대기열 다시 조회' })
        .waitFor({ timeout: 15000 });
      assert.match(await page.locator('.ac-queue').innerText(), /시간이 초과/);
      assert.equal(
        fixture.controls.requests.filter((req) => req.area === 'queue').length,
        1,
      );
      fixture.controls.scenario = 'normal';
      await page.getByRole('button', { name: '대기열 다시 조회' }).click();
      await page.locator('.ac-queue-list li').nth(7).waitFor();
      assert.equal(
        fixture.controls.requests.filter((req) => req.area === 'queue').length,
        2,
      );
    },
    { sample: 'timeout' },
  );
  await scenario(
    'failed queue refresh preserves stale FIFO and retry focus returns to status',
    async (page) => {
      await open(page);
      await ready(page);
      fixture.controls.overrides.set('queue', { status: 503 });
      await page.getByRole('button', { name: '대기열 새로고침' }).click();
      const retry = page.getByRole('button', { name: '대기열 다시 조회' });
      await retry.waitFor();
      await page
        .locator('.ac-queue')
        .getByText('이전 조회값', { exact: false })
        .waitFor();
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
      fixture.controls.overrides.delete('queue');
      await retry.focus();
      await page.keyboard.press('Enter');
      await ready(page);
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.classList.contains('ac-freshness'),
        ),
        true,
      );
    },
  );
  await scenario(
    'late pre-unmount HTTP response cannot overwrite newly empty fixture',
    async (page) => {
      let release;
      const gate = new Promise((done) => {
        release = done;
      });
      let first = true;
      await page.route('**/api/v1/admin/cooking/queue', async (route) => {
        if (!first) {
          await route.continue();
          return;
        }
        first = false;
        await gate;
        await route
          .fulfill({
            status: 200,
            json: { success: true, data: cookingSample().queue, message: 'OK' },
          })
          .catch(() => {});
      });
      await open(page);
      await select(page, 'empty');
      await page.getByText('대기 중인 주문이 없어요.').waitFor();
      release();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.ac-queue-list li').count(), 0);
    },
  );
  await scenario(
    '30s polling, failed area pause, hidden stop and immediate visibility return',
    async (page) => {
      await page.clock.install();
      await open(page);
      await ready(page);
      fixture.controls.data.overview.completedToday = 43;
      fixture.controls.overrides.set('queue', { status: 503 });
      const response = page.waitForResponse((res) =>
        res.url().includes('/cooking/overview'),
      );
      await page.clock.runFor(30001);
      await response;
      await page
        .getByTestId('completed-metric')
        .getByText('43', { exact: false })
        .waitFor();
      await page.getByRole('button', { name: '대기열 다시 조회' }).waitFor();
      const failed = fixture.controls.requests.filter(
        (req) => req.area === 'queue',
      ).length;
      const next = page.waitForResponse((res) =>
        res.url().includes('/cooking/overview'),
      );
      await page.clock.runFor(30001);
      await next;
      assert.equal(
        fixture.controls.requests.filter((req) => req.area === 'queue').length,
        failed,
      );
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const count = fixture.controls.requests.length;
      await page.clock.runFor(90000);
      assert.equal(fixture.controls.requests.length, count);
      fixture.controls.overrides.delete('queue');
      const returned = page.waitForResponse((res) =>
        res.url().includes('/cooking/queue'),
      );
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await returned;
      await ready(page);
      assert.equal(await page.locator('.ac-queue-list li').count(), 8);
    },
  );
  await scenario(
    'keyboard skip, hash target, refresh focus and no false navigation',
    async (page) => {
      await open(page);
      await ready(page);
      await page.keyboard.press('Tab');
      await page.getByRole('link', { name: '본문으로 건너뛰기' }).waitFor();
      await page.keyboard.press('Enter');
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        'cooking-content',
      );
      assert.equal(new URL(page.url()).hash, '#admin/cooking');
      const button = page.getByRole('button', {
        name: '전체 새로고침',
        exact: false,
      });
      await button.focus();
      await page.keyboard.press('Enter');
      await ready(page);
      assert.equal(
        await button.evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(
        await page.getByRole('link', { name: '대시보드', exact: true }).count(),
        0,
      );
      await page.keyboard.press('Escape');
      assert.equal(
        await page.getByTestId('current-order').innerText(),
        'P-20261124-0042',
      );
    },
  );
  for (const width of [390, 320])
    await scenario(
      `${width}px responsive queue cards, accessible scrolling and no page overflow`,
      async (page) => {
        await open(page);
        await ready(page);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const region = page.getByRole('region', {
          name: 'FIFO 대기 주문 목록 · 스크롤 가능',
        });
        await region.scrollIntoViewIfNeeded();
        await region.focus();
        await page.keyboard.press('End');
        await page.waitForFunction(
          () => document.querySelector('.ac-queue-scroll').scrollTop > 0,
        );
        assert.equal(await region.evaluate((el) => el.scrollTop > 0), true);
        await page.screenshot({
          path: resolve(output, `cooking-${width}.png`),
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
  `Cooking Chromium: ${results.filter((entry) => entry.status === 'PASS').length}/${results.length} PASS`,
);
if (results.some((entry) => entry.status === 'FAIL')) process.exitCode = 1;
