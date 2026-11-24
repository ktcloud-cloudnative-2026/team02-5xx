// Loopback-only test server. No identity headers or real service configuration.
import { createServer } from 'node:http';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { startAdminPreview } from '../scripts/admin-preview.mjs';
import { DASHBOARD_PATHS } from '../src/admin-dashboard/dashboardApi.js';

export const dashboardScenarios = Object.freeze([
  { id: 'normal', label: '정상 · 혼잡 · 재고 부족/품절/미연결' },
  { id: 'empty', label: '영업 종료 · 대기열/재고 알림 없음' },
  { id: 'partial', label: '혼잡도 503 · 다른 영역 정상' },
  ...[401, 403, 404, 503].map((status) => ({
    id: `status-${status}`,
    label: `운영 API ${status} · 다른 영역 정상`,
  })),
  { id: 'queue-error', label: '대기열 503 · 재시도' },
  { id: 'menu-error', label: '메뉴 이름 조회 실패 · 수량 유지' },
  { id: 'stock-error', label: '재고 503 · 다른 영역 정상' },
  { id: 'write-rejected', label: '상태 변경 400 · 기존 표시 유지' },
  { id: 'write-unknown', label: '변경 적용 후 503 · 상태 재확인 필요' },
  { id: 'write-network', label: '변경 적용 후 연결 끊김 · 재확인 필요' },
  { id: 'write-delay', label: '상태 변경 지연 · 중복 제출 차단' },
  { id: 'slow', label: '전체 조회 지연' },
]);
export const dashboardSample = (empty = false) => ({
  operations: {
    isOpen: !empty,
    acceptingOrders: !empty,
    updatedAt: '2026-11-24T12:00:00+09:00',
  },
  congestion: {
    level: empty ? 'NORMAL' : 'CROWDED',
    waitingCount: empty ? 0 : 3,
    cookingCount: empty ? 0 : 1,
    expectedWaitSec: empty ? 0 : 420,
  },
  overview: {
    waitingCount: empty ? 0 : 3,
    cookingCount: empty ? 0 : 1,
    completedToday: empty ? 0 : 42,
    canceledToday: empty ? 0 : 2,
    expectedWaitSec: empty ? 0 : 420,
    ...(!empty ? { cookingOrderNo: 'P-20261124-0100' } : {}),
  },
  queue: {
    count: empty ? 0 : 3,
    items: empty
      ? []
      : [301, 299, 305].map((orderId, index) => ({
          position: index + 1,
          orderId,
          orderNo: `P-20261124-010${index + 1}`,
          queuedAt:
            index < 2
              ? '2026-11-24T12:01:00+09:00'
              : '2026-11-24T12:03:00+09:00',
          estimatedCookSec: 180 + index * 60,
        })),
  },
  stock: empty
    ? []
    : [
        {
          stockItemId: 1,
          menuId: 1,
          stockQty: 8,
          reservedQty: 6,
          availableQty: 2,
          lowStockThreshold: 5,
          lowStock: true,
        },
        {
          stockItemId: 2,
          menuId: 2,
          stockQty: 4,
          reservedQty: 4,
          availableQty: 0,
          lowStockThreshold: 3,
          lowStock: true,
        },
        {
          stockItemId: 3,
          menuId: null,
          stockQty: 0,
          reservedQty: 0,
          availableQty: 0,
          lowStockThreshold: 2,
          lowStock: true,
        },
        {
          stockItemId: 4,
          menuId: 999,
          stockQty: 2,
          reservedQty: 1,
          availableQty: 1,
          lowStockThreshold: 2,
          lowStock: true,
        },
      ],
  menus: {
    categories: [{ id: 1, name: '식사' }],
    menus: [
      {
        id: 1,
        categoryId: 1,
        name: '트러플 버섯 덮밥',
        imageUrl: null,
        basePrice: 11000,
        status: 'ON_SALE',
      },
      {
        id: 2,
        categoryId: 1,
        name: '직화 제육 덮밥',
        imageUrl: null,
        basePrice: 10000,
        status: 'PAUSED',
      },
    ],
  },
});
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let artifacts;
async function files() {
  artifacts ??= build({
    root: resolve(project, 'preview/admin-dashboard'),
    configFile: false,
    plugins: [react()],
    logLevel: 'error',
    build: { write: false, emptyOutDir: false, assetsInlineLimit: 0 },
  }).then(
    (result) =>
      new Map(
        (Array.isArray(result)
          ? result.flatMap((item) => item.output)
          : result.output
        ).map((item) => [
          `/${item.fileName}`,
          Buffer.from(item.type === 'chunk' ? item.code : item.source),
        ]),
      ),
  );
  return artifacts;
}
export async function startDashboardFixture({
  port = 0,
  menuPreview = false,
} = {}) {
  const staticFiles = await files();
  const menu = menuPreview ? await startAdminPreview() : null;
  const controls = {
    scenario: 'normal',
    data: dashboardSample(),
    requests: [],
    overrides: new Map(),
    delays: new Map(),
    writeCount: 0,
    readCount: {},
  };
  const reset = (scenario = 'normal') => {
    if (!dashboardScenarios.some((item) => item.id === scenario))
      throw new Error('Unknown scenario');
    controls.scenario = scenario;
    controls.data = dashboardSample(scenario === 'empty');
    controls.requests = [];
    controls.writeCount = 0;
    controls.readCount = {};
    controls.overrides.clear();
    controls.delays.clear();
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const send = (status, body) => {
      if (!response.destroyed)
        response
          .writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          .end(JSON.stringify(body));
    };
    const ok = (data) => send(200, { success: true, data, message: 'OK' });
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 4096) {
        send(413, { success: false, message: 'Too large' });
        return;
      }
    }
    let body;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      send(400, { success: false, message: 'Invalid JSON' });
      return;
    }
    if (url.pathname === '/__dashboard/config' && request.method === 'GET') {
      okConfig();
      return;
    }
    function okConfig() {
      send(200, {
        scenarios: dashboardScenarios,
        scenario: controls.scenario,
        menuOrigin: menu?.origin,
      });
    }
    if (url.pathname === '/__dashboard/scenario' && request.method === 'POST') {
      try {
        reset(body?.scenario);
        ok(null);
      } catch {
        send(400, { success: false, message: 'Unknown scenario' });
      }
      return;
    }
    const resource =
      url.pathname === '/api/v1/menus'
        ? 'menus'
        : Object.entries(DASHBOARD_PATHS).find(
            ([, path]) => path === url.pathname + url.search,
          )?.[0];
    if (resource) {
      const scenario = controls.scenario;
      const write = request.method === 'PATCH';
      const captured = structuredClone(controls.data[resource]);
      controls.requests.push({
        resource,
        method: request.method,
        body,
        headers: request.headers,
      });
      if (write) controls.writeCount++;
      else
        controls.readCount[resource] = (controls.readCount[resource] ?? 0) + 1;
      if (!(request.method === 'GET' || (resource === 'operations' && write))) {
        send(405, { success: false, message: 'Method not allowed' });
        return;
      }
      if (
        write &&
        (!body ||
          Object.keys(body).length !== 1 ||
          !Object.entries(body).every(
            ([key, value]) =>
              ['isOpen', 'acceptingOrders'].includes(key) &&
              typeof value === 'boolean',
          ))
      ) {
        send(400, {
          success: false,
          message: 'Invalid state',
          errorCode: 'INVALID_REQUEST',
        });
        return;
      }
      const delay =
        controls.delays.get(resource) ??
        (scenario === 'slow'
          ? 1400
          : scenario === 'write-delay' && write
            ? 1400
            : 0);
      if (delay) await new Promise((done) => setTimeout(done, delay));
      let status =
        controls.overrides.get(resource) ??
        ((scenario === 'partial' && resource === 'congestion') ||
        (scenario === 'queue-error' && resource === 'queue') ||
        (scenario === 'menu-error' && resource === 'menus') ||
        (scenario === 'stock-error' && resource === 'stock')
          ? 503
          : scenario.startsWith('status-') && resource === 'operations'
            ? Number(scenario.slice(7))
            : 200);
      if (write && scenario === 'write-rejected') status = 400;
      if (write && ['write-unknown', 'write-network'].includes(scenario)) {
        Object.assign(controls.data.operations, body);
        if (scenario === 'write-network') {
          // Interrupt a response already begun; a bare empty response may be retried by Chromium's transport.
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          response.flushHeaders();
          response.write('{"success":');
          setTimeout(() => response.destroy(), 20);
          return;
        }
        status = 503;
      }
      if (status !== 200) {
        send(status, {
          success: false,
          message: 'Synthetic fixture error',
          errorCode: status === 400 ? 'INVALID_REQUEST' : 'FIXTURE_ERROR',
        });
        return;
      }
      if (write) {
        Object.assign(controls.data.operations, body, {
          updatedAt: '2026-11-24T12:10:00+09:00',
        });
        ok(controls.data.operations);
      } else ok(captured);
      return;
    }
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/__dashboard/')
    ) {
      send(404, { success: false, message: 'Unknown fixture path' });
      return;
    }
    const file = staticFiles.get(
      url.pathname === '/' ? '/index.html' : url.pathname,
    );
    if (!file || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
          }[extname(url.pathname === '/' ? '/index.html' : url.pathname)] ??
          'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(request.method === 'HEAD' ? undefined : file);
  });
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', done);
    });
  } catch (error) {
    await menu?.close();
    throw error;
  }
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    controls,
    reset,
    files: staticFiles,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await menu?.close();
    },
  };
}
