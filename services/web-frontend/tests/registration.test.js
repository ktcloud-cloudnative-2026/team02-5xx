import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRegistrationApi,
  validateRegistration,
  normalizeRegistrationEmail,
} from '../src/registration/registrationApi.js';
import {
  registrationTerms,
  termsReady,
} from '../src/registration/registrationTerms.js';
import { fixtureTerms } from './registration-terms.js';
const request = () => ({
  email: ' Member@EXAMPLE.Test ',
  password: '  secret-pass123  ',
  agreements: fixtureTerms.map(({ type, version }) => ({
    type,
    version,
    agreed: true,
  })),
});
const response = (data, status = 200) =>
  new Response(JSON.stringify({ success: true, data, message: 'OK' }), {
    status,
  });
test('demo-v1 production policies have full texts; only complete nonduplicate catalogs are ready', () => {
  assert.equal(termsReady(registrationTerms), true);
  assert.deepEqual(
    registrationTerms.map((t) => t.version),
    ['demo-v1', 'demo-v1'],
  );
  assert.ok(registrationTerms.every((t) => t.text.length > 500));
  assert.match(registrationTerms[0].text, /실제 금전 결제가 발생하지 않/);
  assert.match(registrationTerms[1].text, /Argon2 해시/);
  assert.equal(termsReady(fixtureTerms), true);
  for (const terms of [
    null,
    [],
    [fixtureTerms[0], fixtureTerms[0]],
    fixtureTerms.map((t) => ({ ...t, text: '' })),
    fixtureTerms.map((t) => ({ ...t, version: '' })),
  ])
    assert.equal(termsReady(terms), false);
});
test('email keeps local-part case and lowercases only domain; password Unicode/whitespace remain exact', () => {
  const input = request();
  const result = validateRegistration(input);
  assert.equal(result.email, 'Member@example.test');
  assert.equal(result.password, input.password);
  assert.equal(
    normalizeRegistrationEmail('a+tag@example.test'),
    'a+tag@example.test',
  );
  assert.doesNotThrow(() =>
    validateRegistration({ ...input, password: '😀'.repeat(12) }),
  );
});
for (const email of [
  '',
  null,
  'a',
  'a@@b',
  'a@',
  ' @b',
  'a b@c',
  'x'.repeat(255) + '@a',
])
  test(`invalid email ${String(email).slice(0, 20)}`, () =>
    assert.throws(() => normalizeRegistrationEmail(email), {
      code: 'INVALID_REQUEST',
    }));
for (const password of ['', null, 'a'.repeat(11), 'a'.repeat(65)])
  test(`invalid password length ${password?.length}`, () =>
    assert.throws(() => validateRegistration({ ...request(), password }), {
      code: 'INVALID_REQUEST',
    }));
for (const agreements of [
  [],
  null,
  [{ type: 'TERMS', version: 'v', agreed: true }],
  fixtureTerms.map(({ type, version }) => ({ type, version, agreed: false })),
])
  test(`invalid agreements ${JSON.stringify(agreements)}`, () =>
    assert.throws(() => validateRegistration({ ...request(), agreements }), {
      code: 'INVALID_REQUEST',
    }));
test('AU-03/04 exact paths/methods/credentials/redirects and DTOs, with no Bearer/role/confirmation', async () => {
  const calls = [];
  const api = createRegistrationApi({
    fetchImpl: async (path, options) => {
      calls.push([path, options]);
      return options.method === 'GET'
        ? response({ email: 'Member@example.test', available: true })
        : response({ id: 42, email: 'Member@example.test' }, 201);
    },
  });
  assert.equal((await api.checkEmail('Member@EXAMPLE.Test')).available, true);
  assert.deepEqual(await api.register(request()), {
    id: 42,
    email: 'Member@example.test',
  });
  assert.equal(
    calls[0][0],
    '/api/v1/auth/email-availability?email=Member%40example.test',
  );
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[1][0], '/api/v1/auth/register');
  assert.deepEqual(
    JSON.parse(calls[1][1].body),
    validateRegistration(request()),
  );
  for (const [, options] of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['X-User-Id'], undefined);
  }
});
for (const [code, status] of [
  ['INVALID_REQUEST', 400],
  ['REQUIRED_AGREEMENT_MISSING', 400],
  ['INVALID_AGREEMENT_VERSION', 400],
  ['EMAIL_ALREADY_EXISTS', 409],
  ['REGISTRATION_UNAVAILABLE', 503],
])
  test(`maps ${status} ${code} without echo/retry`, async () => {
    let calls = 0;
    const api = createRegistrationApi({
      fetchImpl: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            success: false,
            errorCode: code,
            message: 'sensitive raw server text',
          }),
          { status },
        );
      },
    });
    await assert.rejects(
      api.register(request()),
      (e) => e.code === code && !e.message.includes('sensitive'),
    );
    assert.equal(calls, 1);
  });
