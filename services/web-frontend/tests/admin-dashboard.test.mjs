import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDashboardApi,
  validateDashboard,
  dashboardTime,
  DashboardError,
  DASHBOARD_PATHS,
  DASHBOARD_RESOURCES,
} from '../src/admin-dashboard/dashboardApi.js';
import {
  createDashboardStore,
  DASHBOARD_POLL_MS,
} from '../src/admin-dashboard/dashboardStore.js';
import {
  dashboardSample,
  startDashboardFixture,
} from './admin-dashboard-fixture.mjs';

let fixture;
before(async () => {
  fixture = await startDashboardFixture();
});
after(async () => {
  await fixture?.close();
});
const api = (options = {}) =>
  createDashboardApi({
    request: (path, init) => fetch(`${fixture.origin}${path}`, init),
    ...options,
  });
const clone = (value) => structuredClone(value);
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

for (const resource of DASHBOARD_RESOURCES)
  test(`HTTP ${resource}: actual path, envelope and validated fields`, async () => {
    fixture.reset();
    const data = await api().read(resource);
    const request = fixture.controls.requests.at(-1);
    assert.equal(request.method, 'GET');
    assert.equal(request.resource, resource);
    assert.equal(request.headers['x-user-id'], undefined);
    assert.equal(request.headers['x-user-role'], undefined);
    assert.equal(request.headers.authorization, undefined);
    if (resource === 'menus') assert.equal(data[0].name, '트러플 버섯 덮밥');
    else
      assert.deepEqual(
        data,
        resource === 'overview'
          ? {
              ...dashboardSample()[resource],
              cookingOrderNo: 'P-20261124-0100',
            }
          : dashboardSample()[resource],
      );
  });
test('IN-02 uses lowStockOnly=true; queue preserves equal-time FIFO instead of sorting order IDs', async () => {
  const paths = [];
  const client = createDashboardApi({
    request: (path, init) => {
      paths.push(path);
      return fetch(`${fixture.origin}${path}`, init);
    },
  });
  await client.read('stock');
  assert.equal(paths[0], '/api/v1/admin/inventory/items?lowStockOnly=true');
  assert.deepEqual(
    (await client.read('queue')).items.map((item) => item.orderId),
    [301, 299, 305],
  );
});
for (const field of ['isOpen', 'acceptingOrders'])
  test(`OR-07 sends only ${field}, independent switches`, async () => {
    fixture.reset();
    const data = await api().update(field, false);
    assert.deepEqual(fixture.controls.requests.at(-1).body, { [field]: false });
    assert.equal(data[field], false);
    assert.equal(data[field === 'isOpen' ? 'acceptingOrders' : 'isOpen'], true);
    assert.equal(fixture.controls.writeCount, 1);
  });
for (const [field, value] of [
  ['isOpen', null],
  ['isOpen', 0],
  ['isOpen', 'false'],
  ['open', true],
  ['acceptingOrders', undefined],
])
  test(`invalid mutation ${field}/${value} never dispatches`, () => {
    let calls = 0;
    const client = createDashboardApi({
      request: () => {
        calls++;
      },
    });
    assert.throws(() => client.update(field, value));
    assert.equal(calls, 0);
  });
for (const status of [400, 401, 403, 404, 503])
  test(`HTTP ${status} is explicit; PATCH is sent once`, async () => {
    fixture.reset();
    fixture.controls.overrides.set('operations', status);
    await assert.rejects(
      api().update('isOpen', false),
      (error) =>
        error instanceof DashboardError &&
        error.status === status &&
        error.uncertain === status >= 500,
    );
    assert.equal(fixture.controls.writeCount, 1);
  });
