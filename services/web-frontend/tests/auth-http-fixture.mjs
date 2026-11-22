// Contract Mock only. Never imported by product entries; no real accounts/tokens.
// Cookie attributes below are loopback test settings, not deployment policy.
import { resolve } from 'node:path';
import { startUiFixture } from './ui-fixture.mjs';

export async function startAuthFixture() {
  const counts = { login: 0, me: 0, refresh: 0, logout: 0 };
  const controls = { loginStatus: 200, logoutStatus: 204, delay: 0 };
  const tokens = new Map();
  const cookies = new Map();
  let serial = 0;
  let lastRememberMe = null;
  const customer = { id: 1, email: 'customer@example.test', role: 'CUSTOMER' };
  const admin = { id: 2, email: 'admin@example.test', role: 'STORE_ADMIN' };
  const send = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      status === 204
        ? undefined
        : JSON.stringify({
            success: status === 200,
            data: data ?? null,
            message: status === 200 ? '테스트 응답' : '테스트 오류',
            ...(status === 200 ? {} : { errorCode: 'MOCK_AUTH_ERROR' }),
          }),
    );
  };
  const issue = (response, user) => {
    const accessToken = `fixture-access-${++serial}`;
    const cookie = `fixture-refresh-${serial}`;
    tokens.set(accessToken, user);
    cookies.set(cookie, user);
    response.setHeader(
      'Set-Cookie',
      `fixtureRefresh=${cookie}; HttpOnly; Path=/api/v1/auth; SameSite=Lax`,
    );
    send(response, 200, {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user,
    });
  };
  const fixture = await startUiFixture({
    input: resolve('tests/auth-browser-entry.jsx'),
    testControls: false,
    async handleRequest(request, response) {
      const endpoint = request.url?.split('?')[0].replace('/api/v1/auth/', '');
      if (!Object.hasOwn(counts, endpoint)) return false;
      counts[endpoint]++;
      if (endpoint === 'login') {
        let text = '';
        for await (const chunk of request) text += chunk;
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          send(response, 400);
          return true;
        }
        lastRememberMe = body.rememberMe;
        if (controls.delay)
          await new Promise((done) => setTimeout(done, controls.delay));
        if (controls.loginStatus !== 200) send(response, controls.loginStatus);
        else if (
          body.password !== 'fixture-only-password' ||
          typeof body.rememberMe !== 'boolean'
        )
          send(response, 401);
        else if (body.email === customer.email) issue(response, customer);
        else if (body.email === admin.email) issue(response, admin);
        else send(response, 401);
      } else if (endpoint === 'me') {
        const user = tokens.get(
          request.headers.authorization?.replace(/^Bearer /, ''),
        );
        send(
          response,
          user ? 200 : 401,
          user ? { ...user, nickname: null } : undefined,
        );
      } else if (endpoint === 'refresh') {
        const cookie = request.headers.cookie?.match(
          /(?:^|;\s*)fixtureRefresh=([^;]+)/,
        )?.[1];
        const user = cookies.get(cookie);
        if (user) {
          cookies.delete(cookie);
          issue(response, user);
        } else send(response, 401);
      } else {
        if (controls.logoutStatus === 204) {
          const cookie = request.headers.cookie?.match(
            /(?:^|;\s*)fixtureRefresh=([^;]+)/,
          )?.[1];
          cookies.delete(cookie);
          response.setHeader(
            'Set-Cookie',
            'fixtureRefresh=; HttpOnly; Path=/api/v1/auth; Max-Age=0; SameSite=Lax',
          );
        }
        send(response, controls.logoutStatus);
      }
      return true;
    },
  });
  return {
    ...fixture,
    counts,
    controls,
    getLastRememberMe: () => lastRememberMe,
  };
}
