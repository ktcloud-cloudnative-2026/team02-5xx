import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdminMenuAdapter } from '../src/data/admin/mockAdminMenuAdapter.js';
import { adminMenuFixtures } from '../src/data/admin/adminMenuFixtures.js';
import {
  STATUSES,
  validateCreate,
  validatePatch,
  menuToForm,
  formToRequest,
} from '../src/data/admin/adminMenuContract.js';

const request = (overrides = {}) => ({
  categoryId: 1,
  name: 'New menu',
  basePrice: 0,
  cookTimeSec: 0,
  status: 'PAUSED',
  options: [],
  ...overrides,
});
const adapter = () => {
  let tick = 0;
  return createMockAdminMenuAdapter({
    latency: 0,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
};

test('all three states and all categories including empty categories are listed', async () => {
  const result = (await adapter().list()).data;
  assert.equal(result.menus.length, 6);
  assert.equal(result.categories.length, 4);
  assert.deepEqual(
    [...new Set(result.menus.map((m) => m.status))].sort(),
    [...STATUSES].sort(),
  );
  assert.ok(
    result.menus.every(
      (m) => !Object.hasOwn(m, 'options') && Object.hasOwn(m, 'cookTimeSec'),
    ),
  );
});
test('trimmed case-insensitive literal search combines with category and status', async () => {
  const api = adapter();
  await api.create(request({ name: 'Alpha%_Burger', status: 'HIDDEN' }));
  assert.equal(
    (await api.list({ query: '  ALPHA%_ ', categoryId: 1, status: 'HIDDEN' }))
      .data.menus.length,
    1,
  );
  assert.equal((await api.list({ query: 'missing' })).data.menus.length, 0);
  assert.equal((await api.list({ categoryId: 999 })).data.menus.length, 0);
});
for (const sort of ['priceAsc', 'priceDesc'])
  test(`price sorting uses stable ID tie break: ${sort}`, async () => {
    const api = adapter();
    await api.create(request({ basePrice: 6500 }));
    const rows = (await api.list({ sort })).data.menus;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      assert.ok(
        sort === 'priceAsc'
          ? a.basePrice <= b.basePrice
          : a.basePrice >= b.basePrice,
      );
      if (a.basePrice === b.basePrice) assert.ok(a.id < b.id);
    }
  });
test('default sorting respects category order and ID, not fixture insertion', async () => {
  const api = createMockAdminMenuAdapter({
    latency: 0,
    initialMenus: [...adminMenuFixtures].reverse(),
  });
  assert.deepEqual(
    (await api.list()).data.menus.map((m) => m.id),
    [1, 2, 3, 4, 5, 6],
  );
});
test('detail contains hidden menus and inactive options; returned objects cannot mutate storage', async () => {
  const api = adapter();
  const detail = (await api.detail(1)).data;
  assert.equal(detail.options[2].active, false);
  detail.options[0].name = 'tampered';
  assert.equal((await api.detail(1)).data.options[0].name, '단품');
  assert.equal((await api.detail(6)).data.status, 'HIDDEN');
  await assert.rejects(api.detail(999), { code: 'MENU_NOT_FOUND' });
});
test('create returns envelope and commits option defaults and IDs', async () => {
  const api = adapter();
  const response = await api.create(
    request({
      options: [
        {
          name: 'default',
          extraPrice: 0,
          extraCookTimeSec: 0,
          isDefault: null,
          active: null,
        },
      ],
    }),
  );
  assert.equal(response.success, true);
  assert.equal(response.message, 'OK');
  assert.equal(response.data.menuId, 7);
  const saved = (await api.detail(7)).data;
  assert.equal(saved.options[0].id, 8);
  assert.equal(saved.options[0].isDefault, false);
  assert.equal(saved.options[0].active, true);
  assert.equal(saved.description, null);
  assert.equal(saved.createdAt, saved.updatedAt);
});
const invalidCreates = [
  { name: '' },
  { name: '  ' },
  { name: 'x'.repeat(256) },
  { imageUrl: 'x'.repeat(256) },
  { description: 'bad\0text' },
  { categoryId: 0 },
  { categoryId: '1' },
  { basePrice: -1 },
  { basePrice: '' },
  { basePrice: 1.5 },
  { basePrice: 2147483648 },
  { cookTimeSec: null },
  { status: 'on_sale' },
  { status: null },
  { options: {} },
  { options: [null] },
  { options: [{ name: 'x', extraPrice: -1, extraCookTimeSec: 0 }] },
  {
    options: [
      { name: 'x', extraPrice: 0, extraCookTimeSec: 0, active: 'true' },
    ],
  },
];
for (const [index, invalid] of invalidCreates.entries())
  test(`invalid create ${index + 1} is rejected atomically`, async () => {
    const api = adapter();
    await assert.rejects(api.create(request(invalid)), {
      code: 'INVALID_REQUEST',
    });
    assert.equal((await api.list()).data.menus.length, 6);
  });
test('Unicode code point boundary and Integer.MAX_VALUE are accepted', async () => {
  const api = adapter();
  const result = await api.create(
    request({ name: '😀'.repeat(255), basePrice: 2147483647 }),
  );
  assert.equal(
    (await api.detail(result.data.menuId)).data.name,
    '😀'.repeat(255),
  );
});
test('missing category is distinct and does not allocate menu IDs', async () => {
  const api = adapter();
  await assert.rejects(api.create(request({ categoryId: 999 })), {
    code: 'CATEGORY_NOT_FOUND',
  });
  assert.equal((await api.create(request())).data.menuId, 7);
});
test('patch preserves omission and clears nullable fields, without changing status/creation', async () => {
  const api = adapter();
  const before = (await api.detail(1)).data;
  await api.update(1, { description: null, basePrice: 0 });
  const after = (await api.detail(1)).data;
  assert.equal(after.description, null);
  assert.equal(after.name, before.name);
  assert.equal(after.id, before.id);
  assert.equal(after.status, before.status);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.basePrice, 0);
  assert.deepEqual(after.options, before.options);
});
test('option changes preserve IDs, omitted options and add new options', async () => {
  const api = adapter();
  await api.update(1, {
    options: [
      { optionId: 1, active: false },
      { name: 'new', extraPrice: 5, extraCookTimeSec: 1 },
    ],
  });
  const options = (await api.detail(1)).data.options;
  assert.deepEqual(
    options.map((o) => o.id),
    [1, 2, 3, 8],
  );
  assert.equal(options[0].name, '단품');
  assert.equal(options[0].active, false);
  assert.equal(options[3].active, true);
});
test('foreign/invalid later options roll back all mutations and ID allocation', async () => {
  const api = adapter();
  const before = (await api.detail(1)).data;
  await assert.rejects(
    api.update(1, {
      name: 'discarded',
      options: [
        { name: 'new', extraPrice: 0, extraCookTimeSec: 0 },
        { optionId: 4, active: false },
      ],
    }),
    { code: 'OPTION_NOT_FOUND' },
  );
  assert.deepEqual((await api.detail(1)).data, before);
  await api.update(1, {
    options: [{ name: 'first successful', extraPrice: 0, extraCookTimeSec: 0 }],
  });
  assert.equal((await api.detail(1)).data.options.at(-1).id, 8);
});
const invalidPatches = [
  {},
  { status: 'HIDDEN' },
  { name: null },
  { description: 1 },
  { basePrice: null },
  { options: [] },
  { options: null },
  { options: [{ optionId: 1 }] },
  { options: [{ optionId: 1, active: null }] },
  {
    options: [
      { name: 'new', extraPrice: 0, extraCookTimeSec: 0, active: null },
    ],
  },
  {
    options: [
      { optionId: 1, active: false },
      { optionId: 1, active: true },
    ],
  },
];
for (const [index, invalid] of invalidPatches.entries())
  test(`invalid PATCH ${index + 1} is rejected`, () =>
    assert.throws(() => validatePatch(invalid), { code: 'INVALID_REQUEST' }));
