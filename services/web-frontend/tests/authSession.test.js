import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError, createAuthApi } from '../src/authApi.js';
import { createAuthSession } from '../src/authSession.js';
import { canUseCustomerFeatures, planCartIntent } from '../src/session.js';

// Synthetic contract fixtures only; no real account, token or signing material.
const user = Object.freeze({
  id: 1,
  email: 'customer@example.test',
  nickname: null,
  role: 'CUSTOMER',
});
const credentials = {
  email: user.email,
  password: 'fixture-only-password',
  rememberMe: false,
};
const token = (value = 'opaque-fixture-access', who = user) => ({
  accessToken: value,
  user: who,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((done) => setImmediate(done));

test('logout rejects a safe retry response that completes after session invalidation', async () => {
  const retry = deferred();
  let attempts = 0;
  const { store } = fakeApi({
    async send() {
      attempts++;
      if (attempts === 1) return new Response(null, { status: 401 });
      return retry.promise;
    },
  });
  await store.login(credentials);
  const request = store.request('/api/v1/test', { retryOn401: true });
  await tick();
  await store.logout();
  retry.resolve(Response.json({ ok: true }));
  await assert.rejects(request, (error) => error.kind === 'cancelled');
  assert.equal(store.getSnapshot().authenticated, false);
});
function fakeApi(overrides = {}) {
  const counts = { login: 0, refresh: 0, me: 0, logout: 0, send: 0 };
  const api = {
    async login() {
      counts.login++;
      return token('original-fixture-access');
    },
    async refresh() {
      counts.refresh++;
      return token('rotated-fixture-access');
    },
    async me() {
      counts.me++;
      return user;
    },
    async logout() {
      counts.logout++;
    },
    async send() {
      counts.send++;
      return Response.json({ ok: true });
    },
    ...overrides,
  };
  return { api, counts, store: createAuthSession({ api }) };
}

test('Auth API follows login/refresh/me fields, same-origin cookies and bodyless 204 logout', async () => {
  const calls = [];
  const api = createAuthApi({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/logout'))
        return {
          status: 204,
          json: () => assert.fail('204 must not parse JSON'),
        };
      if (path.endsWith('/me'))
        return Response.json({ success: true, data: user, message: 'OK' });
      return Response.json({
        success: true,
        data: { ...token(), tokenType: 'Bearer', expiresIn: 900 },
        message: 'OK',
      });
    },
  });
  await api.login(credentials);
  await api.me('opaque-fixture-access');
  await api.refresh();
  await api.logout();
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
    ],
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), credentials);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(
    calls[1].options.headers.Authorization,
    'Bearer opaque-fixture-access',
  );
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.redirect, 'error');
  }
  for (const call of calls.slice(2)) {
    assert.equal('body' in call.options, false);
    assert.equal('Authorization' in call.options.headers, false);
  }
});

test('rememberMe defaults to JSON false; non-Boolean input fails before fetch', async () => {
  const bodies = [];
  const api = createAuthApi({
    fetchImpl: async (_, options) => {
      bodies.push(JSON.parse(options.body));
      return Response.json({
        success: true,
        data: { ...token(), tokenType: 'Bearer', expiresIn: 900 },
      });
    },
  });
  await api.login({ email: user.email, password: 'fixture-only-password' });
  await api.login({ ...credentials, rememberMe: true });
  for (const rememberMe of ['false', 0, null])
    await assert.rejects(api.login({ ...credentials, rememberMe }));
  assert.deepEqual(
    bodies.map((body) => body.rememberMe),
    [false, true],
  );
});

for (const status of [401, 403, 500])
  test(`Auth HTTP ${status} is preserved without displaying server internals`, async () => {
    const api = createAuthApi({
      fetchImpl: async () => new Response('private diagnostics', { status }),
    });
    await assert.rejects(
      api.login(credentials),
      (error) => error.status === status && !error.message.includes('private'),
    );
  });

