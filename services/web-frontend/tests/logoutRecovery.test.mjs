import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogoutRecovery } from '../src/logoutRecovery.js';
const later = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup() {
  let user = {
    authenticated: true,
    role: 'CUSTOMER',
    phase: 'authenticated',
    user: { id: 1, role: 'CUSTOMER' },
  };
  let operation = () => Promise.reject(new Error('offline'));
  const listeners = new Set(),
    calls = { logout: 0, login: 0 };
  const publish = (next) => {
    user = next;
    for (const callback of listeners) callback();
  };
  const source = {
    getSnapshot: () => user,
    subscribe: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    logout() {
      calls.logout++;
      publish({ authenticated: false, phase: 'anonymous' });
      return operation();
    },
    async login() {
      calls.login++;
      publish({
        authenticated: true,
        phase: 'authenticated',
        role: 'CUSTOMER',
        user: { id: 3, role: 'CUSTOMER' },
      });
      return user;
    },
  };
  const recovery = createLogoutRecovery(source),
    unsubscribe = recovery.subscribe(() => {});
  return {
    source,
    recovery,
    calls,
    publish,
    unsubscribe,
    setOperation(next) {
      operation = next;
    },
  };
}
test('failed logout clears local authentication but exposes a retry with the cookie warning', async () => {
  const env = setup();
  await assert.rejects(env.recovery.logout());
  assert.equal(env.source.getSnapshot().authenticated, false);
  assert.equal(env.recovery.getSnapshot().phase, 'failed');
  assert.match(env.recovery.getSnapshot().error, /새로고침/);
  env.unsubscribe();
});
test('retry failure keeps recovery; retry success removes it', async () => {
  const env = setup();
  await assert.rejects(env.recovery.logout());
  await assert.rejects(
    env.recovery.retry(env.recovery.getSnapshot().failureId),
  );
  assert.equal(env.recovery.getSnapshot().phase, 'failed');
  env.setOperation(() => Promise.resolve());
  await env.recovery.retry(env.recovery.getSnapshot().failureId);
  assert.equal(env.recovery.getSnapshot().phase, 'idle');
  assert.equal(env.recovery.getSnapshot().error, '');
  assert.equal(env.calls.logout, 3);
  env.unsubscribe();
});
test('initial logout and retry are single-flight even for synchronous duplicate clicks', async () => {
  const env = setup(),
    gate = later();
  env.setOperation(() => gate.promise);
  const first = env.recovery.logout(),
    second = env.recovery.logout();
  assert.equal(first, second);
  assert.equal(env.calls.logout, 1);
  gate.reject(new Error('offline'));
  await assert.rejects(first);
  const retryGate = later();
  env.setOperation(() => retryGate.promise);
  const id = env.recovery.getSnapshot().failureId;
  const retry = env.recovery.retry(id),
    duplicate = env.recovery.retry(id);
  assert.equal(retry, duplicate);
  assert.equal(env.calls.logout, 2);
  retryGate.resolve();
  await retry;
  env.unsubscribe();
});
test('a new login cannot overtake a pending cookie-mutating logout', async () => {
  const env = setup(),
    gate = later();
  env.setOperation(() => gate.promise);
  const logout = env.recovery.logout();
  await assert.rejects(env.recovery.login(), { kind: 'busy' });
  assert.equal(env.calls.login, 0);
  gate.reject(new Error('offline'));
  await assert.rejects(logout);
  await env.recovery.login();
  assert.equal(env.source.getSnapshot().user.id, 3);
  assert.equal(env.recovery.getSnapshot().error, '');
  env.unsubscribe();
});
test('stale retry callbacks cannot log out a newly authenticated owner', async () => {
  const env = setup();
  await assert.rejects(env.recovery.logout());
  const oldId = env.recovery.getSnapshot().failureId;
  await env.recovery.login();
  await assert.rejects(env.recovery.retry(oldId), { kind: 'cancelled' });
  assert.equal(env.calls.logout, 1);
  assert.equal(env.source.getSnapshot().user.id, 3);
  env.unsubscribe();
});
test('late logout failure does not overwrite a newer externally verified identity', async () => {
  const env = setup(),
    gate = later();
  env.setOperation(() => gate.promise);
  const request = env.recovery.logout();
  env.publish({
    authenticated: true,
    phase: 'authenticated',
    role: 'STORE_ADMIN',
    user: { id: 2, role: 'STORE_ADMIN' },
  });
  gate.reject(new Error('late'));
  await assert.rejects(request);
  assert.equal(env.recovery.getSnapshot().phase, 'idle');
  assert.equal(env.recovery.getSnapshot().error, '');
  assert.equal(env.source.getSnapshot().user.id, 2);
  env.unsubscribe();
});
test('an old retry cannot operate during another login or a newer failure', async () => {
  const env = setup();
  await assert.rejects(env.recovery.logout());
  const oldId = env.recovery.getSnapshot().failureId;
  env.publish({ authenticated: false, phase: 'authenticating' });
  await assert.rejects(env.recovery.retry(oldId), { kind: 'cancelled' });
  env.publish({ authenticated: false, phase: 'anonymous' });
  await assert.rejects(env.recovery.retry(oldId));
  await assert.rejects(env.recovery.retry(oldId), { kind: 'cancelled' });
  assert.equal(env.calls.logout, 2);
  env.unsubscribe();
});
