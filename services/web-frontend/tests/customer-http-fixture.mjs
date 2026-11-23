// Local contract HTTP server, never imported by a product entry.
import { startAuthFixture } from './auth-http-fixture.mjs';
import { menus } from '../src/data/mockMenus.js';

export const sampleCustomerOrder = (id) => ({
  orderId: id,
  orderNo: `TEST-${id}`,
  status: 'PAID',
  orderedAt: '2026-11-23T09:00:00+09:00',
  paidAt: '2026-11-23T09:01:00+09:00',
  totalAmount: 18000,
  items: [
    {
      menuId: 1,
      menuName: '클래식 버거',
      unitPrice: 6500,
      quantity: 2,
      lineAmount: 18000,
      options: [{ optionId: 2, optionName: '세트', extraPrice: 2500 }],
    },
  ],
  cooking: {
    lookup: 'OK',
    status: 'WAITING',
    expectedWaitSec: 120,
    expectedReadySec: 360,
  },
});

export const checkoutScenarios = [
  'success',
  'declined',
  'unknown',
  'unknown-paid',
  'stock',
  'closed',
  'unavailable',
  'expired',
  'estimate-error',
  'in-progress',
];
export const congestionScenarios = {
  normal: {
    level: 'NORMAL',
    waitingCount: 3,
    cookingCount: 1,
    expectedWaitSec: 120,
  },
  crowded: {
    level: 'CROWDED',
    waitingCount: 12,
    cookingCount: 1,
    expectedWaitSec: 901,
  },
  zero: {
    level: 'NORMAL',
    waitingCount: 0,
    cookingCount: 0,
    expectedWaitSec: 0,
  },
};

