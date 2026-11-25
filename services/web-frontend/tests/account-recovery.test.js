import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthError } from '../src/authApi.js';
import { createAuthSession } from '../src/authSession.js';
import { accountError } from '../src/account/accountValidation.js';
const user = Object.freeze({
  id: 1,
  email: 'customer@example.test',
  nickname: null,
  role: 'CUSTOMER',
});
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const failure = (status = 401, kind = 'http') =>
  new AuthError('fixture', { status, kind });
async function setup() {
  const calls = { patch: [], refresh: 0, logout: 0 };
  const api = {
    login: async () => ({ accessToken: 'initial', user }),
    me: async () => user,
    logout: async () => {
      calls.logout++;
    },
    refresh: async () => {
      calls.refresh++;
      return { accessToken: 'rotated', user };
    },
    updateProfile: async (token, nickname) => {
      calls.patch.push({ token });
      throw failure();
    },
    changePassword: async (token) => {
      calls.patch.push({ token });
      throw failure();
    },
  };
  const session = createAuthSession({ api });
  await session.login({});
  return { session, api, calls };
}
const mutate = (session, kind, signal) =>
  kind === 'profile'
    ? session.updateProfile(' keep 😀 ', { signal })
    : session.changePassword({}, { signal });
for (const kind of ['profile', 'password']) {
  test(`${kind} 401 refreshes once, keeps CUSTOMER and requires explicit fresh-token PATCH`, async () => {
    const { session, api, calls } = await setup();
    await assert.rejects(
      mutate(session, kind),
      (error) =>
        error.kind === 'account-retry' &&
        accountError(error) ===
          '로그인을 다시 확인했어요. 입력한 내용을 확인하고 다시 저장해 주세요.',
    );
    assert.equal(session.getSnapshot().authenticated, true);
    assert.equal(calls.refresh, 1);
    assert.deepEqual(calls.patch, [{ token: 'initial' }]);
    if (kind === 'profile')
      api.updateProfile = async (token, nickname) => {
        calls.patch.push({ token });
        return { ...user, nickname };
      };
    else
      api.changePassword = async (token) => {
        calls.patch.push({ token });
      };
    await mutate(session, kind);
    assert.deepEqual(calls.patch, [{ token: 'initial' }, { token: 'rotated' }]);
    assert.equal(calls.refresh, 1);
    assert.equal(calls.logout, 0);
    assert.equal(session.getSnapshot().authenticated, kind === 'profile');
    if (kind === 'password')
      assert.equal(session.getSnapshot().reason, 'password-changed');
  });
  for (const [status, errorKind] of [
    [401, 'http'],
    [503, 'http'],
    [0, 'network'],
  ])
    test(`${kind} refresh ${status}/${errorKind} expires without replay or refresh loop`, async () => {
      const { session, api, calls } = await setup();
      api.refresh = async () => {
        calls.refresh++;
        throw failure(status, errorKind);
      };
      await assert.rejects(
        mutate(session, kind),
        (error) => error.status === status && error.kind === errorKind,
      );
      assert.equal(session.getSnapshot().reason, 'expired');
      assert.equal(session.getSnapshot().authenticated, false);
      assert.equal(calls.patch.length, 1);
      assert.equal(calls.refresh, 1);
      await session.refresh();
      assert.equal(calls.refresh, 1);
    });
  for (const status of [400, 403, 503, 0])
    test(`${kind} mutation ${status} never refreshes`, async () => {
      const { session, api, calls } = await setup();
      const action = async (token) => {
        calls.patch.push({ token });
        throw failure(status, status ? 'http' : 'network');
      };
      api.updateProfile = action;
      api.changePassword = action;
      await assert.rejects(mutate(session, kind));
      assert.equal(calls.patch.length, 1);
      assert.equal(calls.refresh, 0);
      assert.equal(session.getSnapshot().authenticated, true);
    });
  test(`${kind} cancelled account-owned refresh never publishes late or logs out`, async () => {
    const { session, api, calls } = await setup();
    const held = deferred();
    api.refresh = () => {
      calls.refresh++;
      return held.promise;
    };
    const controller = new AbortController();
    const change = mutate(session, kind, controller.signal);
    const rejected = assert.rejects(change, { kind: 'cancelled' });
    await tick();
    controller.abort();
    held.resolve({ accessToken: 'rotated', user });
    await rejected;
    assert.equal(session.getSnapshot().authenticated, true);
    assert.equal(calls.patch.length, 1);
    let token;
    api.send = async (_path, options) => {
      token = options.headers.get('Authorization');
      return new Response(null, { status: 200 });
    };
    await session.request('/api/v1/test');
    assert.equal(token, 'Bearer initial');
  });
}
test('account 401 joins existing refresh; duplicate account submit rejected', async () => {
  const { session, api, calls } = await setup();
  const held = deferred();
  api.refresh = () => {
    calls.refresh++;
    return held.promise;
  };
  const rotating = session.refresh();
  await tick();
  const change = session.updateProfile('keep');
  const rejected = assert.rejects(change, { kind: 'account-retry' });
  await tick();
  await assert.rejects(session.changePassword({}), { kind: 'busy' });
  assert.equal(calls.refresh, 1);
  held.resolve({ accessToken: 'rotated', user });
  await rotating;
  await rejected;
  assert.equal(calls.patch.length, 1);
});
test('a late original-token 401 reuses completed rotation without another refresh', async () => {
  const { session, api, calls } = await setup();
  const held = deferred();
  api.updateProfile = async (token) => {
    calls.patch.push({ token });
    return held.promise;
  };
  const change = session.updateProfile('keep');
  const rejected = assert.rejects(change, { kind: 'account-retry' });
  await tick();
  await session.refresh();
  held.reject(failure());
  await rejected;
  assert.equal(calls.refresh, 1);
  assert.equal(calls.patch.length, 1);
});
test('completed rotation with an equal Access value is still reused without duplicate Refresh', async () => {
  const { session, api, calls } = await setup();
  const held = deferred();
  api.updateProfile = async (token) => {
    calls.patch.push({ token });
    return held.promise;
  };
  api.refresh = async () => {
    calls.refresh++;
    return { accessToken: 'initial', user };
  };
  const change = session.updateProfile('keep');
  const rejected = assert.rejects(change, { kind: 'account-retry' });
  await tick();
  await session.refresh();
  held.reject(failure());
  await rejected;
  assert.equal(calls.refresh, 1);
  assert.equal(calls.patch.length, 1);
});
for (const who of [
  { ...user, id: 2 },
  { ...user, role: 'STORE_ADMIN' },
])
  test(`recovery rejects identity/role drift ${who.id}/${who.role} before publication`, async () => {
    const { session, api, calls } = await setup();
    const seen = [];
    session.subscribe(() => seen.push(session.getSnapshot().user));
    api.refresh = async () => {
      calls.refresh++;
      return { accessToken: 'wrong-identity', user: who };
    };
    api.me = async () => who;
    await assert.rejects(session.updateProfile('keep'), { kind: 'protocol' });
    assert.equal(session.getSnapshot().reason, 'expired');
    assert.ok(seen.every((value) => value === null));
    assert.equal(calls.patch.length, 1);
  });