test('network failure is distinct from invalid credentials and no fake session is created', async () => {
  const api = createAuthApi({
    fetchImpl: async () => {
      throw new Error('private connection detail');
    },
  });
  const store = createAuthSession({ api });
  await assert.rejects(
    store.login(credentials),
    (error) => error.kind === 'network' && !error.message.includes('private'),
  );
  assert.equal(store.getSnapshot().authenticated, false);
});

for (const data of [
  { ...token(), tokenType: 'Bearer', expiresIn: '900' },
  { ...token(), tokenType: 'Other', expiresIn: 900 },
  { ...token('bad\nheader'), tokenType: 'Bearer', expiresIn: 900 },
  {
    ...token('opaque', { ...user, role: 'UNKNOWN' }),
    tokenType: 'Bearer',
    expiresIn: 900,
  },
])
  test(`malformed success cannot grant a session (${data.tokenType}/${typeof data.expiresIn}/${data.user.role})`, async () => {
    const api = createAuthApi({
      fetchImpl: async () => Response.json({ success: true, data }),
    });
    const store = createAuthSession({ api });
    await assert.rejects(
      store.login(credentials),
      (error) => error.kind === 'protocol',
    );
    assert.equal(store.getSnapshot().authenticated, false);
  });

test('snapshot/subscription identities are stable; tokens and credentials never enter snapshots', async () => {
  const { store } = fakeApi();
  const initial = store.getSnapshot();
  assert.equal(store.getSnapshot(), initial);
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  await store.login(credentials);
  const authenticated = store.getSnapshot();
  assert.equal(store.getSnapshot(), authenticated);
  assert.equal(authenticated.user.id, 1);
  assert.equal(Object.isFrozen(authenticated), true);
  assert.equal(store.getServerSnapshot().authenticated, false);
  assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
  const serialized = JSON.stringify(authenticated);
  assert.ok(
    !serialized.includes('accessToken') &&
      !serialized.includes('fixture-access') &&
      !serialized.includes('password'),
  );
  unsubscribe();
  const before = changes;
  await store.logout();
  assert.equal(changes, before);
});

test('StrictMode-style repeated restoration and direct refresh share one operation', async () => {
  const pending = deferred();
  let refreshes = 0;
  const { store } = fakeApi({
    refresh: () => {
      refreshes++;
      return pending.promise;
    },
  });
  const first = store.restore();
  const second = store.restore();
  assert.equal(first, second);
  await tick();
  assert.equal(refreshes, 1);
  pending.resolve(token());
  await first;
  await store.restore();
  assert.equal(refreshes, 1);
  assert.equal(store.getSnapshot().authenticated, true);
});

