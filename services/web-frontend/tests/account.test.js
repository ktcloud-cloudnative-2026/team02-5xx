import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthApi, AuthError } from '../src/authApi.js';
import { createAuthSession } from '../src/authSession.js';
import {
  nicknameError,
  passwordError,
} from '../src/account/accountValidation.js';
const user = {
  id: 1,
  email: 'customer@example.test',
  nickname: null,
  role: 'CUSTOMER',
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
async function setup(overrides = {}) {
  const api = {
    login: async () => ({ accessToken: 'synthetic', user }),
    me: async () => user,
    logout: async () => {},
    refresh: async () => ({ accessToken: 'synthetic-rotation', user }),
    updateProfile: async (_, nickname) => ({ ...user, nickname }),
    changePassword: async () => {},
    ...overrides,
  };
  const session = createAuthSession({ api });
  await session.login({});
  return { session, api };
}
test('Unicode nickname/password boundaries and whitespace preservation', () => {
  for (const value of ['', '  ', '\u2003']) assert.ok(nicknameError(value));
  for (const value of [' a ', '😀'.repeat(50)])
    assert.equal(nicknameError(value), '');
  assert.ok(nicknameError('😀'.repeat(51)));
  for (const length of [11, 65])
    assert.ok(passwordError('x', '😀'.repeat(length), '😀'.repeat(length)));
  for (const length of [12, 64])
    assert.equal(
      passwordError('x', '😀'.repeat(length), '😀'.repeat(length)),
      '',
    );
  assert.ok(passwordError('', 'a'.repeat(12), 'a'.repeat(12)));
  assert.ok(passwordError('x', 'a'.repeat(12), 'b'.repeat(12)));
});
test('AU-05 exact PATCH fields, Bearer, Unicode value; AU-06 bodyless 204 never parsed', async () => {
  const calls = [];
  const api = createAuthApi({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return path.endsWith('/password')
        ? { status: 204, json: () => assert.fail('204 JSON') }
        : Response.json({ success: true, data: { ...user, nickname: ' 😀 ' } });
    },
  });
  assert.equal((await api.updateProfile('synthetic', ' 😀 ')).nickname, ' 😀 ');
  await api.changePassword('synthetic', {
    currentPassword: ' old ',
    newPassword: ' new ',
    confirmation: 'ignored',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/v1/auth/me');
  assert.equal(calls[1].path, '/api/v1/auth/me/password');
  assert.deepEqual(JSON.parse(calls[0].options.body), { nickname: ' 😀 ' });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    currentPassword: ' old ',
    newPassword: ' new ',
  });
  for (const { options } of calls) {
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers.Authorization, 'Bearer synthetic');
    assert.equal(options.credentials, 'same-origin');
  }
});
for (const [status, errorCode] of [
  [400, 'CURRENT_PASSWORD_MISMATCH'],
  [400, 'INVALID_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [503, 'INTERNAL_ERROR'],
]) {
  test(`AU-06 error ${status}/${errorCode} preserved without retransmission`, async () => {
    let count = 0;
    const api = createAuthApi({
      fetchImpl: async () => {
        count++;
        return Response.json({ success: false, errorCode }, { status });
      },
    });
    await assert.rejects(
      api.changePassword('synthetic', {}),
      (e) => e.status === status && e.errorCode === errorCode,
    );
    assert.equal(count, 1);
  });
}
test('nickname success publishes session; duplicate submit rejected', async () => {
  const pending = deferred();
  const { session } = await setup({ updateProfile: () => pending.promise });
  const first = session.updateProfile(' 😀 ');
  await assert.rejects(
    session.updateProfile('other'),
    (e) => e.kind === 'busy',
  );
  pending.resolve({ ...user, nickname: ' 😀 ' });
  await first;
  assert.equal(session.getSnapshot().user.nickname, ' 😀 ');
});
test('password 204 clears locally, suppresses restore/refresh and older reads; no logout', async () => {
  const pending = deferred();
  let logout = 0,
    refresh = 0;
  const { session, api } = await setup({
    logout: async () => {
      logout++;
    },
    refresh: async () => {
      refresh++;
    },
  });
  api.me = () => pending.promise;
  const old = session.loadUser();
  await session.changePassword({});
  pending.resolve(user);
  await assert.rejects(old, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().authenticated, false);
  assert.equal(session.getSnapshot().reason, 'password-changed');
  await session.refresh();
  await session.restore();
  assert.equal(logout, 0);
  assert.equal(refresh, 0);
});
test('late update cannot overwrite another login; late GET cannot overwrite updated nickname', async () => {
  const pending = deferred();
  const { session, api } = await setup();
  api.me = () => pending.promise;
  const old = session.loadUser();
  await session.updateProfile('new');
  pending.resolve(user);
  await assert.rejects(old, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().user.nickname, 'new');
  const patch = deferred();
  api.updateProfile = () => patch.promise;
  const changing = session.updateProfile('old');
  await tick();
  api.me = async () => ({ ...user, id: 2 });
  api.login = async () => ({ accessToken: 'other', user: { ...user, id: 2 } });
  await session.login({});
  patch.resolve({ ...user, nickname: 'old' });
  await assert.rejects(changing, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().user.id, 2);
});
test('cancelled profile GET/PATCH responses are ignored even if transport ignores abort', async () => {
  const pending = deferred();
  const { session, api } = await setup();
  api.updateProfile = () => pending.promise;
  const controller = new AbortController();
  const changing = session.updateProfile('old', { signal: controller.signal });
  await tick();
  controller.abort();
  pending.resolve({ ...user, nickname: 'old' });
  await assert.rejects(changing, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().user.nickname, null);
});
for (const status of [400, 401, 403, 503])
  test(`session mutation ${status}: no refresh or replay`, async () => {
    let count = 0,
      refresh = 0;
    const { session } = await setup({
      changePassword: async () => {
        count++;
        throw new AuthError('fixture', { status });
      },
      refresh: async () => {
        refresh++;
      },
    });
    await assert.rejects(session.changePassword({}));
    assert.equal(count, 1);
    assert.equal(refresh, 0);
    assert.equal(session.getSnapshot().authenticated, status !== 401);
  });

test('password invalidation rejects an already pending refresh verification', async () => {
  const read = deferred();
  const { session, api } = await setup();
  api.me = () => read.promise;
  const rotating = session.refresh();
  await tick();
  await session.changePassword({});
  read.resolve(user);
  await assert.rejects(rotating, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().reason, 'password-changed');
  assert.equal(session.getSnapshot().authenticated, false);
});

test('refresh cannot overwrite a successful nickname update with an older GET', async () => {
  const read = deferred();
  const { session, api } = await setup();
  api.me = () => read.promise;
  const rotating = session.refresh();
  await tick();
  await session.updateProfile('새 닉네임');
  read.resolve(user);
  await rotating;
  assert.equal(session.getSnapshot().user.nickname, '새 닉네임');
});

test('a cancelled old-screen 401 cannot clear the current session or refresh it', async () => {
  const read = deferred();
  let refreshes = 0;
  const { session, api } = await setup({
    refresh: () => {
      refreshes++;
    },
  });
  api.me = () => read.promise;
  const controller = new AbortController();
  const old = session.loadUser({ signal: controller.signal });
  controller.abort();
  read.resolve(Promise.reject(new AuthError('fixture', { status: 401 })));
  await assert.rejects(old, (e) => e.kind === 'cancelled');
  assert.equal(session.getSnapshot().authenticated, true);
  assert.equal(refreshes, 0);
});

test('account mutation APIs reject STORE_ADMIN before HTTP', async () => {
  let writes = 0;
  const admin = { ...user, role: 'STORE_ADMIN' };
  const { session } = await setup({
    login: async () => ({ accessToken: 'synthetic', user: admin }),
    me: async () => admin,
    updateProfile: () => {
      writes++;
    },
    changePassword: () => {
      writes++;
    },
  });
  await assert.rejects(session.updateProfile('x'), (e) => e.status === 403);
  await assert.rejects(session.changePassword({}), (e) => e.status === 403);
  assert.equal(writes, 0);
});
