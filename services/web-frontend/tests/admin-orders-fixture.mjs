// Loopback synthetic Order contract. No real account, identity header or service.
import http from 'node:http';
import { adminScenarios } from './admin-orders-scenarios.mjs';
const statuses = [
  'CREATED',
  'PAID',
  'WAITING',
  'COOKING',
  'COMPLETED',
  'CANCELED',
  'FAILED',
];
export function makeAdminOrders(now = new Date()) {
  const records = new Map();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
    .format(now)
    .replaceAll('-', '');
  for (let id = 1; id <= 47; id++) {
    const status =
      {
        47: 'CREATED',
        46: 'FAILED',
        45: 'CANCELED',
        44: 'CANCELED',
        43: 'COOKING',
        42: 'WAITING',
        41: 'PAID',
        40: 'COMPLETED',
      }[id] ?? statuses[id % 7];
    const orderedAt = new Date(
      now.getTime() - (47 - id) * 1800000,
    ).toISOString();
    const paid = !['CREATED', 'FAILED'].includes(status) || id === 46;
    const manual = [45, 38, 31].includes(id);
    const record = {
      orderId: id,
      userId: 1000 + (id % 5),
      status,
      totalAmount: 20000,
      orderedAt,
      manualReviewRequired: manual,
      cancelFollowUpAttempts: manual ? 8 : status === 'CANCELED' ? 1 : 0,
      items: [
        {
          menuId: 1,
          menuName: '클래식 버거',
          unitPrice: 6500,
          quantity: 2,
          lineAmount: 18000,
          options: [{ optionId: 2, optionName: '세트', extraPrice: 2500 }],
        },
        {
          menuId: 7,
          menuName: '콜라',
          unitPrice: 2000,
          quantity: 1,
          lineAmount: 2000,
          options: [],
        },
      ],
    };
    if (paid) {
      record.paidAt = orderedAt;
      record.paymentId = 5000 + id;
    }
    if (!['CREATED', 'FAILED'].includes(status))
      record.orderNo = `PO-${date}-${String(id).padStart(4, '0')}`;
    if (status === 'COMPLETED') record.completedAt = orderedAt;
    if (status === 'CANCELED' || manual) {
      record.status = 'CANCELED';
      record.canceledAt = orderedAt;
      record.cancelRequestedAt = orderedAt;
      record.cancelReason = '고객 요청';
      record.stockRestoredAt = orderedAt;
      if (manual)
        record.manualReviewReason =
          id === 45 ? 'REFUND_NOT_REFUNDABLE' : 'RETRY_LIMIT_EXCEEDED';
      else record.refundedAt = orderedAt;
    }
    if (status === 'FAILED')
      record.failReason =
        id === 46 ? 'STOCK_CONFIRM_FAILED_REFUND_NEEDED' : 'PAYMENT_FAILED';
    records.set(id, record);
  }
  records.set(1, {
    ...records.get(1),
    orderNo: 'PO-20200101-0001',
    orderedAt: '2020-01-01T01:00:00Z',
  });
  return records;
}
export async function startAdminOrdersFixture() {
  const records = makeAdminOrders(),
    calls = [];
  const controls = {};
  const reset = (scenario = 'normal') => {
    Object.assign(controls, {
      listStatus: 200,
      detailStatus: 200,
      empty: false,
      listDelay: 0,
      detailDelay: 0,
      detailCode: '',
      invalid: false,
    });
    if (scenario === 'empty') controls.empty = true;
    if (scenario === 'list-error') controls.listStatus = 503;
    if (scenario === 'detail-error') controls.detailStatus = 503;
    if (scenario === 'missing') {
      controls.detailStatus = 404;
      controls.detailCode = 'ORDER_NOT_FOUND';
    }
    if (scenario === 'forbidden') controls.listStatus = 403;
    if (scenario === 'unauthorized') controls.listStatus = 401;
    if (scenario === 'disabled') controls.listStatus = 404;
    if (scenario === 'delayed') {
      controls.listDelay = 1500;
      controls.detailDelay = 1500;
    }
  };
  reset();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const send = (status, data = null, errorCode) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        status === 204
          ? undefined
          : JSON.stringify({
              success: status < 300,
              data,
              message: 'Synthetic Order HTTP fixture',
              ...(errorCode ? { errorCode } : {}),
            }),
      );
    };
    if (url.pathname === '/__admin-orders/scenario' && req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!Object.hasOwn(adminScenarios, name)) send(400);
      else {
        reset(name);
        send(204);
      }
      return;
    }
    if (
      !url.pathname.startsWith('/api/v1/admin/orders') ||
      req.method !== 'GET'
    ) {
      send(404, null, 'NOT_FOUND');
      return;
    }
    calls.push({
      path: req.url,
      method: req.method,
      hasUserId: 'x-user-id' in req.headers,
      hasUserRole: 'x-user-role' in req.headers,
      hasBearer: !!req.headers.authorization,
    });
    if (url.pathname === '/api/v1/admin/orders') {
      const status = controls.listStatus;
      const page = Number(url.searchParams.get('page') ?? 0),
        size = Number(url.searchParams.get('size') ?? 20);
      const orderNo = url.searchParams.get('orderNo'),
        filter = url.searchParams.get('status');
      const from = url.searchParams.get('from'),
        to = url.searchParams.get('to');
      if (
        !Number.isInteger(page) ||
        page < 0 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 100 ||
        (filter && !statuses.includes(filter)) ||
        [from, to].some(
          (value) =>
            value !== null &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
              !Number.isFinite(Date.parse(value))),
        ) ||
        (from &&
          to &&
          (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 30))
      ) {
        send(400, null, 'INVALID_REQUEST');
        return;
      }
      const kstDay = (time) =>
        new Date(Date.parse(time) + 9 * 3600000).toISOString().slice(0, 10);
      const today = kstDay(new Date().toISOString());
      const end =
        to ||
        (from
          ? new Date(Date.parse(`${from}T00:00:00Z`) + 30 * 86400000)
              .toISOString()
              .slice(0, 10)
          : today);
      const start =
        from ||
        new Date(Date.parse(`${end}T00:00:00Z`) - 30 * 86400000)
          .toISOString()
          .slice(0, 10);
      let all = controls.empty
        ? []
        : [...records.values()].filter(
            (order) =>
              (!orderNo || order.orderNo === orderNo) &&
              (!filter || order.status === filter) &&
              (url.searchParams.get('manualReviewRequired') !== 'true' ||
                order.manualReviewRequired) &&
              ((orderNo && !from && !to) ||
                (kstDay(order.orderedAt) >= start &&
                  kstDay(order.orderedAt) <= end)),
          );
      all.sort(
        (a, b) =>
          Date.parse(b.orderedAt) - Date.parse(a.orderedAt) ||
          b.orderId - a.orderId,
      );
      const data = {
        page,
        size,
        totalElements: all.length,
        items: all.slice(page * size, (page + 1) * size).map((order) => {
          const summary = {
            ...order,
            itemCount: order.items.length,
            representativeMenuName: order.items[0].menuName,
          };
          for (const key of [
            'items',
            'paidAt',
            'completedAt',
            'paymentId',
            'failReason',
            'cancelReason',
            'cancelRequestedAt',
            'stockRestoredAt',
            'refundedAt',
            'manualReviewReason',
            'cancelFollowUpAttempts',
          ])
            delete summary[key];
          return summary;
        }),
      };
      if (controls.listDelay)
        await new Promise((done) => setTimeout(done, controls.listDelay));
      send(
        status,
        status === 200 ? data : null,
        status === 404
          ? 'NOT_FOUND'
          : status === 403
            ? 'FORBIDDEN'
            : status === 401
              ? 'UNAUTHORIZED'
              : status === 200
                ? undefined
                : 'INTERNAL_ERROR',
      );
    } else {
      const id = Number(url.pathname.split('/').at(-1));
      const status = controls.detailStatus,
        code = controls.detailCode;
      const data = structuredClone(records.get(id));
      if (controls.detailDelay)
        await new Promise((done) => setTimeout(done, controls.detailDelay));
      if (!data) send(404, null, 'ORDER_NOT_FOUND');
      else
        send(
          status,
          status === 200 ? data : null,
          code || (status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR'),
        );
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    records,
    calls,
    controls,
    reset,
    close: () => new Promise((done) => server.close(done)),
  };
}
