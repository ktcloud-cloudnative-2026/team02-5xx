// Contract Mock only. Never imported by product entries; no real accounts/tokens.
// Cookie attributes below are loopback test settings, not deployment policy.
import { resolve } from 'node:path';
import { startUiFixture } from './ui-fixture.mjs';
import {
  nicknameError,
  passwordError,
} from '../src/account/accountValidation.js';

export async function startAuthFixture({
  input = resolve('tests/auth-browser-entry.jsx'),
  handleRequest,
  previewControls,
} = {}) {
  const counts = { login: 0, me: 0, refresh: 0, logout: 0 };
  const controls = { loginStatus: 200, logoutStatus: 204, delay: 0 };
  const tokens = new Map();
  const cookies = new Map();
  const passwords = new Map();
  let serial = 0;
  let lastRememberMe = null;
  const customer = { id: 1, email: 'customer@example.test', role: 'CUSTOMER' };
  const otherCustomer = {
    id: 3,
    email: 'other@example.test',
    role: 'CUSTOMER',
  };
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
    input,
    testControls: false,
    previewControls,
    async handleRequest(request, response) {
      const endpoint = request.url?.split('?')[0].replace('/api/v1/auth/', '');
      if (!Object.hasOwn(counts, endpoint) && endpoint !== 'me/password')
        return handleRequest
          ? handleRequest(
              request,
              response,
              tokens.get(
                request.headers.authorization?.replace(/^Bearer /, ''),
              ),
            )
          : false;
      if (Object.hasOwn(counts, endpoint)) counts[endpoint]++;
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
        else if (typeof body.rememberMe !== 'boolean') send(response, 401);
        else {
          const who = [customer, otherCustomer, admin].find(
            (user) => user.email === body.email,
          );
          if (
            who &&
            body.password === (passwords.get(who.id) ?? 'fixture-only-password')
          )
            issue(response, who);
          else send(response, 401);
        }
      } else if (endpoint === 'me' || endpoint === 'me/password') {
        const user = tokens.get(
          request.headers.authorization?.replace(/^Bearer /, ''),
        );
        if (request.method === 'PATCH') {
          let raw = '';
          for await (const chunk of request) raw += chunk;
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            send(response, 400);
            return true;
          }
          if (!user) send(response, 401);
          else if (user.role !== 'CUSTOMER') send(response, 403);
          else if (endpoint === 'me/password') {
            if (
              body.currentPassword !==
              (passwords.get(user.id) ?? 'fixture-only-password')
            )
              send(response, 400);
            else if (
              passwordError(
                body.currentPassword,
                body.newPassword ?? '',
                body.newPassword,
              )
            )
              send(response, 400);
            else {
              passwords.set(user.id, body.newPassword);
              for (const [key, owner] of cookies)
                if (owner.id === user.id) cookies.delete(key);
              response.setHeader(
                'Set-Cookie',
                'fixtureRefresh=; HttpOnly; Path=/api/v1/auth; Max-Age=0; SameSite=Lax',
              );
              send(response, 204);
            }
          } else if (
            typeof body.nickname !== 'string' ||
            nicknameError(body.nickname)
          )
            send(response, 400);
          else {
            user.nickname = body.nickname;
            send(response, 200, { ...user, nickname: user.nickname });
          }
          return true;
        }
        if (request.method !== 'GET' || endpoint !== 'me') {
          send(response, 405);
          return true;
        }
        send(
          response,
          user ? 200 : 401,
          user ? { ...user, nickname: user.nickname ?? null } : undefined,
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
