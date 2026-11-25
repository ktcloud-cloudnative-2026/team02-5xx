// #284-only pointer regressions; shares #297's gesture helpers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { startInventoryFixture } from './admin-inventory-fixture.mjs';
import { dragMatrix, pointerGesture } from './dialog-drag-helpers.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const output =
  process.env.INVENTORY_DRAG_QA_OUTPUT || '../../.local/inventory-drag';
await mkdir(output, { recursive: true });
const inventory = await startInventoryFixture({ ui: true });
const browser = await chromium.launch({ headless: true });
const results = [];
let page, context;
async function fresh(url, width = 1440) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(6000);
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
async function run(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    await page.screenshot({ path: output + '/failure.png' });
    console.log('FAIL ' + name + ': ' + error.message);
  }
}
try {
  for (const kind of ['등록', '입고', '메뉴 연결', '삭제']) {
    await run(
      `관리자 재고 ${kind}: 양방향 드래그·바깥 닫기·포커스 복귀`,
      async () => {
        inventory.reset();
        await fresh(inventory.url);
        const trigger =
          kind === '등록' ? button('＋ 재고 등록') : button(`재고 105 ${kind}`);
        await trigger.scrollIntoViewIfNeeded();
        const beforeScroll = await page.evaluate(() => scrollY);
        await trigger.click();
        const modal = page.locator('dialog[open]');
        const points = await dragMatrix(page, modal);
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
        assert.ok(
          Math.abs((await page.evaluate(() => scrollY)) - beforeScroll) <= 1,
          'background scroll position restored',
        );
      },
    );
    await run(
      `관리자 재고 ${kind}: 저장 중 드래그·바깥 down/up·Escape 차단`,
      async () => {
        inventory.reset();
        inventory.controls.writeDelay = 2500;
        await fresh(inventory.url);
        await until(async () => await button('＋ 재고 등록').isEnabled());
        await (
          kind === '등록' ? button('＋ 재고 등록') : button(`재고 105 ${kind}`)
        ).click();
        const modal = page.locator('dialog[open]');
        if (kind === '등록') {
          await modal.getByLabel('실제 재고 수량').fill('2');
          await modal.getByLabel('부족 기준 수량').fill('0');
        }
        if (kind === '입고') await modal.getByLabel('추가 입고 수량').fill('1');
        if (kind === '메뉴 연결')
          await modal.getByLabel('연결할 메뉴 ID').fill('5');
        const submit = modal.getByRole('button', {
          name:
            kind === '등록'
              ? '재고 등록'
              : kind === '입고'
                ? '입고 반영'
                : kind === '메뉴 연결'
                  ? '메뉴 연결'
                  : '삭제',
          exact: true,
        });
        const before = inventory.requests.filter(
          (r) => r.method !== 'GET',
        ).length;
        await submit.click();
        const points = await dragMatrix(page, modal);
        await pointerGesture(page, points.outside, points.outside);
        await page.keyboard.press('Escape');
        assert.equal(await modal.evaluate((node) => node.open), true);
        assert.equal(
          await modal
            .getByRole('button', { name: '취소', exact: true })
            .isDisabled(),
          true,
        );
        await modal.waitFor({ state: 'detached' });
        assert.equal(
          inventory.requests.filter((r) => r.method !== 'GET').length,
          before + 1,
        );
      },
    );
  }

  for (const width of [390, 320])
    await run(`재고 ${width}px: 내부 드래그·Escape·스크롤`, async () => {
      inventory.reset();
      await fresh(inventory.url, width);
      await until(async () => await button('＋ 재고 등록').isEnabled());
      await button('재고 105 입고').click();
      const panel = page.locator('dialog[open]');
      const box = await panel.boundingBox();
      await pointerGesture(
        page,
        { x: box.x + 120, y: box.y + 40 },
        { x: box.x + 140, y: box.y + 45 },
      );
      assert.equal(await panel.evaluate((node) => node.open), true);
      await page.screenshot({
        path: `${output}/drag-${width}.png`,
        fullPage: false,
      });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      assert.notEqual(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      );
    });
} finally {
  await writeFile(
    output + '/results.json',
    JSON.stringify({ results }, null, 2),
  );
  await browser.close();
  await inventory.close();
}
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