test('network failure, malformed JSON and mismatched PATCH result are uncertain; no automatic replay', async () => {
  for (const request of [
    async () => {
      throw new TypeError('network');
    },
    async () => new Response('oops', { status: 200 }),
    async () =>
      Response.json({
        success: true,
        data: dashboardSample().operations,
        message: 'OK',
      }),
  ]) {
    let calls = 0;
    const client = createDashboardApi({
      request: (...args) => {
        calls++;
        return request(...args);
      },
    });
    await assert.rejects(
      client.update('isOpen', false),
      (error) => error.uncertain === true,
    );
    assert.equal(calls, 1);
  }
});
test('HTTP write timeout remains uncertain and read timeout is local to its resource', async () => {
  fixture.reset();
  fixture.controls.delays.set('operations', 150);
  await assert.rejects(
    api({ timeoutMs: 25 }).update('isOpen', false),
    (error) => error.kind === 'timeout' && error.uncertain,
  );
  assert.equal(fixture.controls.writeCount, 1);
  fixture.controls.delays.set('queue', 150);
  await assert.rejects(
    api({ timeoutMs: 25 }).read('queue'),
    (error) => error.kind === 'timeout' && !error.uncertain,
  );
});
test('caller cancellation is preserved, never mapped to a successful read', async () => {
  fixture.reset();
  fixture.controls.delays.set('queue', 100);
  const controller = new AbortController();
  const flight = api().read('queue', { signal: controller.signal });
  controller.abort();
  await assert.rejects(flight, { name: 'AbortError' });
});
test('empty queue, no shortage and omitted cookingOrderNo are valid absence', async () => {
  fixture.reset('empty');
  const client = api();
  assert.deepEqual(await client.read('queue'), { count: 0, items: [] });
  assert.deepEqual(await client.read('stock'), []);
  assert.equal((await client.read('overview')).cookingOrderNo, null);
});
test('nullable operation timestamp is absence, never generated server time', () => {
  assert.equal(
    validateDashboard('operations', {
      isOpen: false,
      acceptingOrders: true,
      updatedAt: null,
    }).updatedAt,
    null,
  );
});
for (const [resource, mutate, index] of [
  [
    'operations',
    (d) => {
      d.isOpen = 'true';
    },
  ],
  [
    'operations',
    (d) => {
      delete d.acceptingOrders;
    },
  ],
  [
    'operations',
    (d) => {
      d.updatedAt = '2026-02-30T12:00:00+09:00';
    },
  ],
  [
    'congestion',
    (d) => {
      d.level = 'BUSY';
    },
  ],
  [
    'congestion',
    (d) => {
      d.waitingCount = -1;
    },
  ],
  [
    'congestion',
    (d) => {
      d.expectedWaitSec = 1.2;
    },
  ],
  [
    'overview',
    (d) => {
      delete d.completedToday;
    },
  ],
  [
    'overview',
    (d) => {
      d.cookingCount = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'overview',
    (d) => {
      d.cookingOrderNo = '';
    },
  ],
  [
    'queue',
    (d) => {
      d.count = 2;
    },
  ],
  [
    'queue',
    (d) => {
      d.items[1].position = 1;
    },
  ],
  [
    'queue',
    (d) => {
      d.items[1].orderId = d.items[0].orderId;
    },
  ],
  [
    'queue',
    (d) => {
      d.items[1].orderNo = d.items[0].orderNo;
    },
  ],
  [
    'queue',
    (d) => {
      d.items[1].queuedAt = '2026-11-24T11:00:00+09:00';
    },
  ],
  [
    'queue',
    (d) => {
      d.items[0].estimatedCookSec = -1;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].availableQty = 9;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].menuId = 0;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].reservedQty = 10;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].lowStock = false;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].lowStockThreshold = 0;
    },
  ],
  [
    'stock',
    (d) => {
      d[1].stockItemId = d[0].stockItemId;
    },
  ],
  [
    'stock',
    (d) => {
      d[0].stockQty = 2147483648;
    },
  ],
].map(([resource, mutate], index) => [resource, mutate, index]))
  test(`reject malformed ${resource} DTO ${index}`, () => {
    const data = clone(dashboardSample()[resource]);
    mutate(data);
    assert.throws(
      () => validateDashboard(resource, data),
      (error) => error.kind === 'protocol',
    );
  });