for (const from of STATUSES)
  for (const to of STATUSES)
    test(`status ${from} → ${to} preserves information and repeated timestamp`, async () => {
      const api = adapter();
      await api.changeStatus(1, from);
      const before = (await api.detail(1)).data;
      await api.changeStatus(1, to);
      const after = (await api.detail(1)).data;
      assert.equal(after.status, to);
      assert.deepEqual(
        { ...after, status: before.status, updatedAt: before.updatedAt },
        before,
      );
      await api.changeStatus(1, to);
      assert.equal((await api.detail(1)).data.updatedAt, after.updatedAt);
    });
test('failure injection is one-shot, preserves storage and permits retry', async () => {
  const api = adapter();
  api.failNext('write');
  await assert.rejects(api.create(request()), { code: 'MOCK_FAILURE' });
  assert.equal((await api.create(request())).data.menuId, 7);
  const before = (await api.detail(1)).data;
  api.failNext('write');
  await assert.rejects(api.update(1, { name: 'discarded' }));
  assert.deepEqual((await api.detail(1)).data, before);
  api.failNext('write');
  await assert.rejects(api.changeStatus(1, 'HIDDEN'));
  assert.deepEqual((await api.detail(1)).data, before);
  api.failNext('list');
  await assert.rejects(api.list());
  assert.equal((await api.list()).data.menus.length, 7);
  api.failNext('detail');
  await assert.rejects(api.detail(1));
  assert.equal((await api.detail(1)).data.id, 1);
});
test('independent adapters and fixture data never share mutations', async () => {
  const first = adapter(),
    second = adapter();
  await first.update(1, { name: 'changed' });
  assert.equal((await second.detail(1)).data.name, '클래식 버거');
  assert.equal(adminMenuFixtures[0].name, '클래식 버거');
});
test('concurrent mock creates allocate distinct IDs', async () => {
  const api = adapter();
  const results = await Promise.all([
    api.create(request()),
    api.create(request()),
  ]);
  assert.deepEqual(
    results.map((r) => r.data.menuId),
    [7, 8],
  );
});
test('mock adapter never calls fetch', async (context) => {
  context.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network');
  });
  const api = adapter();
  await api.list();
  await api.detail(1);
  const result = await api.create(request());
  await api.update(result.data.menuId, { name: 'updated' });
  await api.changeStatus(result.data.menuId, 'ON_SALE');
});
test('forms emit minimal PATCH with optionId, explicit clearing and no status', () => {
  const original = structuredClone(adminMenuFixtures[0]);
  const form = menuToForm(original, []);
  form.name = 'edited';
  form.description = '';
  form.options[0].active = false;
  assert.deepEqual(formToRequest(form, original), {
    name: 'edited',
    description: null,
    options: [{ optionId: 1, active: false }],
  });
});
test('blank numeric form fields are not silently converted to zero', () => {
  const form = menuToForm(null, [{ id: 1 }]);
  form.name = 'new';
  form.cookTimeSec = '0';
  assert.throws(() => formToRequest(form), { code: 'INVALID_REQUEST' });
  form.basePrice = '0';
  assert.equal(formToRequest(form).basePrice, 0);
});
test('unchanged edit is rejected without submitting an empty PATCH', () =>
  assert.throws(
    () =>
      formToRequest(menuToForm(adminMenuFixtures[0], []), adminMenuFixtures[0]),
    { code: 'INVALID_REQUEST' },
  ));
test('late option validation points to the form row, not the filtered PATCH index', () => {
  const form = menuToForm(adminMenuFixtures[0], []);
  form.options[2].name = '';
  assert.throws(
    () => formToRequest(form, adminMenuFixtures[0]),
    (error) => Object.hasOwn(error.fields, 'options.2.name'),
  );
});
test('unknown request fields and invalid query conditions are rejected', async () => {
  assert.throws(() => validateCreate(request({ role: 'STORE_ADMIN' })), {
    code: 'INVALID_REQUEST',
  });
  const api = adapter();
  await assert.rejects(api.list({ sort: 'random' }));
  await assert.rejects(api.list({ status: '' }));
  await assert.rejects(api.detail(-1));
});
