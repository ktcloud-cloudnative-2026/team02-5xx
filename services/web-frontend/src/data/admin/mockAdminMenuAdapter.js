import { adminCategories, adminMenuFixtures } from './adminMenuFixtures.js';
import {
  MockMenuError,
  validateCreate,
  validateId,
  validatePatch,
  validateStatus,
} from './adminMenuContract.js';

const copy = (value) => structuredClone(value);
const ok = (data) => ({ success: true, data, message: 'OK' });

/** Memory-only simulation. No network, storage, login or product route integration. */
export function createMockAdminMenuAdapter({
  initialMenus = adminMenuFixtures,
  categories = adminCategories,
  latency = 250,
  now = () => new Date().toISOString(),
} = {}) {
  let menus = copy(initialMenus);
  const categoryData = copy(categories);
  let nextMenu = Math.max(0, ...menus.map((m) => m.id)) + 1;
  let nextOption =
    Math.max(0, ...menus.flatMap((m) => m.options.map((o) => o.id))) + 1;
  let failure = null;
  async function wait(operation) {
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
    if (
      failure === operation ||
      (failure === 'write' && operation !== 'list' && operation !== 'detail')
    ) {
      failure = null;
      throw new MockMenuError(
        '모의 저장소 오류입니다. 다시 시도해 주세요.',
        'MOCK_FAILURE',
      );
    }
  }
  function find(id) {
    validateId(id);
    const menu = menus.find((item) => item.id === id);
    if (!menu)
      throw new MockMenuError('메뉴를 찾을 수 없습니다.', 'MENU_NOT_FOUND');
    return menu;
  }
  function category(id) {
    if (!categoryData.some((c) => c.id === id))
      throw new MockMenuError(
        '카테고리를 찾을 수 없습니다.',
        'CATEGORY_NOT_FOUND',
        { categoryId: '카테고리를 다시 선택해 주세요.' },
      );
  }
  return {
    kind: 'memory-mock',
    failNext(operation) {
      if (!['list', 'detail', 'write'].includes(operation))
        throw new Error('Invalid preview scenario');
      failure = operation;
    },
    async list({
      categoryId = null,
      query = '',
      status = null,
      sort = 'default',
    } = {}) {
      await wait('list');
      if (categoryId !== null) validateId(categoryId, 'categoryId');
      if (status !== null) validateStatus(status);
      if (
        typeof query !== 'string' ||
        !['default', 'priceAsc', 'priceDesc'].includes(sort)
      )
        throw new MockMenuError('조회 조건을 확인해 주세요.');
      const search = query.trim().toLowerCase();
      const categoryOrder = (id) =>
        categoryData.find((c) => c.id === id)?.sortOrder ?? 0;
      const selected = menus.filter(
        (m) =>
          (categoryId === null || m.categoryId === categoryId) &&
          (status === null || m.status === status) &&
          m.name.toLowerCase().includes(search),
      );
      selected.sort((a, b) =>
        sort === 'default'
          ? categoryOrder(a.categoryId) - categoryOrder(b.categoryId) ||
            a.categoryId - b.categoryId ||
            a.id - b.id
          : (sort === 'priceAsc'
              ? a.basePrice - b.basePrice
              : b.basePrice - a.basePrice) || a.id - b.id,
      );
      return ok({
        categories: copy(
          [...categoryData].sort(
            (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
          ),
        ).map(({ id, name }) => ({ id, name })),
        menus: copy(selected).map(
          ({ options, description, createdAt, updatedAt, ...summary }) =>
            summary,
        ),
      });
    },
    async detail(id) {
      await wait('detail');
      return ok(copy(find(id)));
    },
    async create(request) {
      await wait('create');
      validateCreate(request);
      category(request.categoryId);
      const time = now();
      const menu = {
        ...copy(request),
        id: nextMenu++,
        description: request.description ?? null,
        imageUrl: request.imageUrl ?? null,
        createdAt: time,
        updatedAt: time,
        options: (request.options ?? []).map((o) => ({
          ...copy(o),
          id: nextOption++,
          isDefault: o.isDefault ?? false,
          active: o.active ?? true,
        })),
      };
      menus = [...menus, menu];
      return ok({ menuId: menu.id });
    },
    async update(id, request) {
      await wait('update');
      validatePatch(request);
      const before = find(id);
      if (request.categoryId !== undefined) category(request.categoryId);
      const draft = copy(before);
      for (const field of [
        'categoryId',
        'name',
        'description',
        'imageUrl',
        'basePrice',
        'cookTimeSec',
      ])
        if (Object.hasOwn(request, field)) draft[field] = request[field];
      // Validate ownership before allocating IDs or committing any mutation.
      for (const change of request.options ?? [])
        if (
          Object.hasOwn(change, 'optionId') &&
          !draft.options.some((o) => o.id === change.optionId)
        )
          throw new MockMenuError(
            '이 메뉴의 옵션을 찾을 수 없습니다.',
            'OPTION_NOT_FOUND',
          );
      let optionCounter = nextOption;
      for (const change of request.options ?? []) {
        if (Object.hasOwn(change, 'optionId')) {
          const { optionId, ...fields } = change;
          Object.assign(
            draft.options.find((o) => o.id === optionId),
            copy(fields),
          );
        } else
          draft.options.push({
            ...copy(change),
            id: optionCounter++,
            isDefault: change.isDefault ?? false,
            active: change.active ?? true,
          });
      }
      draft.updatedAt = now();
      menus = menus.map((m) => (m.id === id ? draft : m));
      nextOption = optionCounter;
      return ok({ menuId: id });
    },
    async changeStatus(id, status) {
      await wait('status');
      validateStatus(status);
      const before = find(id);
      if (before.status !== status)
        menus = menus.map((m) =>
          m.id === id ? { ...m, status, updatedAt: now() } : m,
        );
      return ok({ menuId: id, status });
    },
  };
}
