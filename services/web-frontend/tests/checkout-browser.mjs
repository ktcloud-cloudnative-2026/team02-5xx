// Run with PLAYWRIGHT_ROOT pointing to an existing Playwright installation and
// PLAYWRIGHT_BROWSERS_PATH to its browser cache. No production dependency added.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startUiFixture } from './ui-fixture.mjs';

if (!process.env.PLAYWRIGHT_ROOT)
  throw new Error(
    'Set PLAYWRIGHT_ROOT to an existing Playwright installation.',
  );
const { chromium } = createRequire(
  resolve(process.env.PLAYWRIGHT_ROOT, 'package.json'),
)('playwright');
const output = resolve(process.env.CHECKOUT_QA_OUTPUT ?? '../../checkout-qa');
await mkdir(output, { recursive: true });
const fixture = await startUiFixture({
  entryFile: 'tests/checkout-browser-entry.jsx',
});
const browser = await chromium.launch({ headless: true });
const results = [];
const stored = JSON.stringify({
  version: 1,
  items: [{ menuId: 1, optionIds: [2], quantity: 2 }],
});
let page, context, errors, network;
async function fresh(
  query = '',
  viewport = { width: 1440, height: 1000 },
  hash = '#cart',
  initialCart = stored,
) {
  await context?.close();
  context = await browser.newContext({ viewport });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  errors = [];
  network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => network.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400)
      network.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(
    (value) => localStorage.setItem('peak-order.cart.v1', value),
    initialCart,
  );
  await page.goto(`${fixture.url}/?${query}${hash}`);
}
async function checkout() {
  await page.getByRole('button', { name: '주문하기', exact: true }).click();
  await page
    .getByRole('button', { name: '모의 주문 금액 확인', exact: true })
    .waitFor({ state: 'visible' });
}
async function create() {
  const button = page.getByRole('button', {
    name: '모의 주문 금액 확인',
    exact: true,
  });
  await button.click();
  await page.getByRole('button', { name: /원 모의 결제$/ }).waitFor();
}
async function immediate() {
  await page.locator('[data-menu-id="1"]').click();
  await page.getByRole('radio', { name: /^세트 \+/ }).check();
  await page.getByRole('button', { name: '수량 늘리기', exact: true }).click();
  await page
    .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
    .click();
  await page.getByRole('dialog', { name: '바로 주문할까요?' }).waitFor();
}
async function screenshot(name) {
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: false,
  });
}
async function check(name, run) {
  if (
    process.env.CHECKOUT_QA_FILTER &&
    !new RegExp(process.env.CHECKOUT_QA_FILTER).test(name)
  )
    return;
  try {
    await run();
    assert.deepEqual(errors, [], 'Console/page errors');
    assert.deepEqual(network, [], 'Network errors');
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    if (page) await screenshot(`FAIL-${results.length}`);
  }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  for (const source of ['cart', 'immediate'])
    await check(
      `success review: ${source} completion returns to menu and cannot replay through history`,
      async () => {
        await fresh(
          '',
          { width: 1440, height: 1000 },
          source === 'cart' ? '#cart' : '#menu-list',
        );
        if (source === 'cart') await checkout();
        else {
          await immediate();
          await page
            .getByRole('button', { name: '주문 확인으로 이동 →' })
            .click();
        }
        assert.match(
          await page.locator('.checkout-summary').innerText(),
          /세트/,
        );
        assert.match(
          await page.locator('.checkout-summary').innerText(),
          /× 2/,
        );
        await create();
        await page.getByRole('button', { name: /원 모의 결제$/ }).click();
        await page.locator('.mock-order-number').waitFor();
        const cart = JSON.parse(
          await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        );
        assert.deepEqual(
          cart,
          source === 'cart' ? { version: 1, items: [] } : JSON.parse(stored),
        );
        await page
          .locator('.payment-success')
          .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
          .click();
        await page.waitForFunction(
          () =>
            location.hash === '#menu-list' &&
            document.querySelectorAll('dialog[open]').length === 0,
        );
        assert.equal(
          await page.evaluate(() => !!history.state?.peakOrderCheckout),
          false,
        );
        await page.goBack();
        await page.goForward();
        assert.equal(await page.locator('.checkout-page').count(), 0);
        assert.equal(
          await page.evaluate(() => window.__checkoutQA.calls.pay),
          1,
        );
        await screenshot(`success-review-${source}-menu`);
      },
    );
  for (const quantity of [1, 4])
    await check(
      `success review: changed cart quantity ${quantity} retains unrelated option`,
      async () => {
        await fresh();
        await checkout();
        await create();
        const other = { menuId: 1, optionIds: [1], quantity: 3 };
        await page.evaluate(
          ({ quantity, other }) =>
            localStorage.setItem(
              'peak-order.cart.v1',
              JSON.stringify({
                version: 1,
                items: [{ menuId: 1, optionIds: [2], quantity }, other],
              }),
            ),
          { quantity, other },
        );
        await page.getByRole('button', { name: /원 모의 결제$/ }).click();
        await page.locator('.mock-order-number').waitFor();
        assert.deepEqual(
          JSON.parse(
            await page.evaluate(() =>
              localStorage.getItem('peak-order.cart.v1'),
            ),
          ).items,
          quantity > 2
            ? [{ menuId: 1, optionIds: [2], quantity: quantity - 2 }, other]
            : [other],
        );
      },
    );
  await check(
    'cart checkout / verified totals / back preserves storage and cart',
    async () => {
      await fresh();
      await checkout();
      await page
        .getByRole('button', { name: '모의 주문 금액 확인' })
        .isEnabled();
      assert.match(
        await page.locator('.checkout-summary').innerText(),
        /18,000원/,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
      await page.waitForFunction(
        () => !document.querySelector('.checkout-submit')?.disabled,
      );
      await screenshot('checkout-1440');
      await page
        .getByRole('button', { name: '주문 확인에서 뒤로가기' })
        .click();
      await page.locator('.cart-modal[open]').waitFor();
      assert.equal(
        await page.getByLabel('클래식 버거 수량', { exact: true }).innerText(),
        '2',
      );
    },
  );
  await check(
    'immediate estimate / wait vs ready / close preserves option quantity and cart',
    async () => {
      await fresh('', { width: 1920, height: 1080 }, '#menu-list');
      await immediate();
      await page.waitForFunction(
        () =>
          !document.querySelector('.estimate-modal footer button')?.disabled,
      );
      assert.match(await page.locator('.estimate-modal').innerText(), /약 7분/);
      assert.match(
        await page.locator('.estimate-modal').innerText(),
        /약 15분/,
      );
      await screenshot('estimate-1920');
      await page.getByRole('button', { name: '예상시간 닫기' }).click();
      await page.locator('.detail-modal[open]').waitFor();
      assert.equal(await page.getByLabel('선택 수량').innerText(), '2');
      assert.equal(
        await page.getByRole('radio', { name: /^세트 \+/ }).isChecked(),
        true,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
    },
  );
  await check(
    '1920 layout / payment method radio keyboard / tab containment / ESC',
    async () => {
      await fresh('', { width: 1920, height: 1080 });
      await checkout();
      await page.getByRole('radio', { name: '간편결제' }).check();
      assert.equal(
        await page.getByRole('radio', { name: '간편결제' }).isChecked(),
        true,
      );
      await page.getByRole('radio', { name: '간편결제' }).press('ArrowRight');
      assert.equal(
        await page.getByRole('radio', { name: '계좌이체' }).isChecked(),
        true,
      );
      await page.waitForFunction(
        () => !document.querySelector('.checkout-submit')?.disabled,
      );
      await screenshot('checkout-1920');
      await page
        .getByRole('button', { name: '주문 확인에서 뒤로가기' })
        .focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest('dialog')?.className,
        ),
        'checkout-page',
      );
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest('dialog')?.className,
        ),
        'checkout-page',
      );
      await page.keyboard.press('Escape');
      await page.locator('.checkout-page').waitFor({ state: 'detached' });
      assert.equal(
        await page.evaluate(() => document.body.style.overflow),
        'hidden',
      ); // cart remains open
      await page.keyboard.press('Escape');
      await page.locator('.cart-modal').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    },
  );
  await check(
    'Mock success / create then pay / no real operation / one request each',
    async () => {
      await fresh();
      await checkout();
      await create();
      assert.equal(await page.locator('.mock-order-number').count(), 0);
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.match(
        await page.locator('.mock-order-number').innerText(),
        /^\d{6}-\d{4}$/,
      );
      await screenshot('success-1440');
      assert.deepEqual(
        await page.evaluate(() => ({
          create: window.__checkoutQA.calls.create,
          pay: window.__checkoutQA.calls.pay,
        })),
        { create: 1, pay: 1 },
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        JSON.stringify({ version: 1, items: [] }),
      );
    },
  );
  await check(
    'clear decline / new temporary order only / no repay button',
    async () => {
      await fresh('scenario=declined');
      await checkout();
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.getByRole('button', { name: '주문 다시 확인' }).waitFor();
      await screenshot('declined-1440');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        0,
      );
      assert.equal(
        await page.getByRole('button', { name: /원 모의 결제$/ }).count(),
        0,
      );
      await page.getByRole('button', { name: '주문 다시 확인' }).click();
      await create();
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        2,
      );
    },
  );
  await check(
    'unknown payment / CREATED lookup / no automatic write retry',
    async () => {
      await fresh('scenario=unknown');
      await checkout();
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.getByRole('button', { name: 'Mock 주문 상태 확인' }).click();
      await page
        .getByText('아직 확정되지 않았어요.', { exact: false })
        .waitFor();
      await screenshot('unknown-1440');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        0,
      );
      assert.equal(
        await page.getByRole('button', { name: /원 모의 결제$/ }).count(),
        0,
      );
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 1);
    },
  );
  await check(
    'lost payment response / explicit read confirms PAID',
    async () => {
      await fresh('scenario=unknown-paid');
      await checkout();
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.getByRole('button', { name: 'Mock 주문 상태 확인' }).waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
      await page.getByRole('button', { name: 'Mock 주문 상태 확인' }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(
        JSON.parse(
          await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        ),
        { version: 1, items: [] },
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        1,
      );
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 1);
    },
  );
  for (const estimate of ['unavailable', 'outage', 'invalid', 'timeout'])
    await check(`estimate ${estimate} blocks creation`, async () => {
      await fresh(`estimate=${estimate}`);
      await checkout();
      await page.getByRole('button', { name: '예상시간 다시 조회' }).waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: '모의 주문 금액 확인' })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        0,
      );
    });
  await check('estimate temporary failure / retry succeeds', async () => {
    await fresh('estimate=retry');
    await checkout();
    await page.getByRole('button', { name: '예상시간 다시 조회' }).click();
    await create();
    assert.equal(
      await page.evaluate(() => window.__checkoutQA.calls.estimate),
      2,
    );
  });
  await check(
    'create explicit failure / cart retained / no payment',
    async () => {
      await fresh('scenario=create-failed');
      await checkout();
      await page.getByRole('button', { name: '모의 주문 금액 확인' }).click();
      await page.getByRole('button', { name: '주문 다시 확인' }).waitFor();
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        0,
      );
    },
  );
  await check(
    'duplicate payment / exit ESC warning remains modal / no duplicate',
    async () => {
      await fresh('delay=400');
      await checkout();
      await create();
      const pay = page.getByRole('button', { name: /원 모의 결제$/ });
      await pay.evaluate((button) => {
        button.click();
        button.click();
      });
      await page.keyboard.press('Escape');
      await page
        .getByRole('heading', { name: '선택 화면으로 돌아갈까요?' })
        .waitFor();
      assert.equal(
        await page.locator('.checkout-page').evaluate((dialog) => dialog.open),
        true,
      );
      await page.getByRole('button', { name: '이 화면에서 계속 확인' }).click();
      await page.locator('.mock-order-number').waitFor();
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 1);
    },
  );
  for (const action of ['logout', 'switch'])
    await check(
      `session ${action} during pending response fences old action`,
      async () => {
        await fresh('delay=350');
        await checkout();
        await page.getByRole('button', { name: '모의 주문 금액 확인' }).click();
        await page.evaluate(
          (action) =>
            action === 'logout'
              ? window.__checkoutQA.logout()
              : window.__checkoutQA.customer(2),
          action,
        );
        await page
          .getByRole('heading', { name: '로그인 상태가 변경됐어요' })
          .waitFor();
        await page.waitForTimeout(450);
        assert.equal(await page.locator('.login-modal[open]').count(), 0);
        assert.equal(
          await page.getByRole('button', { name: /원 모의 결제$/ }).count(),
          0,
        );
        assert.equal(await page.locator('.mock-order-number').count(), 0);
        assert.equal(
          await page.evaluate(() => window.__checkoutQA.calls.pay),
          0,
        );
      },
    );
  await check(
    'anonymous login cancel preserves selection and never orders',
    async () => {
      await fresh(
        'session=anonymous',
        { width: 1440, height: 1000 },
        '#menu-list',
      );
      await page.locator('[data-menu-id="1"]').click();
      await page
        .getByRole('button', { name: '수량 늘리기', exact: true })
        .click();
      await page
        .getByRole('button', { name: '이 메뉴만 바로 주문', exact: true })
        .click();
      await page
        .getByRole('button', { name: '선택한 화면으로 돌아가기' })
        .click();
      assert.equal(await page.getByLabel('선택 수량').innerText(), '2');
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        0,
      );
    },
  );
  await check('STORE_ADMIN cannot enter customer checkout', async () => {
    await fresh('session=admin');
    await page
      .locator('.cart-modal')
      .getByRole('button', { name: '주문하기', exact: true })
      .click();
    await page
      .getByText('주문하려면 고객용 계정으로 로그인해 주세요.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator('.checkout-page').count(), 0);
  });
  await check('empty cart cannot submit', async () => {
    await fresh(
      '',
      { width: 1440, height: 1000 },
      '#cart',
      JSON.stringify({ version: 1, items: [] }),
    );
    await page
      .getByRole('heading', { name: '장바구니가 비어 있어요' })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: '주문하기', exact: true }).count(),
      0,
    );
  });
  await check(
    'login completion resumes selected immediate order once with no cart mutation',
    async () => {
      await fresh(
        'session=anonymous',
        { width: 1440, height: 1000 },
        '#menu-list',
      );
      await page.locator('#test-pending').click();
      await immediate();
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await create();
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        1,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
    },
  );
  await check(
    'browser back during estimate / no late resurrection / source restored',
    async () => {
      await fresh('delay=350');
      await checkout();
      await page.goBack();
      await page.waitForTimeout(450);
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.equal(await page.evaluate(() => location.hash), '#cart');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
    },
  );
  await check(
    'component unmount fences late request / remount does not replay',
    async () => {
      await fresh('delay=350');
      await checkout();
      await page.evaluate(() => window.__checkoutQA.unmount());
      await page.waitForTimeout(450);
      await page.evaluate(() => window.__checkoutQA.mount());
      assert.equal(await page.locator('.checkout-page').count(), 0);
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        0,
      );
    },
  );
  await check(
    'mobile 390px / no overflow / immediate to checkout / controls usable',
    async () => {
      await fresh('', { width: 390, height: 844 }, '#menu-list');
      await immediate();
      await page.waitForFunction(
        () =>
          !document.querySelector('.estimate-modal footer button')?.disabled,
      );
      await screenshot('estimate-mobile');
      await page.getByRole('button', { name: '주문 확인으로 이동 →' }).click();
      await page.getByRole('radio', { name: '휴대폰 결제' }).check();
      await screenshot('checkout-mobile');
      assert.ok(
        await page
          .locator('.checkout-page')
          .evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
      );
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      await screenshot('success-mobile');
    },
  );
  await check(
    'success review: unresolved then confirmed payment subtracts latest quantity exactly once',
    async () => {
      await fresh('scenario=unknown-paid&delay=150');
      await checkout();
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.getByRole('button', { name: 'Mock 주문 상태 확인' }).waitFor();
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        0,
      );
      await page.evaluate(() =>
        localStorage.setItem(
          'peak-order.cart.v1',
          JSON.stringify({
            version: 1,
            items: [{ menuId: 1, optionIds: [2], quantity: 5 }],
          }),
        ),
      );
      await page
        .getByRole('button', { name: 'Mock 주문 상태 확인' })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await page.locator('.mock-order-number').waitFor();
      assert.deepEqual(
        JSON.parse(
          await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        ).items,
        [{ menuId: 1, optionIds: [2], quantity: 3 }],
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        2,
      ); // one external edit + one completion
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.get), 1);
      await page
        .locator('.payment-success')
        .getByRole('button', { name: '메뉴로 돌아가기', exact: true })
        .click();
      await page.goBack();
      await page.goForward();
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        2,
      );
    },
  );
  for (const action of ['logout', 'switch'])
    await check(
      `success review: late confirmed response after ${action} never clears cart`,
      async () => {
        await fresh();
        await checkout();
        await create();
        await page.evaluate(() => window.__checkoutQA.holdPaidResponse());
        await page.getByRole('button', { name: /원 모의 결제$/ }).click();
        await page.waitForFunction(
          () => window.__checkoutQA.paidResponseWaiting,
        );
        await page.evaluate((action) => {
          if (action === 'logout') window.__checkoutQA.logout();
          else window.__checkoutQA.customer(2);
          window.__checkoutQA.releasePaidResponse();
        }, action);
        await page
          .getByRole('heading', { name: '로그인 상태가 변경됐어요' })
          .waitFor();
        assert.equal(
          await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
          stored,
        );
        assert.equal(
          await page.evaluate(() => window.__checkoutQA.cartWrites.length),
          0,
        );
        assert.equal(await page.locator('.mock-order-number').count(), 0);
      },
    );
  await check(
    'success review: storage failure keeps successful payment and warns without clearing cart',
    async () => {
      await fresh();
      await checkout();
      await create();
      await page.evaluate(() => window.__checkoutQA.failCartWrites());
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.locator('.mock-order-number').waitFor();
      await page
        .locator('.payment-success')
        .getByText(
          '결제 성공은 확인했지만 장바구니 정리를 저장하지 못했어요.',
          { exact: false },
        )
        .waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        stored,
      );
    },
  );
  await check(
    'Mock recovery of the same expired CREATED order completes once',
    async () => {
      await fresh('scenario=recoverable');
      await checkout();
      await create();
      await page.getByRole('button', { name: /원 모의 결제$/ }).click();
      await page.getByRole('button', { name: 'Mock 주문 상태 확인' }).click();
      const recover = page.getByRole('button', {
        name: '같은 주문 처리 이어가기',
        exact: true,
      });
      await recover.waitFor();
      await recover.evaluate((button) => {
        button.click();
        button.click();
      });
      await page.locator('.mock-order-number').waitFor();
      assert.equal(await page.evaluate(() => window.__checkoutQA.calls.pay), 2);
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.calls.create),
        1,
      );
      assert.equal(
        await page.evaluate(() => window.__checkoutQA.cartWrites.length),
        1,
      );
      assert.deepEqual(
        JSON.parse(
          await page.evaluate(() => localStorage.getItem('peak-order.cart.v1')),
        ),
        { version: 1, items: [] },
      );
    },
  );
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        results,
        passed: results.filter((r) => r.status === 'PASS').length,
        failed: results.filter((r) => r.status === 'FAIL').length,
        note: 'Real Chromium render of production-compiled React with test-only injected session and in-memory Mock. No actual Auth/Order/Cooking HTTP integration.',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await fixture.close();
}
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