test('timestamps require valid calendar date, timezone and clock', () => {
  for (const value of [
    '2026-02-30T12:00:00+09:00',
    '2026-11-24T24:00:00Z',
    '2026-11-24T12:00:00',
    '2026-11-24T12:00:00+19:00',
    null,
  ])
    assert.equal(dashboardTime(value), false);
  assert.equal(dashboardTime('2026-11-24T12:00:00.123456789+09:00'), true);
});
test('public catalogue failure does not invent names or affect inventory', async () => {
  fixture.reset('menu-error');
  const client = api();
  await assert.rejects(client.read('menus'));
  assert.equal((await client.read('stock'))[0].availableQty, 2);
});
function setup(overrides = {}) {
  const timers = new Map();
  let next = 0;
  const calls = [];
  let data = dashboardSample();
  const fake = {
    read: async (key, options) => {
      calls.push({ key, ...options });
      return clone(key === 'menus' ? data.menus.menus : data[key]);
    },
    update: async (field, value) => {
      data.operations = { ...data.operations, [field]: value };
      return clone(data.operations);
    },
    ...overrides,
  };
  const store = createDashboardStore(fake, {
    now: () => 1234,
    setTimer: (fn, ms) => {
      const id = ++next;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    store,
    timers,
    calls,
    fake,
    setData: (value) => {
      data = value;
    },
  };
}
async function start(env) {
  env.store.start();
  await env.store.refreshAll();
}
test('initial read deduplicates; 30s completion polling only for successful regions', async () => {
  const env = setup();
  await start(env);
  assert.equal(env.calls.length, 6);
  assert.equal(env.timers.size, 6);
  assert.equal(DASHBOARD_POLL_MS, 30000);
  assert.ok([...env.timers.values()].every((timer) => timer.ms === 30000));
  const poll = env.timers.values().next().value;
  env.timers.delete(env.timers.keys().next().value);
  poll.fn();
  await tick();
  assert.equal(env.calls.length, 7);
  env.store.dispose();
  assert.equal(env.timers.size, 0);
});
test('one failed resource retains its previous data and does not erase successful KPIs', async () => {
  const env = setup();
  await start(env);
  env.fake.read = async (key) => {
    if (key === 'queue') throw new DashboardError('503', { status: 503 });
    return dashboardSample()[key];
  };
  await env.store.refresh('queue');
  const state = env.store.getSnapshot();
  assert.equal(state.resources.queue.data.count, 3);
  assert.equal(state.resources.queue.stale, true);
  assert.equal(state.resources.overview.data.completedToday, 42);
  assert.equal(env.timers.size, 5);
  env.store.dispose();
});
for (const status of [401, 403])
  test(`resource ${status} clears only denied data`, async () => {
    const env = setup();
    await start(env);
    env.fake.read = async () => {
      throw new DashboardError('denied', { status });
    };
    await env.store.refresh('queue');
    assert.equal(env.store.getSnapshot().resources.queue.data, null);
    assert.equal(env.store.getSnapshot().resources.stock.data.length, 4);
    env.store.dispose();
  });
test('manual retry restores failed region and resumes its polling', async () => {
  const env = setup({
    read: async (key) => {
      if (key === 'queue') throw new Error('offline');
      return dashboardSample()[key];
    },
  });
  await start(env);
  assert.equal(env.store.getSnapshot().resources.queue.phase, 'error');
  assert.equal(env.timers.size, 5);
  env.fake.read = async (key) => dashboardSample()[key];
  await env.store.refresh('queue');
  assert.equal(env.store.getSnapshot().resources.queue.phase, 'ready');
  assert.equal(env.timers.size, 6);
  env.store.dispose();
});
test('visibility and disposal abort all GETs, stop timers and suppress old response', async () => {
  const gate = deferred();
  const env = setup({
    read: (key, { signal }) => {
      env.calls.push({ key, signal });
      return key === 'queue'
        ? gate.promise
        : Promise.resolve(dashboardSample()[key]);
    },
  });
  env.store.start();
  await tick();
  const oldSignal = env.calls.find((call) => call.key === 'queue').signal;
  env.store.setVisible(false);
  assert.equal(oldSignal.aborted, true);
  assert.equal(env.timers.size, 0);
  gate.resolve({ count: 99, items: [] });
  await tick();
  assert.equal(env.store.getSnapshot().resources.queue.data, null);
  env.fake.read = async (key) => dashboardSample()[key];
  env.store.setVisible(true);
  await env.store.refreshAll();
  assert.equal(env.store.getSnapshot().resources.queue.data.count, 3);
  env.store.dispose();
  assert.equal(env.timers.size, 0);
});
test('StrictMode setup/cleanup avoids obsolete dispatch and late update after restart', async () => {
  const gate = deferred();
  const env = setup();
  env.store.start();
  env.store.dispose();
  await tick();
  assert.equal(env.calls.length, 0);
  env.fake.read = (key) =>
    key === 'queue' ? gate.promise : Promise.resolve(dashboardSample()[key]);
  env.store.start();
  await tick();
  env.store.dispose();
  env.fake.read = async (key) => dashboardSample()[key];
  await start(env);
  gate.resolve({ count: 99 });
  await tick();
  assert.equal(env.store.getSnapshot().resources.queue.data.count, 3);
  env.store.dispose();
});
test('PATCH locks both controls, cancels old operations GET and applies authoritative response once', async () => {
  const patch = deferred(),
    read = deferred();
  let writes = 0;
  const env = setup({
    update: () => {
      writes++;
      return patch.promise;
    },
  });
  await start(env);
  env.fake.read = (key) =>
    key === 'operations'
      ? read.promise
      : Promise.resolve(dashboardSample()[key]);
  const refresh = env.store.refresh('operations');
  await tick();
  // A mutation is blocked while a fresh operations read is in progress.
  await assert.rejects(
    env.store.change('isOpen', false),
    (error) => error.kind === 'busy',
  );
  read.resolve(dashboardSample().operations);
  await refresh;
  const change = env.store.change('isOpen', false);
  await assert.rejects(env.store.change('acceptingOrders', false));
  assert.equal(writes, 1);
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, true);
  patch.resolve({ ...dashboardSample().operations, isOpen: false });
  await change;
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, false);
  assert.equal(
    env.store.getSnapshot().resources.operations.data.acceptingOrders,
    true,
  );
  env.store.dispose();
});
test('unknown write outcome requires explicit GET review and never replays PATCH', async () => {
  let writes = 0;
  const env = setup({
    update: async () => {
      writes++;
      throw new DashboardError('timeout', { uncertain: true });
    },
  });
  await start(env);
  await env.store.change('isOpen', false);
  assert.equal(env.store.getSnapshot().write.phase, 'uncertain');
  assert.equal(env.store.getSnapshot().resources.operations.stale, true);
  assert.equal(env.timers.size, 5);
  await env.store.refreshAll();
  await assert.rejects(env.store.change('isOpen', false));
  assert.equal(writes, 1);
  env.fake.read = async (key) =>
    key === 'operations'
      ? { ...dashboardSample().operations, isOpen: false }
      : dashboardSample()[key];
  await env.store.review();
  assert.equal(env.store.getSnapshot().write.phase, 'reviewed');
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, false);
  assert.equal(writes, 1);
  assert.equal(env.timers.size, 6);
  env.store.dispose();
});
test('failed review stays uncertain; known rejection preserves values and permits explicit user retry', async () => {
  const env = setup({
    update: async () => {
      throw new DashboardError('503', { uncertain: true, status: 503 });
    },
  });
  await start(env);
  await env.store.change('isOpen', false);
  env.fake.read = async () => {
    throw new DashboardError('offline');
  };
  await env.store.review();
  assert.equal(env.store.getSnapshot().write.phase, 'uncertain');
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, true);
  env.store.dispose();
  const known = setup({
    update: async () => {
      throw new DashboardError('400', { status: 400 });
    },
  });
  await start(known);
  await known.store.change('isOpen', false);
  assert.equal(known.store.getSnapshot().write.phase, 'error');
  assert.equal(
    known.store.getSnapshot().resources.operations.data.isOpen,
    true,
  );
  known.fake.update = async () => ({
    ...dashboardSample().operations,
    isOpen: false,
  });
  await known.store.change('isOpen', false);
  assert.equal(known.store.getSnapshot().write.phase, 'success');
  known.store.dispose();
});
test('unmounted mutation settles without repopulating a new dashboard lifecycle', async () => {
  const patch = deferred();
  const env = setup({ update: () => patch.promise });
  await start(env);
  const flight = env.store.change('isOpen', false);
  env.store.dispose();
  await start(env);
  patch.resolve({ ...dashboardSample().operations, isOpen: false });
  await flight;
  await tick();
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, true);
  assert.equal(env.store.getSnapshot().write.phase, 'idle');
  env.store.dispose();
});
test('hidden dashboard accepts known mutation result without polling until visible again', async () => {
  const patch = deferred();
  const env = setup({ update: () => patch.promise });
  await start(env);
  const flight = env.store.change('isOpen', false);
  env.store.setVisible(false);
  patch.resolve({ ...dashboardSample().operations, isOpen: false });
  await flight;
  assert.equal(env.timers.size, 0);
  assert.equal(env.store.getSnapshot().resources.operations.data.isOpen, false);
  env.store.dispose();
});
test('production customer entry never imports dashboard or HTTP fixture modules', async () => {
  const app = await readFile(
    new URL('../src/App.jsx', import.meta.url),
    'utf8',
  );
  const main = await readFile(
    new URL('../src/main.jsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(app + main, /admin-dashboard|DashboardFixture/);
});
