import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startInventoryFixture } from './admin-inventory-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE || 'playwright',
);
const output = resolve(
  process.env.INVENTORY_QA_OUTPUT || '../../.local/admin-inventory-qa',
);
await mkdir(output, { recursive: true });
const fixture = await startInventoryFixture({ ui: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
async function until(check) {
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.fail('condition timed out');
}
const button = (name) => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const row = (id) => page.locator(`[data-stock-id="${id}"]`);
async function ready(count = 6) {
  await until(
    async () =>
      (await page.locator('tbody tr').count()) === count &&
      (await button('＋ 재고 등록').isEnabled()),
  );
}
async function reset(scenario = 'normal') {
  fixture.reset(scenario);
  await page.goto(fixture.url);
}
async function close() {
  await page.keyboard.press('Escape');
  await until(async () => (await dialog().count()) === 0);
}
async function run(name, action) {
  await reset();
  await ready();
  await action();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await run('1440 목록·미연결·정상·부족·품절·서버 부족 필터', async () => {
    assert.match(await row(101).textContent(), /정상/);
    assert.match(await row(102).textContent(), /부족/);
    assert.match(await row(103).textContent(), /품절/);
    assert.match(await row(105).textContent(), /미연결/);
    await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
    await button('부족 항목만').click();
    await ready(3);
    assert.equal(await row(101).count(), 0);
    assert.equal(fixture.requests.at(-1).query, '?lowStockOnly=true');
    await button('전체 재고').click();
    await ready();
  });
  await run('등록 입력 검증·성공·신규 미연결', async () => {
    const before = fixture.requests.filter((r) => r.method === 'POST').length;
    await button('＋ 재고 등록').click();
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    assert.equal(await dialog().locator('[aria-invalid=true]').count(), 2);
    assert.equal(
      fixture.requests.filter((r) => r.method === 'POST').length,
      before,
    );
    await dialog().getByLabel('실제 재고 수량').fill('0');
    await dialog().getByLabel('부족 기준 수량').fill('2');
    await page.screenshot({ path: `${output}/register.png`, fullPage: true });
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await ready(7);
    assert.match(await row(107).textContent(), /품절.*미연결/);
  });
  await run('입고·중복 제출 방지·부족 필터 이탈', async () => {
    await button('부족 항목만').click();
    await ready(3);
    fixture.controls.writeDelay = 500;
    const before = fixture.requests.filter((r) =>
      r.path.endsWith('/adjustments'),
    ).length;
    await button('재고 102 입고').click();
    await dialog().getByLabel('추가 입고 수량').fill('10');
    await button('입고 반영').click();
    assert.equal(await button('처리 중…').isDisabled(), true);
    await until(async () => (await dialog().count()) === 0);
    await ready(2);
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith('/adjustments')).length,
      before + 1,
    );
    assert.equal(
      fixture.rows().find((r) => r.stockItemId === 102).stockQty,
      15,
    );
  });
  await run('메뉴 연결·해제 및 정확한 null 요청', async () => {
    await button('재고 105 메뉴 연결').click();
    await dialog().getByLabel('연결할 메뉴 ID').fill('77');
    await dialog()
      .getByRole('button', { name: '메뉴 연결', exact: true })
      .click();
    await ready();
    assert.match(await row(105).textContent(), /메뉴 ID 77/);
    await button('재고 105 메뉴 연결').click();
    await dialog().getByLabel('메뉴 연결 해제', { exact: true }).check();
    await button('연결 해제').click();
    await ready();
    assert.match(await row(105).textContent(), /미연결/);
    assert.deepEqual(
      fixture.requests.filter((r) => r.method === 'PUT').at(-1).body,
      { menuId: null },
    );
  });
  await run('메뉴 중복·HIDDEN·없음·503 실패 입력 보존', async () => {
    await button('재고 105 메뉴 연결').click();
    for (const [menuId, text] of [
      ['1', '다른 재고'],
      ['999', 'HIDDEN'],
      ['997', '찾을 수 없어요'],
      ['998', '메뉴 서버'],
    ]) {
      await dialog().getByLabel('연결할 메뉴 ID').fill(menuId);
      await dialog()
        .getByRole('button', { name: '메뉴 연결', exact: true })
        .click();
      await until(async () =>
        (await dialog().locator('.ai-action-error').textContent()).includes(
          text,
        ),
      );
      assert.equal(
        await dialog().getByLabel('연결할 메뉴 ID').inputValue(),
        menuId,
      );
      assert.equal(
        fixture.rows().find((r) => r.stockItemId === 105).menuId,
        null,
      );
    }
  });
  await run('삭제 취소·확인·논리 삭제 200', async () => {
    await button('재고 105 삭제').click();
    await dialog().getByRole('button', { name: '취소', exact: true }).click();
    await ready();
    assert.equal(await row(105).count(), 1);
    await button('재고 105 삭제').click();
    await page.screenshot({ path: `${output}/delete.png`, fullPage: true });
    await dialog().getByRole('button', { name: '삭제', exact: true }).click();
    await ready(5);
    assert.equal(await row(105).count(), 0);
  });
  await run('활성 주문 예약0 삭제·연결 거절', async () => {
    await button('재고 104 삭제').click();
    await dialog().getByRole('button', { name: '삭제', exact: true }).click();
    await until(async () =>
      (await dialog().textContent()).includes('복원 대상'),
    );
    assert.equal(
      fixture.rows().find((r) => r.stockItemId === 104).reservedQty,
      0,
    );
    await close();
    await button('재고 104 메뉴 연결').click();
    await dialog().getByLabel('메뉴 연결 해제', { exact: true }).check();
    await button('연결 해제').click();
    await until(async () =>
      (await dialog().locator('.ai-action-error').textContent()).includes(
        '복원 대상',
      ),
    );
    assert.equal(fixture.rows().find((r) => r.stockItemId === 104).menuId, 4);
  });
  for (const [scenario, text] of [
    ['write-400', '입력값'],
    ['write-401', '인증'],
    ['write-403', '권한'],
    ['write-404', '재고가 없거나'],
  ]) {
    await run(`${scenario} 변경 오류·기존 입력 보존`, async () => {
      fixture.controls.scenario = scenario;
      await button('재고 101 입고').click();
      await dialog().getByLabel('추가 입고 수량').fill('8');
      await button('입고 반영').click();
      await until(async () =>
        (await dialog().locator('.ai-action-error').textContent()).includes(
          text,
        ),
      );
      assert.equal(
        await dialog().getByLabel('추가 입고 수량').inputValue(),
        '8',
      );
      assert.equal(
        fixture.rows().find((r) => r.stockItemId === 101).stockQty,
        40,
      );
    });
  }
  for (const [scenario, text] of [
    ['list-401', '인증'],
    ['list-403', '권한'],
    ['list-404', '비활성화'],
    ['list-500', '처리하지 못했어요'],
  ]) {
    await run(`${scenario} 목록 오류·수동 재시도`, async () => {
      fixture.controls.scenario = scenario;
      await button('재고 목록 새로고침').click();
      await until(async () => await page.locator('.ai-list-error').isVisible());
      assert.match(
        await page.locator('.ai-list-error').textContent(),
        new RegExp(text),
      );
      assert.equal(await button('＋ 재고 등록').isDisabled(), true);
      fixture.controls.scenario = 'normal';
      await button('다시 조회').click();
      await ready();
    });
  }
  await run('네트워크 실패 후 데이터 보존·재조회', async () => {
    await page.route('**/api/v1/admin/inventory/items?*', (route) =>
      route.abort('failed'),
    );
    await button('재고 목록 새로고침').click();
    await until(async () => await page.locator('.ai-list-error').isVisible());
    assert.equal(await page.locator('tbody tr').count(), 6);
    await page.unroute('**/api/v1/admin/inventory/items?*');
    await button('다시 조회').click();
    await ready();
  });
  await run('응답 유실·자동 재전송 없음·GET 확인', async () => {
    fixture.controls.scenario = 'response-lost';
    const before = fixture.requests.filter((r) =>
      r.path.endsWith('/adjustments'),
    ).length;
    await button('재고 101 입고').click();
    await dialog().getByLabel('추가 입고 수량').fill('5');
    await button('입고 반영').click();
    await until(async () => await button('현재 재고 다시 확인').isVisible());
    assert.equal(await button('입고 반영').isDisabled(), true);
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith('/adjustments')).length,
      before + 1,
    );
    assert.equal(
      fixture.rows().find((r) => r.stockItemId === 101).stockQty,
      45,
    );
    await button('현재 재고 다시 확인').click();
    await until(async () => await button('확인 후 다시 제출').isEnabled());
    assert.match(await dialog().textContent(), /45개/);
    await close();
    assert.equal(
      fixture.requests.filter((r) => r.path.endsWith('/adjustments')).length,
      before + 1,
    );
    // A created row may be outside the active low-stock filter. Review must
    // still expose the complete authoritative snapshot before another POST.
    await button('부족 항목만').click();
    await ready(3);
    const creates = fixture.requests.filter(
      (r) => r.method === 'POST' && r.path === '/api/v1/admin/inventory/items',
    ).length;
    await button('＋ 재고 등록').click();
    await dialog().getByLabel('실제 재고 수량').fill('8');
    await dialog().getByLabel('부족 기준 수량').fill('1');
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await until(async () => await button('현재 재고 다시 확인').isVisible());
    await button('현재 재고 다시 확인').click();
    await until(
      async () => await dialog().locator('.ai-review-rows').isVisible(),
    );
    assert.match(
      await dialog().locator('.ai-review-rows').textContent(),
      /재고 #107 · 실제 8개/,
    );
    assert.equal(
      fixture.requests.filter(
        (r) =>
          r.method === 'POST' && r.path === '/api/v1/admin/inventory/items',
      ).length,
      creates + 1,
    );
    await close();
  });
  await run('지연 목록·이전 필터 응답 차단', async () => {
    fixture.controls.listDelay = 700;
    await button('재고 목록 새로고침').click();
    await until(async () => await page.locator('.ai-loading').isVisible());
    fixture.controls.listDelay = 0;
    await button('부족 항목만').click();
    await ready(3);
    await new Promise((done) => setTimeout(done, 800));
    assert.equal(await page.locator('tbody tr').count(), 3);
  });
  await run('저장 중 Escape·취소·중복 제출 차단', async () => {
    fixture.controls.writeDelay = 600;
    await button('재고 101 입고').click();
    await dialog().getByLabel('추가 입고 수량').fill('2');
    await button('입고 반영').click();
    await page.keyboard.press('Escape');
    assert.equal(await dialog().count(), 1);
    assert.equal(
      await dialog()
        .getByRole('button', { name: '취소', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await button('＋ 재고 등록').isDisabled(), true);
    await ready();
    assert.equal(await dialog().count(), 0);
    assert.equal(
      fixture.rows().find((r) => r.stockItemId === 101).stockQty,
      42,
    );
  });
  await run('메뉴 이름 대표 표시·검색 선택 후 두 단계 등록', async () => {
    await until(async () =>
      (await row(101).textContent()).includes('클래식 버거'),
    );
    const before = fixture.requests.length;
    await button('＋ 재고 등록').click();
    await dialog().getByLabel('실제 재고 수량').fill('8');
    await dialog().getByLabel('부족 기준 수량').fill('1');
    await until(
      async () => (await dialog().locator('.ai-menu-choice').count()) > 0,
    );
    const choice = dialog()
      .locator('.ai-menu-choice')
      .filter({ hasText: '메뉴 ID 5 ·' });
    const selectedName = await choice.locator('strong').textContent();
    await dialog().getByLabel('메뉴 이름 검색').fill(selectedName);
    await choice.click();
    await page.screenshot({
      path: `${output}/register-menu-selection.png`,
      fullPage: false,
    });
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await ready(7);
    assert.match(await row(107).textContent(), new RegExp(selectedName));
    const writes = fixture.requests
      .slice(before)
      .filter((request) => request.method !== 'GET');
    assert.deepEqual(
      writes.map((request) => [request.method, request.body]),
      [
        ['POST', { stockQty: 8, lowStockThreshold: 1 }],
        ['PUT', { menuId: 5 }],
      ],
    );
    await button('재고 107 입고').click();
    assert.match(await dialog().textContent(), new RegExp(selectedName));
    assert.match(
      await dialog().textContent(),
      /실제 재고.*8개.*예약 수량.*0개.*가용 수량.*8개/s,
    );
    await close();
  });
  await run('연결 실패 시 생성된 미연결 재고 보존·연결만 재시도', async () => {
    const creates = fixture.requests.filter(
      (r) => r.method === 'POST' && r.path.endsWith('/items'),
    ).length;
    await button('＋ 재고 등록').click();
    await dialog().getByLabel('실제 재고 수량').fill('9');
    await dialog().getByLabel('부족 기준 수량').fill('2');
    await dialog()
      .locator('.ai-menu-choice')
      .filter({ hasText: '메뉴 ID 1 ·' })
      .click();
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await until(async () => await dialog().locator('.ai-partial').isVisible());
    assert.equal(
      fixture.rows().find((r) => r.stockItemId === 107).menuId,
      null,
    );
    assert.equal(await dialog().getByLabel('연결할 메뉴 ID').inputValue(), '1');
    await dialog().getByLabel('연결할 메뉴 ID').fill('5');
    await dialog()
      .getByRole('button', { name: '메뉴 연결', exact: true })
      .click();
    await ready(7);
    assert.equal(fixture.rows().find((r) => r.stockItemId === 107).menuId, 5);
    assert.equal(
      fixture.requests.filter(
        (r) => r.method === 'POST' && r.path.endsWith('/items'),
      ).length,
      creates + 1,
    );
    assert.equal(
      fixture.requests.some(
        (r) => r.method === 'DELETE' && r.path.endsWith('/107'),
      ),
      false,
    );
  });
  await run('메뉴 조회 실패·비공개 이름 예외 및 미연결 등록 허용', async () => {
    await reset('menu-read-error');
    await ready();
    await until(async () =>
      (await row(101).textContent()).includes('메뉴 이름 조회 불가'),
    );
    assert.match(await row(101).textContent(), /메뉴 ID 1/);
    assert.doesNotMatch(await row(101).textContent(), /클래식 버거/);
    await button('＋ 재고 등록').click();
    await dialog()
      .getByText('메뉴 목록을 조회하지 못했어요. 미연결 등록은 가능해요.')
      .waitFor();
    await dialog().getByLabel('실제 재고 수량').fill('0');
    await dialog().getByLabel('부족 기준 수량').fill('0');
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await ready(7);
    assert.equal(fixture.rows().at(-1).menuId, null);
    await reset('menu-hidden-name');
    await ready();
    await until(async () =>
      (await row(101).textContent()).includes('메뉴 이름 조회 불가'),
    );
    assert.match(await row(101).textContent(), /메뉴 ID 999/);
  });
  await run('메뉴 목록 실패의 상세 fallback·이전 이름 응답 차단', async () => {
    await page.route('**/api/v1/menus?*', (route) => route.abort('failed'));
    await reset();
    await ready();
    await until(async () =>
      (await row(101).textContent()).includes('클래식 버거'),
    );
    await page
      .getByText('메뉴 목록 조회 불가 · 재고 조회와 수량은 유지됩니다.')
      .waitFor();
    await page.unroute('**/api/v1/menus?*');
    let release;
    const held = new Promise((done) => {
      release = done;
    });
    let oldStarted = false;
    const menu = {
      id: 999,
      categoryId: 1,
      name: '이전 공개 메뉴',
      basePrice: 1000,
      imageUrl: null,
      status: 'ON_SALE',
      description: null,
      options: [],
    };
    await page.route('**/api/v1/menus/999', async (route) => {
      oldStarted = true;
      await held;
      await route
        .fulfill({ json: { success: true, data: menu, message: 'OK' } })
        .catch(() => {});
    });
    await reset('menu-hidden-name');
    await ready();
    await until(() => oldStarted);
    await page.route('**/api/v1/menus?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          message: 'OK',
          data: {
            categories: [{ id: 1, name: '검수' }],
            menus: [{ ...menu, name: '최신 공개 메뉴' }],
          },
        },
      }),
    );
    await button('메뉴 이름 새로고침').click();
    await until(async () =>
      (await row(101).textContent()).includes('최신 공개 메뉴'),
    );
    release();
    await new Promise((done) => setTimeout(done, 100));
    assert.doesNotMatch(await row(101).textContent(), /이전 공개 메뉴/);
    await page.unroute('**/api/v1/menus/999');
    await page.unroute('**/api/v1/menus?*');
  });
  await run('키보드 Tab 포커스 격리·Escape·호출 버튼 복귀', async () => {
    const trigger = button('재고 101 입고');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await dialog().waitFor();
    for (let index = 0; index < 14; index++) {
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('dialog')?.contains(document.activeElement),
        ),
        true,
      );
    }
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.evaluate(() =>
        document.querySelector('dialog')?.contains(document.activeElement),
      ),
      true,
    );
    await close();
    assert.equal(
      await trigger.evaluate((element) => element === document.activeElement),
      true,
    );
  });
  await run('빈 목록·최초 등록', async () => {
    await reset('empty');
    await ready(0);
    assert.equal(
      await page.getByText('등록된 재고가 없어요', { exact: true }).isVisible(),
      true,
    );
    await button('＋ 재고 등록').click();
    await dialog().getByLabel('실제 재고 수량').fill('1');
    await dialog().getByLabel('부족 기준 수량').fill('0');
    await dialog()
      .getByRole('button', { name: '재고 등록', exact: true })
      .click();
    await ready(1);
  });
  for (const width of [390, 320])
    await run(`${width}px 목록 카드·패널·삭제 모달 overflow 검사`, async () => {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `${output}/mobile-${width}.png`,
        fullPage: true,
      });
      await button('재고 102 입고').click();
      await dialog().getByLabel('추가 입고 수량').fill('3');
      assert.equal(
        await dialog().evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
        true,
      );
      assert.equal(
        await dialog().evaluate(
          (element) =>
            Math.abs(element.getBoundingClientRect().top) < 1 &&
            Math.abs(element.getBoundingClientRect().bottom - innerHeight) < 1,
        ),
        true,
      );
      await page.screenshot({
        path: `${output}/mobile-${width}-panel.png`,
        fullPage: false,
      });
      await button('입고 반영').click();
      await ready();
      await button('재고 105 삭제').click();
      assert.equal(
        await dialog().evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
        true,
      );
      await close();
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
  assert.deepEqual(errors, []);
  for (const request of fixture.requests)
    for (const key of ['authorization', 'x-user-id', 'x-user-role'])
      assert.equal(request.headers[key], undefined);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      { passed: results.length, scenarios: results, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(`Admin Inventory Chromium: ${results.length} passed; ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
