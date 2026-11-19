import { CART_STORAGE_KEY, CART_VERSION, loadCart } from './cart.js';
import { MAX_QUANTITY } from './menu.js';

// Read identity/quantity only. A missing asynchronous catalog must never erase a cart.
export function readPendingCart(storageProvider) {
  try {
    const raw = storageProvider().getItem(CART_STORAGE_KEY);
    if (raw === null) return { items: [], warning: '' };
    const data = JSON.parse(raw);
    if (data?.version !== CART_VERSION || !Array.isArray(data.items))
      throw new Error();
    const validId = (value) => Number.isSafeInteger(value) && value > 0;
    const items = data.items
      .filter(
        (item) =>
          item &&
          validId(item.menuId) &&
          Array.isArray(item.optionIds) &&
          item.optionIds.length <= 1 &&
          item.optionIds.every(validId) &&
          Number.isInteger(item.quantity) &&
          item.quantity >= 1 &&
          item.quantity <= MAX_QUANTITY,
      )
      .map(({ menuId, optionIds, quantity }) => ({
        menuId,
        optionIds: [...optionIds],
        quantity,
      }));
    return {
      items,
      warning:
        items.length !== data.items.length
          ? '올바르지 않은 일부 장바구니 항목은 복원하지 못했어요.'
          : '',
    };
  } catch {
    return {
      items: [],
      warning:
        '장바구니를 복원하지 못했어요. 저장된 원본은 변경하지 않았습니다.',
    };
  }
}

export async function validateCartCatalog(items, api, { signal } = {}) {
  const menus = new Map(
    await Promise.all(
      [...new Set(items.map((item) => item.menuId))].map(async (menuId) => {
        try {
          return [menuId, await api.detail(menuId, { signal })];
        } catch (error) {
          if (error.status === 404) return [menuId, null];
          throw error;
        }
      }),
    ),
  );
  const getMenu = (menuId) => menus.get(menuId) ?? null;
  const validated = loadCart(
    () => ({ getItem: () => JSON.stringify({ version: CART_VERSION, items }) }),
    getMenu,
  );
  return { ...validated, getMenu, menus, checkedAt: performance.now() };
}