for (const who of [
  { ...user, id: 2 },
  { ...user, role: 'STORE_ADMIN' },
])
  test(`shared refresh rejects account owner/role drift ${who.id}/${who.role} before publication`, async () => {
    const { session, api, calls } = await setup();
    const held = deferred();
    const seen = [];
    session.subscribe(() => seen.push(session.getSnapshot().user));
    api.refresh = () => {
      calls.refresh++;
      return held.promise;
    };
    const rotating = session.refresh();
    const rejectedRotation = assert.rejects(rotating, { kind: 'protocol' });
    await tick();
    const change = session.updateProfile('keep');
    const rejectedChange = assert.rejects(change, { kind: 'protocol' });
    await tick();
    api.me = async () => who;
    held.resolve({ accessToken: 'wrong-owner', user: who });
    await rejectedRotation;
    await rejectedChange;
    assert.ok(seen.every((value) => value === null));
    assert.equal(calls.refresh, 1);
    assert.equal(calls.patch.length, 1);
    assert.equal(session.getSnapshot().authenticated, false);
  });
for (const action of ['logout', 'switch'])
  test(`late account refresh cannot overwrite ${action}`, async () => {
    const { session, api, calls } = await setup();
    const held = deferred();
    api.refresh = () => {
      calls.refresh++;
      return held.promise;
    };
    const change = session.changePassword({});
    const rejected = assert.rejects(change, { kind: 'cancelled' });
    await tick();
    let navigation;
    if (action === 'logout') navigation = session.logout();
    else {
      const other = { ...user, id: 2 };
      api.login = async () => ({ accessToken: 'other', user: other });
      api.me = async () => other;
      navigation = session.login({});
    }
    held.resolve({ accessToken: 'old-rotation', user });
    await rejected;
    await navigation;
    assert.equal(calls.patch.length, 1);
    assert.equal(session.getSnapshot().authenticated, action === 'switch');
    if (action === 'switch') assert.equal(session.getSnapshot().user.id, 2);
  });
