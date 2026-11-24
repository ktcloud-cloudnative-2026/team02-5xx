import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE,
);
const fixture = await startCustomerHttpFixture();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(5000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let release;
const blocked = new Promise((done) => {
  release = done;
});
const original = {
  version: 1,
  items: [{ menuId: 2, optionIds: [1], quantity: 1 }],
};
let result;
try {
  await page.addInitScript(
    (cart) => localStorage.setItem('peak-order.cart.v1', JSON.stringify(cart)),
    original,
  );
  await page.route('**/api/v1/menus/2', async (route) => {
    await blocked;
    await route.continue();
  });
  await page.goto(fixture.url + '#menu-list');
  await page.locator('[data-menu-id="1"]').click();
  const detail = page.locator('.detail-modal');
  await detail.locator('input[type="radio"][value="2"]').check();
  await detail.getByRole('button', { name: '수량 늘리기' }).click();
  await detail
    .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
    .click();
  await page
    .getByLabel('이메일', { exact: true })
    .fill('customer@example.test');
  await page
    .getByLabel('비밀번호', { exact: true })
    .fill('fixture-only-password');
  await page.locator('.login-form button[type="submit"]').click();
  await page.locator('.login-modal').waitFor({ state: 'detached' });
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('peak-order.cart.v1')),
    ),
    original,
  );
  release();
  await page.locator('.estimate-modal[open]').waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('peak-order.cart.v1')),
    ),
    original,
  );
  assert.equal(
    fixture.requests.filter(
      (request) => request.path === '/api/v1/cooking/estimates',
    ).length,
    1,
  );
  assert.equal(
    fixture.requests.filter((request) => request.path === '/api/v1/orders')
      .length,
    0,
  );
  assert.deepEqual(pageErrors, []);
  result = {
    status: 'PASS',
    scenario:
      'Delayed catalog validation preserves immediate-order login intent exactly once without changing cart',
    pageErrors,
  };
} catch (error) {
  result = {
    status: 'FAIL',
    scenario:
      'Delayed catalog validation preserves immediate-order login intent exactly once without changing cart',
    error: error.message,
    pageErrors,
  };
  process.exitCode = 1;
} finally {
  release();
  await context.close();
  await browser.close();
  await fixture.close();
}
console.log(JSON.stringify(result));
await writeFile(
  resolve(process.env.INTEGRATION_QA_OUTPUT),
  JSON.stringify(result, null, 2),
);