test('simultaneous explicit refresh calls are single-flight', async () => {
  const pending = deferred();
  let count = 0;
  const { store } = fakeApi({
    refresh: () => {
      count++;
      return pending.promise;
    },
  });
  const first = store.refresh(),
    second = store.refresh();
  assert.equal(first, second);
  await tick();
  pending.resolve(token());
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('login 401 never refreshes; failed initial restoration stays anonymous', async () => {
  const { store, counts } = fakeApi({
    login: async () => {
      throw new AuthError('denied', { status: 401 });
    },
  });
  await assert.rejects(store.login(credentials));
  assert.equal(counts.refresh, 0);
  const failed = fakeApi({
    refresh: async () => {
      throw new AuthError('expired', { status: 401 });
    },
  }).store;
  await failed.restore();
  assert.equal(failed.getSnapshot().authenticated, false);
});

test('concurrent safe GET 401s refresh once and each retry at most once', async () => {
  const pending = deferred();
  let refreshes = 0,
    sends = 0;
  const { store } = fakeApi({
    refresh: () => {
      refreshes++;
      return pending.promise;
    },
    send: async (_, options) => {
      sends++;
      return new Response('', {
        status:
          options.headers.get('Authorization') ===
          'Bearer original-fixture-access'
            ? 401
            : 200,
      });
    },
  });
  await store.login(credentials);
  const calls = Array.from({ length: 5 }, () =>
    store.request('/api/v1/test-resource', { retryOn401: true }),
  );
  await tick();
  assert.equal(refreshes, 1);
  pending.resolve(token('rotated-fixture-access'));
  const responses = await Promise.all(calls);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(sends, 10);
});

test('late old-token 401 reuses already rotated access rather than rotating again', async () => {
  const late = deferred();
  let first = true;
  const { store, counts } = fakeApi({
    send: async (_, options) => {
      if (
        options.headers.get('Authorization') !==
        'Bearer original-fixture-access'
      )
        return new Response('', { status: 200 });
      if (first) {
        first = false;
        return late.promise;
      }
      return new Response('', { status: 401 });
    },
  });
  await store.login(credentials);
  const delayed = store.request('/api/v1/test-resource', { retryOn401: true });
  assert.equal(
    (await store.request('/api/v1/test-resource', { retryOn401: true })).status,
    200,
  );
  late.resolve(new Response('', { status: 401 }));
  assert.equal((await delayed).status, 200);
  assert.equal(counts.refresh, 1);
});

test('repeated GET 401 ends anonymous after exactly one refresh and one retry', async () => {
  let sends = 0;
  const { store, counts } = fakeApi({
    send: async () => {
      sends++;
      return new Response('', { status: 401 });
    },
  });
  await store.login(credentials);
  assert.equal(
    (await store.request('/api/v1/test-resource', { retryOn401: true })).status,
    401,
  );
  assert.equal(sends, 2);
  assert.equal(counts.refresh, 1);
  assert.equal(store.getSnapshot().authenticated, false);
});

test('403 never refreshes or retries and preserves the current session', async () => {
  let sends = 0;
  const { store, counts } = fakeApi({
    send: async () => {
      sends++;
      return new Response('', { status: 403 });
    },
  });
  await store.login(credentials);
  assert.equal(
    (await store.request('/api/v1/test-resource', { retryOn401: true })).status,
    403,
  );
  assert.equal(counts.refresh, 0);
  assert.equal(sends, 1);
  assert.equal(store.getSnapshot().authenticated, true);
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
  test(`unsafe ${method} is never automatically replayed`, async () => {
    let sends = 0;
    const { store, counts } = fakeApi({
      send: async () => {
        sends++;
        return new Response('', { status: 401 });
      },
    });
    await store.login(credentials);
    await store.request('/api/v1/test-resource', { method, retryOn401: true });
    assert.equal(counts.refresh, 0);
    assert.equal(sends, 1);
    assert.equal(store.getSnapshot().authenticated, false);
  });

test('GET retry requires explicit opt-in and caller Authorization cannot replace private access', async () => {
  let seen;
  const { store, counts } = fakeApi({
    send: async (_, options) => {
      seen = options.headers.get('Authorization');
      return new Response('', { status: 401 });
    },
  });
  await store.login(credentials);
  await store.request('/api/v1/test-resource', {
    headers: { Authorization: 'Bearer caller-forgery' },
  });
  assert.equal(seen, 'Bearer original-fixture-access');
  assert.equal(counts.refresh, 0);
});

for (const status of [401, 403, 0])
  test(`refresh failure ${status} clears memory without a retry loop`, async () => {
    let refreshes = 0;
    const { store } = fakeApi({
      refresh: async () => {
        refreshes++;
        throw new AuthError('failure', { status });
      },
    });
    await store.login(credentials);
    await assert.rejects(store.refresh());
    assert.equal(store.getSnapshot().authenticated, false);
    assert.equal(await store.refresh(), null);
    assert.equal(refreshes, 1);
  });

test('logout invalidates a pending refresh and waits to delete the final rotated cookie', async () => {
  const pending = deferred();
  const { store, counts } = fakeApi({ refresh: () => pending.promise });
  await store.login(credentials);
  const refresh = store.refresh();
  const rejected = assert.rejects(
    refresh,
    (error) => error.kind === 'cancelled',
  );
  await tick();
  const logout = store.logout();
  assert.equal(store.getSnapshot().authenticated, false);
  assert.equal(counts.logout, 0);
  pending.resolve(token('late-fixture-access'));
  await rejected;
  await logout;
  assert.equal(counts.logout, 1);
  assert.equal(store.getSnapshot().authenticated, false);
  assert.equal(await store.refresh(), null);
});

test('logout also prevents a late login response from republishing a session', async () => {
  const pending = deferred();
  const { store, counts } = fakeApi({ login: () => pending.promise });
  const login = store.login(credentials);
  const rejected = assert.rejects(login, (error) => error.kind === 'cancelled');
  await tick();
  const logout = store.logout();
  pending.resolve(token());
  await rejected;
  await logout;
  assert.equal(counts.logout, 1);
  assert.equal(store.getSnapshot().authenticated, false);
});

test('login waits for initial restoration to settle, and duplicate submissions are rejected', async () => {
  const pending = deferred();
  const { store, counts } = fakeApi({ refresh: () => pending.promise });
  const restoration = store.restore();
  const login = store.login(credentials);
  await assert.rejects(
    store.login(credentials),
    (error) => error.kind === 'busy',
  );
  await tick();
  assert.equal(counts.login, 0);
  pending.resolve(token('superseded-fixture-access'));
  await Promise.all([restoration, login]);
  assert.equal(counts.login, 1);
  assert.equal(store.getSnapshot().authenticated, true);
});

test('cancelled login cannot publish even if a transport ignores its AbortSignal', async () => {
  const pending = deferred();
  const { store } = fakeApi({ login: () => pending.promise });
  const controller = new AbortController();
  const login = store.login(credentials, { signal: controller.signal });
  await tick();
  controller.abort();
  pending.resolve(token());
  await assert.rejects(login, (error) => error.kind === 'cancelled');
  assert.equal(store.getSnapshot().authenticated, false);
});

test('logout is single-flight; server failure is reported while local session stays anonymous', async () => {
  const pending = deferred();
  const { store } = fakeApi({ logout: () => pending.promise });
  await store.login(credentials);
  const first = store.logout(),
    second = store.logout();
  assert.equal(first, second);
  pending.reject(new AuthError('network', { kind: 'network' }));
  await assert.rejects(first);
  assert.equal(store.getSnapshot().authenticated, false);
});

test('AU-02 updates server profile, and 403 never initiates refresh', async () => {
  const { store, api, counts } = fakeApi();
  await store.login(credentials);
  api.me = async () => ({ ...user, nickname: '서버 별명' });
  await store.loadUser();
  assert.equal(store.getSnapshot().user.nickname, '서버 별명');
  api.me = async () => {
    throw new AuthError('forbidden', { status: 403 });
  };
  await assert.rejects(store.loadUser(), (error) => error.status === 403);
  assert.equal(counts.refresh, 0);
});

test('profile ID mismatch and external destinations cannot grant or leak authentication', async () => {
  const { store } = fakeApi({ me: async () => ({ ...user, id: 99 }) });
  await assert.rejects(
    store.login(credentials),
    (error) => error.kind === 'protocol',
  );
  assert.equal(store.getSnapshot().authenticated, false);
  const api = createAuthApi({
    fetchImpl: () => assert.fail('external request'),
  });
  for (const path of [
    'https://example.test/api/v1/auth/me',
    '//example.test/path',
    '/api/v1/\\evil',
  ])
    await assert.rejects(api.send(path));
});

test('CUSTOMER alone gets order actions; browser cart is public and roles are not hierarchical', () => {
  assert.equal(
    canUseCustomerFeatures({ authenticated: true, role: 'CUSTOMER' }),
    true,
  );
  for (const role of ['STORE_ADMIN', 'UNKNOWN', undefined]) {
    const session = { authenticated: true, role };
    assert.equal(canUseCustomerFeatures(session), false);
    assert.equal(planCartIntent(session, { type: 'order' }).forbidden, true);
    assert.deepEqual(planCartIntent(session, { type: 'view' }).action, {
      type: 'view',
    });
  }
  assert.equal(
    canUseCustomerFeatures({
      authenticated: true,
      role: 'CUSTOMER',
      user: { role: 'STORE_ADMIN' },
    }),
    false,
  );
  assert.ok(planCartIntent({ role: 'CUSTOMER' }, { type: 'order' }).pending);
});
