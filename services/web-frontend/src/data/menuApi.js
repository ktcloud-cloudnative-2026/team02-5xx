export class MenuApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const id = (value) => Number.isSafeInteger(value) && value > 0;
const money = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value) => value === null || typeof value === 'string';
function uniqueIds(items) {
  return new Set(items.map((item) => item?.id)).size === items.length;
}
function validMenu(menu) {
  return (
    menu &&
    id(menu.id) &&
    id(menu.categoryId) &&
    text(menu.name) &&
    nullableText(menu.imageUrl) &&
    money(menu.basePrice) &&
    ['ON_SALE', 'PAUSED'].includes(menu.status)
  );
}
function invalidResponse() {
  throw new MenuApiError('메뉴 응답을 확인할 수 없어요. 다시 시도해 주세요.');
}

export function createMenuApi({
  fetchImpl = globalThis.fetch,
  baseUrl = '',
} = {}) {
  async function request(path, signal) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      throw new MenuApiError(
        '메뉴를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    let body;
    try {
      body = await response.json();
    } catch {
      invalidResponse();
    }
    if (!response.ok || body?.success !== true) {
      // A transport/proxy 404 is not proof that a menu was deleted.
      const missing =
        response.status === 404 && body?.errorCode === 'MENU_NOT_FOUND';
      throw new MenuApiError(
        missing
          ? '메뉴가 없거나 공개되지 않은 메뉴예요.'
          : '메뉴를 불러오지 못했어요. 다시 시도해 주세요.',
        missing ? 404 : response.status === 404 ? 0 : response.status,
      );
    }
    return body.data;
  }
  return {
    async list(
      { categoryId = 'all', query = '', sort = 'default' } = {},
      { signal } = {},
    ) {
      const params = new URLSearchParams();
      if (categoryId !== 'all') {
        if (!id(categoryId))
          throw new MenuApiError('카테고리를 확인해 주세요.');
        params.set('categoryId', String(categoryId));
      }
      if (!['default', 'priceAsc', 'priceDesc'].includes(sort))
        throw new MenuApiError('정렬을 확인해 주세요.');
      if (query.trim()) params.set('query', query.trim());
      params.set('sort', sort);
      const data = await request(`/api/v1/menus?${params}`, signal);
      if (
        !data ||
        !Array.isArray(data.categories) ||
        !Array.isArray(data.menus) ||
        !data.categories.every(
          (category) => category && id(category.id) && text(category.name),
        ) ||
        !data.menus.every(validMenu) ||
        !uniqueIds(data.categories) ||
        !uniqueIds(data.menus)
      )
        invalidResponse();
      return data;
    },
    async detail(menuId, { signal } = {}) {
      if (!id(menuId)) throw new MenuApiError('메뉴 번호를 확인해 주세요.');
      const data = await request(`/api/v1/menus/${menuId}`, signal);
      if (
        !validMenu(data) ||
        data.id !== menuId ||
        !nullableText(data.description) ||
        !Array.isArray(data.options) ||
        !uniqueIds(data.options) ||
        !data.options.every(
          (option) =>
            option &&
            id(option.id) &&
            text(option.name) &&
            money(option.extraPrice) &&
            typeof option.active === 'boolean' &&
            typeof option.isDefault === 'boolean',
        )
      )
        invalidResponse();
      return data;
    },
  };
}

export const menuApi = createMenuApi();
