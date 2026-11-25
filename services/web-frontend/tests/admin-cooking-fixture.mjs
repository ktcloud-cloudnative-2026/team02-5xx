import { createServer } from 'node:http';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';
import { COOKING_ENDPOINTS } from '../src/admin-cooking/cookingApi.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const cookingScenarios = [
  ['normal', '정상 · 혼잡 · FIFO 8건'],
  ['empty', '대기·조리·오늘 집계 모두 0건'],
  ['multiple', '조리 중 여러 건 · 대표 번호 1개'],
  ['omitted', '조리 중이지만 주문번호 생략'],
  ['mismatch', '영역별 조회값 불일치'],
  ['congestion-error', '혼잡도 503 · 관리자 현황 정상'],
  ['overview-error', '조리 현황 503 · 대기열 정상'],
  ['queue-error', '대기열 503 · 현황 정상'],
  ['401', '관리자 인증 401'],
  ['403', '관리자 권한 403'],
  ['404', '관리자 API 비활성 404'],
  ['network', '대기열 응답 중 네트워크 끊김'],
  ['malformed', '대기열 DTO 오류'],
  ['slow', '전체 조회 지연'],
  ['timeout', '대기열 10초 시간 초과'],
].map(([id, label]) => ({ id, label }));
export function cookingSample(scenario = 'normal') {
  const empty = scenario === 'empty';
  return {
    congestion: {
      level: empty ? 'NORMAL' : 'CROWDED',
      waitingCount: empty ? 0 : 8,
      cookingCount: empty ? 0 : scenario === 'multiple' ? 3 : 1,
      expectedWaitSec: empty ? 0 : 1800,
    },
    overview: {
      waitingCount: empty ? 0 : scenario === 'mismatch' ? 6 : 8,
      cookingCount: empty ? 0 : scenario === 'multiple' ? 3 : 1,
      completedToday: empty ? 0 : 42,
      canceledToday: empty ? 0 : 2,
      expectedWaitSec: empty ? 0 : 1800,
      ...(!empty && scenario !== 'omitted'
        ? { cookingOrderNo: 'P-20261124-0042' }
        : {}),
    },
    queue: {
      count: empty ? 0 : 8,
      items: empty
        ? []
        : [205, 201, 210, 211, 212, 213, 214, 215].map((orderId, index) => ({
            position: index + 1,
            orderId,
            orderNo: `P-20261124-00${50 + index}`,
            queuedAt:
              index < 2
                ? '2026-11-24T03:01:00Z'
                : `2026-11-24T12:${String(index + 1).padStart(2, '0')}:00+09:00`,
            estimatedCookSec: 90 + index * 30,
          })),
    },
  };
}
let memoryFiles;
async function prepare() {
  memoryFiles ??= build({
    root: resolve(root, 'preview/admin-cooking'),
    configFile: false,
    plugins: [react()],
    logLevel: 'error',
    build: { write: false, emptyOutDir: false },
  }).then(
    (bundle) =>
      new Map(
        bundle.output.map((asset) => [
          `/${asset.fileName}`,
          Buffer.from(asset.type === 'chunk' ? asset.code : asset.source),
        ]),
      ),
  );
  return memoryFiles;
}
export async function startCookingFixture({ port = 0 } = {}) {
  const files = await prepare();
  const controls = {
    scenario: 'normal',
    data: cookingSample(),
    requests: [],
    overrides: new Map(),
  };
  const reset = (scenario = 'normal') => {
    if (!cookingScenarios.some((entry) => entry.id === scenario))
      throw new Error('Unknown fixture scenario');
    controls.scenario = scenario;
    controls.data = cookingSample(scenario);
    controls.requests = [];
    controls.overrides.clear();
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => {
      if (!res.destroyed)
        res
          .writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          .end(JSON.stringify(body));
    };
    if (url.pathname === '/__cooking/config' && req.method === 'GET') {
      json(200, { current: controls.scenario, scenarios: cookingScenarios });
      return;
    }
    if (url.pathname === '/__cooking/scenario' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2048) {
          json(413, { success: false, message: 'Too large' });
          return;
        }
      }
      try {
        reset(JSON.parse(raw).scenario);
        json(200, { success: true, data: null, message: 'OK' });
      } catch {
        json(400, { success: false, message: 'Invalid scenario' });
      }
      return;
    }
    const area = Object.keys(COOKING_ENDPOINTS).find(
      (key) => COOKING_ENDPOINTS[key] === url.pathname + url.search,
    );
    if (area) {
      const scenario = controls.scenario,
        override = controls.overrides.get(area) ?? {};
      controls.requests.push({
        area,
        method: req.method,
        headers: req.headers,
        path: req.url,
      });
      if (req.method !== 'GET') {
        json(405, { success: false, message: 'Read only' });
        return;
      }
      const data = structuredClone(override.data ?? controls.data[area]);
      const delay =
        override.delay ??
        (scenario === 'slow'
          ? 1300
          : scenario === 'timeout' && area === 'queue'
            ? 11000
            : 0);
      if (delay) await new Promise((done) => setTimeout(done, delay));
      const status =
        override.status ??
        (['401', '403', '404'].includes(scenario) && area !== 'congestion'
          ? +scenario
          : scenario === `${area}-error`
            ? 503
            : 200);
      if (status !== 200) {
        json(status, {
          success: false,
          message: 'Synthetic fixture error',
          errorCode: 'FIXTURE_ERROR',
        });
        return;
      }
      if (scenario === 'network' && area === 'queue') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.flushHeaders();
        res.write('{"success":');
        setTimeout(() => res.destroy(), 20);
        return;
      }
      if (override.raw != null) {
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(override.raw);
        return;
      }
      if (scenario === 'malformed' && area === 'queue') data.count = 99;
      json(200, { success: true, data, message: 'OK' });
      return;
    }
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/__cooking/')
    ) {
      json(404, { success: false, message: 'Unknown path' });
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!files.has(pathname) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
          }[extname(pathname)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(req.method === 'HEAD' ? undefined : files.get(pathname));
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    controls,
    reset,
    files,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
