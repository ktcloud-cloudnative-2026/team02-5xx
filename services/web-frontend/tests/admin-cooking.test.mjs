import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createCookingApi,
  validateCooking,
  isCookingTime,
  CookingError,
  COOKING_ENDPOINTS,
} from '../src/admin-cooking/cookingApi.js';
import {
  createCookingStore,
  COOKING_POLL_MS,
} from '../src/admin-cooking/cookingStore.js';
import {
  cookingKst,
  cookingDuration,
  cookingDisagreement,
} from '../src/admin-cooking/cookingView.js';
import {
  startCookingFixture,
  cookingSample,
} from './admin-cooking-fixture.mjs';
let fixture;
before(async () => {
  fixture = await startCookingFixture();
});
after(async () => {
  await fixture?.close();
});
const api = (options = {}) =>
  createCookingApi({
    request: (path, init) => fetch(fixture.url + path, init),
    ...options,
  });
const later = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((done) => setImmediate(done));
for (const area of Object.keys(COOKING_ENDPOINTS))
  test(`HTTP ${area}: actual GET contract, no forged identity, whitelist`, async () => {
    fixture.reset();
    const data = await api().get(area);
    assert.deepEqual(data, cookingSample()[area]);
    const req = fixture.controls.requests.at(-1);
    assert.equal(req.path, COOKING_ENDPOINTS[area]);
    assert.equal(req.method, 'GET');
    assert.equal(req.headers['x-user-id'], undefined);
    assert.equal(req.headers['x-user-role'], undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.ok(Object.isFrozen(data));
    assert.deepEqual(Object.keys(api()), ['get']);
  });
test('credentials and redirect policy separate public CO-01 from administrator reads', async () => {
  const calls = [];
  const client = createCookingApi({
    request: (path, init) => {
      calls.push(init);
      return fetch(fixture.url + path, init);
    },
  });
  await client.get('congestion');
  await client.get('overview');
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[1].credentials, 'same-origin');
  assert.ok(
    calls.every(
      (call) => call.redirect === 'error' && call.cache === 'no-store',
    ),
  );
});
test('server FIFO ties preserve position even when orderId decreases', async () => {
  fixture.reset();
  const data = await api().get('queue');
  assert.deepEqual(
    data.items.slice(0, 2).map((item) => item.orderId),
    [205, 201],
  );
  assert.equal(
    Date.parse(data.items[0].queuedAt),
    Date.parse(data.items[1].queuedAt),
  );
});
test('empty list, null/omitted representative number, multiple cooking orders remain honest', async () => {
  fixture.reset('empty');
  assert.deepEqual(await api().get('queue'), { count: 0, items: [] });
  assert.equal((await api().get('overview')).cookingOrderNo, null);
  fixture.reset('omitted');
  assert.equal((await api().get('overview')).cookingCount, 1);
  assert.equal((await api().get('overview')).cookingOrderNo, null);
  const data = cookingSample().overview;
  data.cookingOrderNo = null;
  assert.equal(validateCooking('overview', data).cookingOrderNo, null);
  fixture.reset('multiple');
  assert.equal((await api().get('overview')).cookingCount, 3);
});
for (const status of [400, 401, 403, 404, 500, 503])
  test(`HTTP ${status}: one request, explicit error without automatic retry`, async () => {
    fixture.reset();
    fixture.controls.overrides.set('overview', { status });
    await assert.rejects(
      api().get('overview'),
      (error) => error instanceof CookingError && error.status === status,
    );
    assert.equal(fixture.controls.requests.length, 1);
  });