test('malformed, mismatched email/ID/envelope and nonboolean availability never imply success', async () => {
  for (const data of [
    { email: 'other@example.test', available: true },
    { email: 'Member@example.test', available: 'true' },
  ])
    await assert.rejects(
      createRegistrationApi({
        fetchImpl: async () => response(data),
      }).checkEmail('Member@example.test'),
      { code: 'INVALID_RESPONSE' },
    );
  for (const data of [
    { id: 0, email: 'Member@example.test' },
    { id: 1, email: 'other@example.test' },
  ])
    await assert.rejects(
      createRegistrationApi({
        fetchImpl: async () => response(data, 201),
      }).register(request()),
      { code: 'INVALID_RESPONSE' },
    );
  await assert.rejects(
    createRegistrationApi({
      fetchImpl: async () => new Response('{', { status: 201 }),
    }).register(request()),
    { code: 'INVALID_RESPONSE' },
  );
});
test('network/timeout/cancellation are safe, distinguishable and never automatically repeat POST', async () => {
  await assert.rejects(
    createRegistrationApi({
      fetchImpl: async () => {
        throw new TypeError('sensitive');
      },
    }).register(request()),
    { code: 'NETWORK_ERROR' },
  );
  const api = createRegistrationApi({
    timeoutMs: 5,
    fetchImpl: (_, options) =>
      new Promise((_, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(options.signal.reason),
          { once: true },
        ),
      ),
  });
  const keep = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(api.register(request()), { code: 'TIMEOUT' });
    const abort = new AbortController();
    const promise = api.checkEmail('x@example.test', { signal: abort.signal });
    abort.abort();
    await assert.rejects(promise, { code: 'CANCELLED' });
  } finally {
    clearTimeout(keep);
  }
});

test('manual preview uses demo-v1 HTTP DTOs and switches success/400/409/503/network fixtures', async () => {
  const { startRegistrationFixture } =
    await import('./registration-fixture.mjs');
  const fixture = await startRegistrationFixture({ preview: true });
  try {
    for (const [scenario, status, code] of [
      ['success', 201],
      ['conflict', 409, 'EMAIL_ALREADY_EXISTS'],
      ['invalid', 400, 'INVALID_REQUEST'],
      ['terms', 400, 'INVALID_AGREEMENT_VERSION'],
      ['unavailable', 503, 'REGISTRATION_UNAVAILABLE'],
      ['network', null],
    ]) {
      const redirect = await fetch(
        `${fixture.url}/__preview/scenario/${scenario}`,
        { redirect: 'manual' },
      );
      assert.equal(redirect.status, 302);
      const api = createRegistrationApi({
        fetchImpl: (path, options) => fetch(fixture.url + path, options),
      });
      assert.equal(
        (await api.checkEmail('preview@example.test')).available,
        true,
      );
      const input = {
        ...request(),
        email: 'preview@example.test',
        agreements: registrationTerms.map(({ type, version }) => ({
          type,
          version,
          agreed: true,
        })),
      };
      if (status === 201) {
        assert.equal((await api.register(input)).email, input.email);
        assert.equal((await api.checkEmail(input.email)).available, false);
      } else {
        await assert.rejects(api.register(input), {
          code: code ?? 'NETWORK_ERROR',
        });
      }
    }
  } finally {
    await fixture.close();
  }
});
