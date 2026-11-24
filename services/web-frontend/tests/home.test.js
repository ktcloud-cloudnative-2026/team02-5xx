import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCongestionApi,
  CongestionError,
  validateCongestion,
  formatWait,
} from '../src/home/congestionApi.js';
import { createCongestionStore } from '../src/home/congestionStore.js';

const normal = {
  level: 'NORMAL',
  waitingCount: 0,
  cookingCount: 0,
  expectedWaitSec: 0,
};
const crowded = {
  level: 'CROWDED',
  waitingCount: 12,
  cookingCount: 1,
  expectedWaitSec: 901,
};
const response = (data) =>
  new Response(JSON.stringify({ success: true, data, message: 'OK' }), {
    headers: { 'Content-Type': 'application/json' },
  });
test('CO-01 uses exact public GET without cookies, token, body or identity headers', async () => {
  const calls = [];
  const api = createCongestionApi({
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(crowded);
    },
  });
  assert.deepEqual(await api.get(), crowded);
  assert.equal(calls[0][0], '/api/v1/cooking/congestion');
  const options = calls[0][1];
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.deepEqual(options.headers, { Accept: 'application/json' });
  assert.equal(options.body, undefined);
});
test('CO-01 preserves NORMAL/zero and CROWDED; formats start wait without rounding to zero', () => {
  assert.deepEqual(validateCongestion(normal), normal);
  assert.deepEqual(validateCongestion(crowded), crowded);
  assert.equal(formatWait(0), '0초');
  assert.equal(formatWait(1), '1초');
  assert.equal(formatWait(61), '1분 1초');
  assert.equal(formatWait(120), '2분');
});
for (const data of [
  null,
  {},
  { ...normal, level: 'QUIET' },
  { ...normal, level: null },
  ...['waitingCount', 'cookingCount', 'expectedWaitSec'].flatMap((key) =>
    [
      undefined,
      -1,
      1.5,
      '0',
      null,
      true,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((value) => ({ ...normal, [key]: value })),
  ),
]) {
  test(`CO-01 rejects invalid data ${JSON.stringify(data)}`, () => {
    assert.throws(() => validateCongestion(data), { code: 'INVALID_RESPONSE' });
  });
}
for (const status of [401, 403, 404, 500, 503])
  test(`CO-01 HTTP ${status} never invents NORMAL or retries`, async () => {
    let calls = 0;
    const api = createCongestionApi({
      fetchImpl: async () => {
        calls++;
        return new Response('upstream error', { status });
      },
    });
    await assert.rejects(api.get(), { code: 'HTTP_ERROR', status });
    assert.equal(calls, 1);
  });
for (const body of [
  '{',
  'null',
  JSON.stringify({ success: false, data: normal, message: 'no' }),
  JSON.stringify({ success: true, data: normal }),
]) {
  test(`CO-01 rejects malformed envelope ${body}`, async () => {
    await assert.rejects(
      createCongestionApi({ fetchImpl: async () => new Response(body) }).get(),
      { code: 'INVALID_RESPONSE' },
    );
  });
}
test('CO-01 network failure, timeout, caller cancellation and explicit retry remain distinct', async () => {
  let calls = 0;
  const api = createCongestionApi({
    fetchImpl: async () => {
      if (++calls === 1) throw new TypeError('network');
      return response(normal);
    },
  });
  await assert.rejects(api.get(), { code: 'NETWORK_ERROR' });
  assert.deepEqual(await api.get(), normal);
  const slow = createCongestionApi({
    timeoutMs: 5,
    fetchImpl: (_, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  // Keep the loop alive while AbortSignal.timeout's unref timer runs.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(slow.get(), { code: 'TIMEOUT' });
    const abort = new AbortController(),
      operation = slow.get({ signal: abort.signal });
    abort.abort(new DOMException('closed', 'AbortError'));
    await assert.rejects(operation, { name: 'AbortError' });
  } finally {
    clearTimeout(keepAlive);
  }
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(api) {
  const timers = new Map();
  let number = 0;
  const store = createCongestionStore({
    api,
    intervalMs: 30000,
    clock: () => 123,
    setTimer: (fn, ms) => {
      assert.equal(ms, 30000);
      timers.set(++number, fn);
      return number;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    store,
    timers,
    fire() {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    },
  };
}
test('home polling is single-flight, 30s after completion, pauses hidden and refreshes on return', async () => {
  let calls = 0,
    resolve;
  const h = harness({
    get: () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  h.store.setActive(true);
  h.store.refresh();
  h.store.refresh();
  assert.equal(calls, 1);
  assert.equal(h.timers.size, 0);
  resolve(normal);
  await tick();
  assert.equal(h.store.getSnapshot().updatedAt, 123);
  assert.equal(h.timers.size, 1);
  h.fire();
  assert.equal(calls, 2);
  h.store.setActive(false);
  resolve(crowded);
  await tick();
  assert.deepEqual(h.store.getSnapshot().data, normal);
  assert.equal(h.timers.size, 0);
  h.store.setActive(true);
  assert.equal(calls, 3);
  resolve(crowded);
  await tick();
  assert.deepEqual(h.store.getSnapshot().data, crowded);
  h.store.dispose();
  assert.equal(h.timers.size, 0);
});
test('poll error keeps explicitly stale data, stops timers and supports explicit retry', async () => {
  let failure = false;
  const h = harness({
    get: async () => {
      if (failure) throw new CongestionError('HTTP_ERROR', 'failed');
      return normal;
    },
  });
  h.store.setActive(true);
  await tick();
  failure = true;
  h.fire();
  await tick();
  assert.equal(h.store.getSnapshot().phase, 'error');
  assert.equal(h.store.getSnapshot().stale, true);
  assert.deepEqual(h.store.getSnapshot().data, normal);
  assert.equal(h.timers.size, 0);
  failure = false;
  await h.store.refresh();
  assert.equal(h.store.getSnapshot().stale, false);
  assert.equal(h.timers.size, 1);
  h.store.dispose();
});
test('abort-ignoring old success/error cannot replace new view or resurrect a disposed view', async () => {
  const requests = [];
  const h = harness({
    get: ({ signal }) =>
      new Promise((resolve, reject) =>
        requests.push({ resolve, reject, signal }),
      ),
  });
  h.store.setActive(true);
  h.store.setActive(false);
  h.store.setActive(true);
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve(crowded);
  await tick();
  requests[0].resolve(normal);
  await tick();
  assert.deepEqual(h.store.getSnapshot().data, crowded);
  h.fire();
  h.store.dispose();
  const state = h.store.getSnapshot();
  requests[2].reject(new Error('late'));
  await tick();
  assert.equal(h.store.getSnapshot(), state);
  assert.equal(h.timers.size, 0);
});