test('network failure and invalid JSON are explicit, never replaced by empty data', async () => {
  await assert.rejects(
    createCookingApi({
      request: async () => {
        throw new TypeError('network');
      },
    }).get('queue'),
    (error) => error.kind === 'network',
  );
  fixture.reset();
  fixture.controls.overrides.set('queue', { raw: 'not json' });
  await assert.rejects(
    api().get('queue'),
    (error) => error.kind === 'protocol',
  );
});
test('HTTP deadline and caller cancellation are distinct; no replay', async () => {
  fixture.reset();
  fixture.controls.overrides.set('queue', { delay: 100 });
  await assert.rejects(
    api({ timeoutMs: 25 }).get('queue'),
    (error) => error.kind === 'timeout',
  );
  assert.equal(fixture.controls.requests.length, 1);
  const controller = new AbortController();
  const flight = api().get('queue', { signal: controller.signal });
  controller.abort();
  await assert.rejects(flight, { name: 'AbortError' });
});
test('unknown resource never sends an HTTP request', async () => {
  let count = 0;
  await assert.rejects(
    createCookingApi({
      request: () => {
        count++;
      },
    }).get('start'),
  );
  assert.equal(count, 0);
});
for (const [label, respond] of [
  [
    'unsuccessful envelope',
    () =>
      Response.json({
        success: false,
        data: cookingSample().overview,
        message: 'bad',
      }),
  ],
  [
    'missing message',
    () => Response.json({ success: true, data: cookingSample().overview }),
  ],
  ['no content', () => new Response(null, { status: 204 })],
  ['missing data', () => Response.json({ success: true, message: 'OK' })],
])
  test(`invalid successful response: ${label}`, async () => {
    await assert.rejects(
      createCookingApi({ request: async () => respond() }).get('overview'),
      (error) => error.kind === 'protocol',
    );
  });
