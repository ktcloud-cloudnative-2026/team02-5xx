import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminMenuAccess } from '../src/data/admin/adminMenuAccess.js';
const later = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const denied = (status) => Object.assign(new Error('denied'), { status });
function setup() {
  const calls = [],
    handlers = {};
  const adapter = { kind: 'http' };
  for (const name of ['list', 'detail', 'create', 'update', 'changeStatus'])
    adapter[name] = async (...args) => {
      calls.push([name, ...args]);
      return handlers[name]
        ? handlers[name](...args)
        : { success: true, data: { menus: [], categories: [] } };
    };
  const gate = createAdminMenuAccess(adapter);
  return { calls, handlers, gate, api: gate.adapter };
}
for (const status of [401, 403])
  test(`${status} revokes all row/modal operations until a successful new list`, async () => {
    const env = setup();
    await env.api.list();
    env.handlers.list = async () => {
      throw denied(status);
    };
    await assert.rejects(env.api.list(), { status });
    assert.equal(env.gate.getSnapshot().denied, true);
    const count = env.calls.length;
    for (const method of ['detail', 'create', 'update', 'changeStatus'])
      await assert.rejects(env.api[method](1), { name: 'AbortError' });
    assert.equal(env.calls.length, count);
    delete env.handlers.list;
    await env.api.list();
    assert.equal(env.gate.getSnapshot().denied, false);
    await env.api.detail(1);
  });
for (const method of ['detail', 'create', 'update', 'changeStatus'])
  test(`${method} permission error revokes the page without repeating the request`, async () => {
    const env = setup();
    env.handlers[method] = async () => {
      throw denied(403);
    };
    await assert.rejects(env.api[method](1), { status: 403 });
    assert.equal(env.calls.length, 1);
    assert.equal(env.gate.getSnapshot().denied, true);
  });
for (const method of ['detail', 'create', 'update', 'changeStatus'])
  test(`late ${method} success cannot survive permission loss and recovery`, async () => {
    const env = setup(),
      old = later();
    env.handlers[method] = () => old.promise;
    const pending = env.api[method](1);
    env.handlers.list = async () => {
      throw denied(403);
    };
    await assert.rejects(env.api.list());
    delete env.handlers.list;
    await env.api.list();
    old.resolve({ data: { id: 1 } });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(env.gate.getSnapshot().denied, false);
  });
test('late list success cannot remove a denial produced by another resource', async () => {
  const env = setup(),
    old = later();
  env.handlers.list = () => old.promise;
  const pending = env.api.list();
  env.handlers.detail = async () => {
    throw denied(403);
  };
  await assert.rejects(env.api.detail(1));
  old.resolve({ data: { menus: [{ id: 1 }] } });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(env.gate.getSnapshot().denied, true);
});
test('obsolete and aborted list errors cannot revoke a newer successful query', async () => {
  const env = setup(),
    old = later();
  env.handlers.list = () => old.promise;
  const controller = new AbortController();
  const pending = env.api.list({}, { signal: controller.signal });
  controller.abort();
  delete env.handlers.list;
  await env.api.list();
  old.reject(denied(403));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(env.gate.getSnapshot().denied, false);
});
for (const status of [0, 500, 503])
  test(`non-auth error ${status} preserves permission and is not replayed`, async () => {
    const env = setup();
    env.handlers.list = async () => {
      throw Object.assign(new Error('unavailable'), { status });
    };
    await assert.rejects(env.api.list());
    assert.equal(env.gate.getSnapshot().denied, false);
    assert.equal(env.calls.length, 1);
  });
test('StrictMode disposal prevents old results and new dispatches, activation permits a new list', async () => {
  const env = setup(),
    old = later();
  env.handlers.list = () => old.promise;
  const pending = env.api.list();
  env.gate.dispose();
  await assert.rejects(env.api.list(), { name: 'AbortError' });
  await assert.rejects(env.api.detail(1), { name: 'AbortError' });
  assert.equal(env.calls.length, 1);
  env.gate.activate();
  delete env.handlers.list;
  await env.api.list();
  old.resolve({ data: {} });
  await assert.rejects(pending, { name: 'AbortError' });
});
