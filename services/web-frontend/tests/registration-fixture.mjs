import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
// Reuse existing product App/Auth/Menu/Checkout HTTP fixture; no password/token logging or storage.
export async function startRegistrationFixture({ preview = false } = {}) {
  const controls = {
    checkDelay: 0,
    registerDelay: 0,
    registerStatus: 201,
    code: '',
    networkError: false,
    taken: new Set(['taken@example.test']),
    delays: new Map(),
  };
  const counts = { check: 0, register: 0 };
  let sequence = 50;
  const protocol = [];
  const fixture = await startCustomerHttpFixture({
    input: resolve('tests/registration-entry.jsx'),
    async handleRequest(req, res) {
      const url = new URL(req.url, 'http://fixture');
      if (
        preview &&
        req.method === 'GET' &&
        url.pathname.startsWith('/__preview/scenario/')
      ) {
        const scenario = url.pathname.split('/').at(-1);
        const scenarios = {
          success: [201, ''],
          conflict: [409, 'EMAIL_ALREADY_EXISTS'],
          invalid: [400, 'INVALID_REQUEST'],
          terms: [400, 'INVALID_AGREEMENT_VERSION'],
          unavailable: [503, 'REGISTRATION_UNAVAILABLE'],
          network: [201, ''],
        };
        if (!Object.hasOwn(scenarios, scenario)) {
          res.writeHead(404).end();
          return true;
        }
        [controls.registerStatus, controls.code] = scenarios[scenario];
        controls.networkError = scenario === 'network';
        controls.taken = new Set(['taken@example.test']);
        res
          .writeHead(302, {
            Location: '/?preview=1#menu-list',
            'Cache-Control': 'no-store',
          })
          .end();
        return true;
      }
      if (
        !['/api/v1/auth/email-availability', '/api/v1/auth/register'].includes(
          url.pathname,
        )
      )
        return false;
      protocol.push({
        method: req.method,
        authorization: !!req.headers.authorization,
        fakeIdentity: !!req.headers['x-user-id'],
      });
      const send = (status, data, errorCode) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: status < 300,
            data,
            message: 'Registration HTTP fixture only',
            ...(errorCode ? { errorCode } : {}),
          }),
        );
      };
      if (url.pathname.endsWith('email-availability')) {
        counts.check++;
        const email = url.searchParams.get('email');
        const delay = controls.delays.get(email) ?? controls.checkDelay;
        if (delay) await new Promise((done) => setTimeout(done, delay));
        send(200, { email, available: !controls.taken.has(email) });
        return true;
      }
      counts.register++;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      raw = '';
      const email = body.email;
      const hasOnlyExpectedKeys =
        Object.keys(body).sort().join(',') === 'agreements,email,password';
      const validAgreements =
        body.agreements?.length === 2 &&
        body.agreements.every(
          (a) => a.agreed === true && a.version === 'demo-v1',
        );
      // Discard password immediately. The fixture does not implement a second credential database.
      delete body.password;
      if (controls.networkError) {
        res.destroy();
        return true;
      }
      if (controls.registerDelay)
        await new Promise((done) => setTimeout(done, controls.registerDelay));
      if (!hasOnlyExpectedKeys || !validAgreements)
        send(400, null, 'INVALID_REQUEST');
      else if (controls.registerStatus !== 201)
        send(controls.registerStatus, null, controls.code);
      else if (controls.taken.has(email))
        send(409, null, 'EMAIL_ALREADY_EXISTS');
      else {
        controls.taken.add(email);
        send(201, { id: ++sequence, email });
      }
      return true;
    },
  });
  return {
    ...fixture,
    registrationControls: controls,
    registrationCounts: counts,
    protocol,
  };
}
