// Local contract HTTP server, never imported by a product entry.
import { startAuthFixture } from './auth-http-fixture.mjs';
import { menus } from '../src/data/mockMenus.js';

export async function startCustomerHttpFixture({ input } = {}) {
  const controls = { scenario: 'success', delay: 0, priceDelta: 0 };
  const requests = [];
  const orders = new Map();
  let sequence = 100;
  const fixture = await startAuthFixture({
    ...(input ? { input } : {}),
    async handleRequest(request, response, user) {
      const path = request.url.split('?')[0];
      if (
        !path.startsWith('/api/v1/orders') &&
        path !== '/api/v1/cooking/estimates'
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
      if (request.method === 'POST' && path === '/api/v1/orders') {
        const createFaults = {
          'create-menu': [503, 'MENU_SERVICE_UNAVAILABLE'],
          'create-inventory': [503, 'INVENTORY_SERVICE_UNAVAILABLE'],
          'create-500': [500, 'INTERNAL_ERROR'],
        };
        if (createFaults[scenario]) {
          send(createFaults[scenario][0], null, createFaults[scenario][1]);
          return true;
        }
        if (scenario === 'create-malformed') {
          send(201, { orderId: 999 });
          return true;
        }
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
          items,
          totalAmount: items.reduce((sum, row) => sum + row.lineAmount, 0),
          holdExpiresAt: new Date(
            Date.now() + (scenario === 'expired' ? -1000 : 300000),
          ).toISOString(),
        };
        orders.set(order.orderId, order);
        send(201, order);
        return true;
      }
      const id = Number(path.split('/')[4]),
        order = orders.get(id);
      if (!order) {
        send(404, null, 'ORDER_NOT_FOUND');
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
  return { ...fixture, checkoutControls: controls, requests };
}