for (const accountFirst of [false, true])
  test(`cancelled account subscriber preserves independently owned GET refresh (${accountFirst})`, async () => {
    const { session, api, calls } = await setup();
    const held = deferred();
    api.refresh = () => {
      calls.refresh++;
      return held.promise;
    };
    const controller = new AbortController();
    let rotating, change;
    if (accountFirst) {
      change = session.updateProfile('keep', { signal: controller.signal });
      await tick();
      rotating = session.refresh();
    } else {
      rotating = session.refresh();
      await tick();
      change = session.updateProfile('keep', { signal: controller.signal });
    }
    const rejected = assert.rejects(change, { kind: 'cancelled' });
    await tick();
    controller.abort();
    held.resolve({ accessToken: 'rotated', user });
    await rotating;
    await rejected;
    assert.equal(calls.refresh, 1);
    assert.equal(calls.patch.length, 1);
    assert.equal(session.getSnapshot().authenticated, true);
  });
test('password 204 after leaving still invalidates local auth and pending rotation; no logout', async () => {
  const { session, api, calls } = await setup();
  const held = deferred(),
    rotation = deferred();
  api.refresh = () => {
    calls.refresh++;
    return rotation.promise;
  };
  api.changePassword = () => held.promise;
  const rotating = session.refresh();
  const rejected = assert.rejects(rotating, { kind: 'cancelled' });
  const controller = new AbortController();
  const change = session.changePassword({}, { signal: controller.signal });
  await tick();
  controller.abort();
  held.resolve();
  await change;
  rotation.resolve({ accessToken: 'old', user });
  await rejected;
  assert.equal(session.getSnapshot().reason, 'password-changed');
  assert.equal(calls.logout, 0);
});
test('generic unsafe request 401 still expires without refresh; account-only recovery does not leak', async () => {
  const { session, api, calls } = await setup();
  api.send = async () => new Response(null, { status: 401 });
  const result = await session.request('/api/v1/test', {
    method: 'PATCH',
    retryOn401: true,
  });
  assert.equal(result.status, 401);
  assert.equal(calls.refresh, 0);
  assert.equal(session.getSnapshot().reason, 'expired');
});
for (const status of [401, 503, 0])
  test(`cancelled recovery ignores late refresh failure ${status} without clearing session`, async () => {
    const { session, api } = await setup();
    const held = deferred();
    api.refresh = () => held.promise;
    const controller = new AbortController();
    const change = session.changePassword({}, { signal: controller.signal });
    const rejected = assert.rejects(change, { kind: 'cancelled' });
    await tick();
    controller.abort();
    held.reject(failure(status, status ? 'http' : 'network'));
    await rejected;
    assert.equal(session.getSnapshot().authenticated, true);
  });