export async function startCustomerHttpFixture({
  input,
  handleRequest,
  preview = false,
} = {}) {
  const controls = { scenario: 'success', delay: 0, priceDelta: 0 };
  const homeControls = { congestion: 'normal' };
  const requests = [];
  const orders = new Map();
  const owners = new Map();
  if (preview) {
    for (let id = 1; id <= 21; id++) {
      const sample = sampleCustomerOrder(id);
      if (id === 2)
        Object.assign(sample.cooking, {
          status: 'COOKING',
          startedAt: sample.paidAt,
          expectedWaitSec: 0,
        });
      if (id === 3) {
        sample.status = 'COMPLETED';
        sample.completedAt = sample.paidAt;
        sample.cooking.status = 'DONE';
      }
      orders.set(id, sample);
      owners.set(id, 1);
    }
  }
  let sequence = 100;
  const fixture = await startAuthFixture({
    ...(input ? { input } : {}),
    ...(preview
      ? {
          previewControls: () => `
      <aside aria-label="HTTP fixture 검수 도구" style="margin:24px;padding:24px;border:2px dashed #888;background:white;color:#222;font:14px sans-serif">
        <h2>로컬 HTTP fixture · 실제 백엔드 데이터가 아닙니다</h2>
        <p>CUSTOMER: customer@example.test / STORE_ADMIN: admin@example.test · 공통 비밀번호: fixture-only-password</p>
        <p>주문·샘플은 이 서버의 메모리에만 보관됩니다. 서버를 다시 시작하면 초기화됩니다.</p>
        <form action="/__fixture/scenarios" method="post">
          <label>혼잡도 시나리오 <select name="congestion">${['normal', 'crowded', 'zero', 'error'].map((value) => `<option value="${value}" ${homeControls.congestion === value ? 'selected' : ''}>${{ normal: '정상 (3건/2분)', crowded: '혼잡 (12건/15분 1초)', zero: '0건/0초', error: '오류 (503)' }[value]}</option>`).join('')}</select></label>
          <label>Checkout 시나리오 <select name="checkout">${checkoutScenarios.map((value) => `<option ${controls.scenario === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <button type="submit">시나리오 적용</button>
          <p role="status" data-fixture-status>적용 후 홈의 혼잡도 새로고침/다시 시도를 눌러 주세요.</p>
        </form>
        <script>document.querySelector('form[action="/__fixture/scenarios"]').addEventListener('submit', async event => {
          event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('[data-fixture-status]');
          try { const response=await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(form))});
            status.textContent=response.ok?'적용했습니다. 홈의 혼잡도 새로고침/다시 시도를 눌러 주세요.':'시나리오를 적용하지 못했습니다.';
          } catch { status.textContent='미리보기 서버 연결을 확인해 주세요.'; }
        });</script>
      </aside>`,
        }
      : {}),
    async handleRequest(request, response, user) {
      if (handleRequest && (await handleRequest(request, response, user)))
        return true;
      const path = request.url.split('?')[0];
      if (preview && path === '/__fixture/scenarios') {
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return true;
        }
        if (request.headers.origin !== `http://${request.headers.host}`) {
          response.writeHead(403).end();
          return true;
        }
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const values = new URLSearchParams(raw);
        const congestion = values.get('congestion'),
          checkout = values.get('checkout');
        if (
          !['normal', 'crowded', 'zero', 'error'].includes(congestion) ||
          !checkoutScenarios.includes(checkout) ||
          values.getAll('congestion').length !== 1 ||
          values.getAll('checkout').length !== 1
        ) {
          response.writeHead(400).end();
          return true;
        }
        homeControls.congestion = congestion;
        controls.scenario = checkout;
        if (request.headers.accept === 'application/json')
          response.writeHead(204).end();
        else response.writeHead(303, { Location: '/#home' }).end();
        return true;
      }
      if (
        !path.startsWith('/api/v1/orders') &&
        path !== '/api/v1/cooking/estimates' &&
        path !== '/api/v1/cooking/congestion'
      )
        return false;
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : null;
      requests.push({
        method: request.method,
        path,
        body,
        hasBearer: !!request.headers.authorization,
        hasFakeIdentity: 'x-user-id' in request.headers,
        hasPaymentKey: 'idempotency-key' in request.headers,
      });
      const scenario = controls.scenario,
        priceDelta = controls.priceDelta;
      if (controls.delay)
        await new Promise((done) => setTimeout(done, controls.delay));
      const send = (status, data, errorCode) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            success: status < 300,
            data,
            message: 'Contract fixture only',
            ...(errorCode ? { errorCode } : {}),
          }),
        );
      };
      if (path === '/api/v1/cooking/congestion') {
        if (request.method !== 'GET') send(405, null, 'METHOD_NOT_ALLOWED');
        else if (homeControls.congestion === 'error')
          send(503, null, 'COOKING_SERVICE_UNAVAILABLE');
        else send(200, congestionScenarios[homeControls.congestion]);
        return true;
      }
      if (path === '/api/v1/cooking/estimates') {
        if (scenario === 'estimate-error')
          send(503, null, 'MENU_SERVICE_UNAVAILABLE');
        else
          send(200, {
            expectedWaitSec: 420,
            cookSec: 480,
            expectedReadySec: 900,
          });
        return true;
      }
      if (!user) {
        send(401, null, 'UNAUTHORIZED');
        return true;
      }
      if (user.role !== 'CUSTOMER') {
        send(403, null, 'FORBIDDEN');
        return true;
      }
      if (request.method === 'GET' && path === '/api/v1/orders') {
        const query = new URL(request.url, 'http://fixture').searchParams;
        const page = Number(query.get('page') ?? 0),
          size = Number(query.get('size') ?? 20);
        if (
          !Number.isSafeInteger(page) ||
          page < 0 ||
          page > 2147483647 ||
          !Number.isInteger(size) ||
          size < 1 ||
          size > 100
        ) {
          send(400, null, 'INVALID_REQUEST');
          return true;
        }
        const all = [...orders.values()]
          .filter(
            (o) =>
              owners.get(o.orderId) === user.id &&
              !['CREATED', 'FAILED'].includes(o.status),
          )
          .sort((a, b) => b.orderId - a.orderId);
        send(200, {
          page,
          size,
          totalElements: all.length,
          items: all.slice(page * size, (page + 1) * size).map((o) => ({
            orderId: o.orderId,
            orderNo: o.orderNo,
            status: o.status,
            totalAmount: o.totalAmount,
            orderedAt: o.orderedAt,
            itemCount: o.items.length,
            representativeMenuName: o.items[0].menuName,
          })),
        });
        return true;
      }
      if (request.method === 'POST' && path === '/api/v1/orders') {
        if (['stock', 'closed', 'unavailable'].includes(scenario)) {
          send(
            409,
            null,
            {
              stock: 'OUT_OF_STOCK',
              closed: 'STORE_NOT_ACCEPTING_ORDERS',
              unavailable: 'MENU_NOT_AVAILABLE',
            }[scenario],
          );
          return true;
        }
        const items = body.items.map((row) => {
          const menu = menus.find((m) => m.id === row.menuId);
          const options = row.optionIds.map((id) =>
            menu.options.find((o) => o.id === id),
          );
          const unitPrice = menu.basePrice + priceDelta;
          return {
            menuId: row.menuId,
            menuName: menu.name,
            unitPrice,
            quantity: row.quantity,
            lineAmount:
              (unitPrice + options.reduce((sum, o) => sum + o.extraPrice, 0)) *
              row.quantity,
            options: options.map((o) => ({
              optionId: o.id,
              optionName: o.name,
              extraPrice: o.extraPrice,
            })),
          };
        });
        const order = {
          orderId: ++sequence,
          status: 'CREATED',
          orderedAt: new Date().toISOString(),
          items,
          totalAmount: items.reduce((sum, row) => sum + row.lineAmount, 0),
          holdExpiresAt: new Date(
            Date.now() + (scenario === 'expired' ? -1000 : 300000),
          ).toISOString(),
        };
        orders.set(order.orderId, order);
        owners.set(order.orderId, user.id);
        send(201, order);
        return true;
      }
      const id = Number(path.split('/')[4]),
        order = orders.get(id);
      if (!order || owners.get(id) !== user.id) {
        send(404, null, 'ORDER_NOT_FOUND');
        return true;
      }
      if (request.method === 'POST' && path.endsWith('/cancel')) {
        if (
          order.status !== 'CREATED' &&
          !(order.status === 'PAID' && order.cooking?.status === 'WAITING')
        ) {
          send(409, null, 'ORDER_NOT_CANCELABLE');
          return true;
        }
        const canceled = {
          ...order,
          status: 'CANCELED',
          canceledAt: new Date().toISOString(),
          cooking: undefined,
        };
        orders.set(id, canceled);
        send(200, canceled);
        return true;
      }
      if (path.endsWith('/pay')) {
        if (order.status === 'PAID') {
          send(200, order);
          return true;
        }
        if (scenario === 'in-progress') {
          send(409, null, 'ORDER_PAY_IN_PROGRESS');
          return true;
        }
        if (scenario === 'declined') {
          orders.set(id, {
            ...order,
            status: 'FAILED',
            holdExpiresAt: undefined,
          });
          send(402, null, 'PAYMENT_FAILED');
        } else if (scenario === 'expired') send(409, null, 'HOLD_EXPIRED');
        else if (scenario === 'unknown')
          send(503, null, 'PAYMENT_SERVICE_UNAVAILABLE');
        else {
          const paid = {
            ...order,
            status: 'PAID',
            orderNo: `HTTP-CONTRACT-${id}`,
            holdExpiresAt: undefined,
            cooking: { lookup: 'PENDING' },
          };
          orders.set(id, paid);
          if (scenario === 'unknown-paid')
            send(503, null, 'PAYMENT_SERVICE_UNAVAILABLE');
          else send(200, paid);
        }
      } else send(200, order);
      return true;
    },
  });
  return {
    ...fixture,
    checkoutControls: controls,
    homeControls,
    requests,
    orders,
  };
}
