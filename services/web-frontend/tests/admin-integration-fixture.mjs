// Loopback-only HTTP contract fixture. Never imported by product sources.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startUiFixture } from './ui-fixture.mjs';
import { startDashboardFixture } from './admin-dashboard-fixture.mjs';
import { startInventoryFixture } from './admin-inventory-fixture.mjs';
import { startAdminOrdersFixture } from './admin-orders-fixture.mjs';
import { createMockAdminMenuAdapter } from '../src/data/admin/mockAdminMenuAdapter.js';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';

export const integrationScenarios = [
  ['entry', '공통 홈 · 로그인 폼으로 고객/관리자 검수'],
  ['normal', '정상 관리자'],
  ['anonymous', '비회원'],
  ['customer', 'CUSTOMER'],
  ['expired', '인증 만료 (다음 조회)'],
  ['refresh', 'GET 401 후 재발급'],
  ['forbidden', 'API 403'],
  ['not-found', 'API 404'],
  ['outage', 'API 503'],
  ['empty', '빈 데이터'],
  ['slow', '조회 지연'],
  ['write-unknown', '변경 결과 불명'],
  ['unknown-role', '지원하지 않는 Auth 역할 응답'],
];

export async function startAdminIntegrationFixture({
  port = 0,
  initialScenario = 'normal',
} = {}) {
  const dashboard = await startDashboardFixture();
  const inventory = await startInventoryFixture();
  const orders = await startAdminOrdersFixture();
  const customerHttp = await startCustomerHttpFixture();
  // Reuse the existing customer HTTP contract server, including its owner checks.
  // Its private synthetic tokens never reach the browser or product code.
  const customerTokens = new Map();
  for (const [id, email] of [
    [1, 'customer@example.test'],
    [3, 'other@example.test'],
  ]) {
    const response = await fetch(`${customerHttp.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'fixture-only-password',
        rememberMe: false,
      }),
    });
    const envelope = await response.json();
    customerTokens.set(id, envelope.data.accessToken);
  }
  const admin = {
    id: 2,
    email: 'admin@example.test',
    nickname: '검수 관리자',
    role: 'STORE_ADMIN',
  };
  const customer = {
    id: 1,
    email: 'customer@example.test',
    nickname: '검수 고객',
    role: 'CUSTOMER',
  };
  const otherCustomer = {
    ...customer,
    id: 3,
    email: 'other@example.test',
    nickname: '다른 검수 고객',
  };
  const controls = { restoreDelay: 0, apiDelay: 0 };
  const tokens = new Map(),
    cookies = new Map(),
    requests = [];
  // Browser cookies share a host across ports. Keep other preview sessions intact.
  const cookieName = `adminIntegration_${randomUUID().replaceAll('-', '')}`;
  let serial = 0,
    scenario = 'normal',
    menu;
  function reset(next = 'normal') {
    if (!integrationScenarios.some(([id]) => id === next))
      throw new Error('Unknown scenario');
    scenario = next;
    tokens.clear();
    cookies.clear();
    requests.length = 0;
    menu = createMockAdminMenuAdapter({
      latency: 0,
      ...(next === 'empty' ? { initialMenus: [] } : {}),
    });
    dashboard.reset(next === 'empty' ? 'empty' : 'normal');
    inventory.reset(next === 'empty' ? 'empty' : 'normal');
    orders.reset(next === 'empty' ? 'empty' : 'normal');
  }
  reset(initialScenario);
  function send(res, status, data, code = 'FIXTURE_ERROR') {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(
      status === 204
        ? undefined
        : JSON.stringify({
            success: status < 400,
            data: data ?? null,
            message: status < 400 ? 'OK' : '검수용 오류',
            ...(status >= 400 ? { errorCode: code } : {}),
          }),
    );
    return true;
  }
  async function body(req) {
    let input = '';
    for await (const chunk of req) input += chunk;
    return JSON.parse(input || '{}');
  }
  function issue(res, user) {
    const accessToken = `admin-integration-access-${++serial}`,
      cookie = `admin-integration-refresh-${serial}`;
    tokens.set(accessToken, user);
    cookies.set(cookie, user);
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${cookie}; HttpOnly; SameSite=Lax; Path=/api/v1/auth`,
    );
    return send(res, 200, {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user,
    });
  }
  const fixture = await startUiFixture({
    port,
    input: 'tests/admin-integration-entry.jsx',
    testControls: false,
    async handleRequest(req, res) {
      const url = new URL(req.url, 'http://127.0.0.1'),
        path = url.pathname;
      if (path === '/images/brand/peakorder-logo-a.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(await readFile('public/images/brand/peakorder-logo-a.png'));
        return true;
      }
      if (path === '/__admin-integration') {
        if (req.method === 'POST') {
          const input = await body(req);
          reset(input.scenario);
          res.setHeader(
            'Set-Cookie',
            `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=0`,
          );
        }
        return send(res, 200, { scenario, scenarios: integrationScenarios });
      }
      const user = tokens.get(
        req.headers.authorization?.replace(/^Bearer /, ''),
      );
      if (path.startsWith('/api/v1/auth/')) {
        requests.push({ path, method: req.method });
        const cookie = req.headers.cookie
          ?.split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        if (path.endsWith('/login')) {
          const input = await body(req);
          if (
            input.password !== 'fixture-only-password' ||
            ![admin.email, customer.email, otherCustomer.email].includes(
              input.email,
            )
          )
            return send(res, 401);
          return issue(
            res,
            input.email === admin.email
              ? admin
              : input.email === otherCustomer.email
                ? otherCustomer
                : customer,
          );
        }
        if (path.endsWith('/refresh')) {
          // Preview starts with a synthetic refresh cookie, while product uses its real session.
          if (scenario === 'slow' || controls.restoreDelay)
            await new Promise((resolve) =>
              setTimeout(resolve, controls.restoreDelay || 1200),
            );
          const owner = cookies.get(cookie);
          if (
            (['anonymous', 'entry'].includes(scenario) && !owner) ||
            (cookie && !owner)
          )
            return send(res, 401);
          if (scenario === 'expired' && cookie) return send(res, 401);
          if (owner) cookies.delete(cookie);
          return issue(
            res,
            owner ??
              (scenario === 'customer'
                ? customer
                : scenario === 'unknown-role'
                  ? { ...admin, role: 'UNSUPPORTED' }
                  : admin),
          );
        }
        if (path.endsWith('/me')) return send(res, user ? 200 : 401, user);
        if (path.endsWith('/logout')) {
          tokens.clear();
          cookies.clear();
          scenario = 'anonymous';
          res.setHeader(
            'Set-Cookie',
            `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=0`,
          );
          return send(res, 204);
        }
        return send(res, 404);
      }
      if (!path.startsWith('/api/v1/')) return false;
      const protectedApi = path.startsWith('/api/v1/admin/');
      const customerApi =
        path.startsWith('/api/v1/orders') ||
        path.startsWith('/api/v1/payments');
      requests.push({ path: req.url, method: req.method, user: user?.id });
      if (protectedApi && !user) return send(res, 401);
      if (protectedApi && user.role !== 'STORE_ADMIN') return send(res, 403);
      if (customerApi && !user) return send(res, 401);
      if (customerApi && user.role !== 'CUSTOMER') return send(res, 403);
      if ((protectedApi || customerApi) && scenario === 'expired') {
        tokens.clear();
        return send(res, 401);
      }
      if ((protectedApi || customerApi) && scenario === 'refresh') {
        tokens.clear();
        scenario = 'normal';
        return send(res, 401);
      }
      if (scenario === 'slow' || controls.apiDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, controls.apiDelay || 1200),
        );
      if (
        protectedApi &&
        ['forbidden', 'not-found', 'outage'].includes(scenario)
      )
        return send(
          res,
          { forbidden: 403, 'not-found': 404, outage: 503 }[scenario],
        );
      const write = !['GET', 'HEAD'].includes(req.method);
      if (protectedApi && write && scenario === 'write-unknown')
        return send(res, 503);
      if (path.startsWith('/api/v1/admin/menus')) {
        try {
          const match = /^\/api\/v1\/admin\/menus(?:\/(\d+))?(\/status)?$/.exec(
            path,
          );
          if (!match) return send(res, 404);
          const id = Number(match[1]);
          let result;
          if (req.method === 'GET')
            result = id
              ? await menu.detail(id)
              : await menu.list({
                  ...Object.fromEntries(url.searchParams),
                  categoryId: url.searchParams.has('categoryId')
                    ? Number(url.searchParams.get('categoryId'))
                    : null,
                  status: url.searchParams.get('status'),
                });
          else if (req.method === 'POST' && !id)
            result = await menu.create(await body(req));
          else if (req.method === 'PATCH' && id)
            result = match[2]
              ? await menu.changeStatus(id, (await body(req)).status)
              : await menu.update(id, await body(req));
          else return send(res, 405);
          return send(res, req.method === 'POST' ? 201 : 200, result.data);
        } catch (error) {
          return send(
            res,
            error.code === 'MENU_NOT_FOUND' ? 404 : 400,
            null,
            error.code,
          );
        }
      }
      const target =
        customerApi ||
        path.startsWith('/api/v1/store/') ||
        path === '/api/v1/cooking/estimates'
          ? customerHttp.url
          : path.startsWith('/api/v1/admin/orders')
            ? orders.url
            : path.startsWith('/api/v1/admin/inventory') ||
                path.startsWith('/api/v1/menus')
              ? inventory.url
              : dashboard.origin;
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: {
          ...(customerApi && user
            ? { Authorization: `Bearer ${customerTokens.get(user.id)}` }
            : {}),
          ...(write ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(write
          ? {
              body: JSON.stringify(await body(req)),
            }
          : {}),
      });
      res.writeHead(response.status, {
        'Content-Type':
          response.headers.get('content-type') ?? 'application/json',
      });
      res.end(Buffer.from(await response.arrayBuffer()));
      return true;
    },
  });
  return {
    ...fixture,
    reset,
    requests,
    controls,
    expire({ recover = true } = {}) {
      tokens.clear();
      if (!recover) cookies.clear();
    },
    close: async () => {
      await fixture.close();
      await Promise.all([
        dashboard.close(),
        inventory.close(),
        orders.close(),
        customerHttp.close(),
      ]);
    },
  };
}