const malformed = [
  [
    'congestion',
    (data) => {
      data.level = 'BUSY';
    },
  ],
  [
    'congestion',
    (data) => {
      data.waitingCount = -1;
    },
  ],
  [
    'congestion',
    (data) => {
      data.expectedWaitSec = '60';
    },
  ],
  [
    'overview',
    (data) => {
      delete data.completedToday;
    },
  ],
  [
    'overview',
    (data) => {
      data.canceledToday = -1;
    },
  ],
  [
    'overview',
    (data) => {
      data.cookingCount = 1.5;
    },
  ],
  [
    'overview',
    (data) => {
      data.expectedWaitSec = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'overview',
    (data) => {
      data.cookingOrderNo = ' ';
    },
  ],
  [
    'queue',
    (data) => {
      data.count = 9;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[1].position = 1;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[0].orderId = 0;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[1].orderId = data.items[0].orderId;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[1].orderNo = data.items[0].orderNo;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[0].orderNo = '';
    },
  ],
  [
    'queue',
    (data) => {
      data.items[1].queuedAt = '2026-11-24T11:00:00+09:00';
    },
  ],
  [
    'queue',
    (data) => {
      data.items[0].queuedAt = '2026-02-30T03:00:00Z';
    },
  ],
  [
    'queue',
    (data) => {
      data.items[0].estimatedCookSec = -1;
    },
  ],
  [
    'queue',
    (data) => {
      data.items[0].estimatedCookSec = 2147483648;
    },
  ],
];
for (const [index, [area, mutate]] of malformed.entries())
  test(`malformed DTO ${area}/${index} rejected`, () => {
    const data = cookingSample()[area];
    mutate(data);
    assert.throws(
      () => validateCooking(area, data),
      (error) => error.kind === 'protocol',
    );
  });
test('ISO calendar/timezone validation and subsecond timestamps', () => {
  for (const value of [
    null,
    '2026-02-30T03:00:00Z',
    '2026-11-24T24:00:00Z',
    '2026-11-24T12:00:00',
    '2026-11-24T12:00:00+18:01',
  ])
    assert.equal(isCookingTime(value), false);
  assert.equal(isCookingTime('2026-11-24T12:00:00.123456789+09:00'), true);
});
test('KST midnight and seconds have precise meanings, no client completion ETA', () => {
  assert.match(
    cookingKst('2026-11-23T15:00:00Z'),
    /2026.*11.*24.*00:00:00 KST/,
  );
  assert.equal(cookingDuration(0), '0초');
  assert.equal(cookingDuration(91), '1분 31초');
  assert.equal(cookingDuration(null), '—');
});
function setup() {
  const timers = new Map(),
    calls = [];
  let timerId = 0;
  const sample = cookingSample();
  const backend = {
    get: async (area, options) => {
      calls.push({ area, ...options });
      return structuredClone(sample[area]);
    },
  };
  const store = createCookingStore(backend, {
    now: () => 1000,
    setTimer: (callback, ms) => {
      const id = ++timerId;
      timers.set(id, {
        ms,
        fire() {
          timers.delete(id);
          callback();
        },
      });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return { store, backend, timers, calls };
}
async function start(env) {
  env.store.setActive(true);
  await env.store.refreshAll();
}
test('initial activation deduplicates manual reads and polls each successful area after 30s', async () => {
  const env = setup();
  await start(env);
  assert.equal(env.calls.length, 3);
  assert.equal(env.timers.size, 3);
  assert.equal(COOKING_POLL_MS, 30000);
  assert.ok([...env.timers.values()].every((timer) => timer.ms === 30000));
  env.timers.values().next().value.fire();
  await tick();
  assert.equal(env.calls.length, 4);
  env.store.dispose();
  assert.equal(env.timers.size, 0);
});
test('partial error preserves prior snapshot and stops only the failing timer', async () => {
  const env = setup();
  await start(env);
  env.backend.get = async () => {
    throw new CookingError('http', '503', 503);
  };
  await env.store.refresh('queue');
  assert.equal(env.store.getSnapshot().queue.data.count, 8);
  assert.equal(env.store.getSnapshot().queue.stale, true);
  assert.equal(env.store.getSnapshot().overview.data.completedToday, 42);
  assert.equal(env.timers.size, 2);
  env.store.dispose();
});
for (const status of [401, 403])
  test(`denied ${status} drops old private data and retains other areas`, async () => {
    const env = setup();
    await start(env);
    env.backend.get = async () => {
      throw new CookingError('http', 'denied', status);
    };
    await env.store.refresh('overview');
    assert.equal(env.store.getSnapshot().overview.data, null);
    assert.equal(env.store.getSnapshot().overview.stale, false);
    assert.equal(env.store.getSnapshot().queue.data.count, 8);
    env.store.dispose();
  });
test('retry restores failed data and its polling independently', async () => {
  const env = setup();
  env.backend.get = async (area) => {
    if (area === 'queue') throw new CookingError('network', 'offline');
    return cookingSample()[area];
  };
  await start(env);
  assert.equal(env.store.getSnapshot().queue.data, null);
  assert.equal(env.timers.size, 2);
  env.backend.get = async (area) => cookingSample()[area];
  await env.store.refresh('queue');
  assert.equal(env.store.getSnapshot().queue.data.count, 8);
  assert.equal(env.timers.size, 3);
  env.store.dispose();
});
test('concurrent manual refreshes share the exact pending promise', async () => {
  const gate = later(),
    env = setup();
  await start(env);
  env.backend.get = () => gate.promise;
  const first = env.store.refresh('queue'),
    second = env.store.refresh('queue');
  assert.equal(first, second);
  gate.resolve(cookingSample().queue);
  await first;
  env.store.dispose();
});
test('hidden pauses timers/GETs and abort-ignoring old responses cannot overwrite visible re-entry', async () => {
  const old = later(),
    env = setup();
  await start(env);
  let signal;
  env.backend.get = (area, options) => {
    signal = options.signal;
    return old.promise;
  };
  const pending = env.store.refresh('queue');
  await tick();
  env.store.setActive(false);
  assert.equal(signal.aborted, true);
  assert.equal(env.timers.size, 0);
  env.backend.get = async (area) => cookingSample('empty')[area];
  await start(env);
  old.resolve(cookingSample().queue);
  await pending;
  assert.equal(env.store.getSnapshot().queue.data.count, 0);
  env.store.dispose();
});
test('StrictMode activation-cleanup before microtask dispatches only live requests', async () => {
  const env = setup();
  env.store.setActive(true);
  env.store.dispose();
  env.store.setActive(true);
  await env.store.refreshAll();
  assert.equal(env.calls.length, 3);
  env.store.dispose();
});
test('unmount rejects late response application and clears all timers', async () => {
  const gate = later(),
    env = setup();
  await start(env);
  env.backend.get = () => gate.promise;
  const flight = env.store.refresh('queue');
  await tick();
  env.store.dispose();
  gate.resolve(cookingSample('empty').queue);
  await flight;
  assert.equal(env.store.getSnapshot().queue.data.count, 8);
  assert.equal(env.store.getSnapshot().queue.phase, 'paused');
  assert.equal(env.timers.size, 0);
});
test('cross-query mismatches are an explanatory notice, not a fabricated merged snapshot', () => {
  const make = (scenario) =>
    Object.fromEntries(
      Object.entries(cookingSample(scenario)).map(([area, data]) => [
        area,
        { data },
      ]),
    );
  assert.equal(cookingDisagreement(make('normal')), false);
  assert.equal(cookingDisagreement(make('mismatch')), true);
  const missing = make('normal');
  missing.overview.data = null;
  assert.equal(cookingDisagreement(missing), false);
});
test('customer product entry has no cooking preview import or administrator route', async () => {
  const text = await readFile(
    new URL('../src/App.jsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(text, /admin-cooking|CookingPage|__cooking/);
});
