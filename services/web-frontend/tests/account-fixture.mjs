// Loopback HTTP contract fixture. Synthetic identities only; never a product import.
import { resolve } from 'node:path';
import { startUiFixture } from './ui-fixture.mjs';
import {
  nicknameError,
  passwordError,
} from '../src/account/accountValidation.js';
export async function startAccountFixture() {
  const customer = {
    id: 1,
    email: 'customer@example.test',
    nickname: null,
    role: 'CUSTOMER',
  };
  const admin = {
    id: 2,
    email: 'admin@example.test',
    nickname: null,
    role: 'STORE_ADMIN',
  };
  const tokens = new Map(),
    cookies = new Map(),
    requests = [];
  const controls = { status: 200, delay: 0, meStatus: 200 };
  let password = 'fixture-only-password',
    serial = 0;
  const fixture = await startUiFixture({
    input: resolve('src/main.jsx'),
    testControls: false,
    async handleRequest(req, res) {
      const path = req.url.split('?')[0];
      if (path === '/api/v1/orders' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: { page: 0, size: 20, totalElements: 0, items: [] },
          }),
        );
        return true;
      }
      if (!path.startsWith('/api/v1/auth/')) return false;
      requests.push({ path, method: req.method }); // Never record passwords or tokens.
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const user = tokens.get(
        req.headers.authorization?.replace(/^Bearer /, ''),
      );
      const send = (status, data = null, errorCode) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          status === 204
            ? undefined
            : JSON.stringify({
                success: status === 200,
                data,
                message: 'Contract fixture',
                ...(errorCode ? { errorCode } : {}),
              }),
        );
      };
      const issue = (who) => {
        const accessToken = `synthetic-access-${++serial}`,
          cookie = `synthetic-refresh-${serial}`;
        tokens.set(accessToken, who);
        cookies.set(cookie, who);
        res.setHeader(
          'Set-Cookie',
          `accountFixture=${cookie}; HttpOnly; Path=/api/v1/auth; SameSite=Lax`,
        );
        send(200, {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: 900,
          user: who,
        });
      };
      const cookie = req.headers.cookie?.match(
        /(?:^|;\s*)accountFixture=([^;]+)/,
      )?.[1];
      if (path.endsWith('/login')) {
        const who =
          body.email === customer.email
            ? customer
            : body.email === admin.email
              ? admin
              : null;
        if (who && body.password === password) issue(who);
        else send(401, null, 'UNAUTHORIZED');
      } else if (path.endsWith('/refresh')) {
        const who = cookies.get(cookie);
        cookies.delete(cookie);
        if (who) issue(who);
        else send(401, null, 'UNAUTHORIZED');
      } else if (path.endsWith('/logout')) {
        cookies.delete(cookie);
        send(204);
      } else if (!user) send(401, null, 'UNAUTHORIZED');
      else if (req.method === 'GET')
        send(
          controls.meStatus,
          user,
          controls.meStatus === 200 ? undefined : 'INTERNAL_ERROR',
        );
      else {
        const status = controls.status;
        if (controls.delay)
          await new Promise((done) => setTimeout(done, controls.delay));
        if (user.role !== 'CUSTOMER') send(403, null, 'FORBIDDEN');
        else if (status !== 200)
          send(
            status,
            null,
            status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
          );
        else if (path.endsWith('/password')) {
          if (body.currentPassword !== password)
            send(400, null, 'CURRENT_PASSWORD_MISMATCH');
          else if (
            passwordError(
              body.currentPassword,
              body.newPassword,
              body.newPassword,
            )
          )
            send(400, null, 'INVALID_REQUEST');
          else {
            password = body.newPassword;
            for (const [key, who] of cookies)
              if (who.id === user.id) cookies.delete(key);
            res.setHeader(
              'Set-Cookie',
              'accountFixture=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0',
            );
            send(204);
          }
        } else if (nicknameError(body.nickname ?? ''))
          send(400, null, 'INVALID_REQUEST');
        else {
          user.nickname = body.nickname;
          send(200, user);
        }
      }
      return true;
    },
  });
  return { ...fixture, controls, requests };
}
