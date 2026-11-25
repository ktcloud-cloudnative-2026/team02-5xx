import { MAX_QUANTITY } from './menu.js';

export const CART_STORAGE_KEY = 'peak-order.cart.v1';
export const CART_VERSION = 1;

export class CartError extends Error {}

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function describeItem(selection, getMenu, { allowPaused = false } = {}) {
  if (
    !selection ||
    !validId(selection.menuId) ||
    !Number.isInteger(selection.quantity) ||
    selection.quantity < 1 ||
    selection.quantity > MAX_QUANTITY ||
    !Array.isArray(selection.optionIds) ||
    selection.optionIds.length > 1 ||
    !selection.optionIds.every(validId)
  ) {
    throw new CartError('메뉴, 옵션과 수량을 다시 확인해 주세요.');
  }
  const menu = getMenu(selection.menuId);
  if (
    !menu ||
    menu.id !== selection.menuId ||
    typeof menu.name !== 'string' ||
    !menu.name.trim() ||
    (menu.status !== 'ON_SALE' && !(allowPaused && menu.status === 'PAUSED')) ||
    !validMoney(menu.basePrice)
  ) {
    throw new CartError('현재 담을 수 없는 메뉴입니다.');
  }
  if (!Array.isArray(menu.options)) {
    throw new CartError('메뉴 옵션을 확인할 수 없습니다.');
  }
  const selectedOptions = selection.optionIds.map((id) =>
    menu.options.find((option) => option?.id === id && option.active === true),
  );
  if (
    selectedOptions.some(
      (option) =>
        !option ||
        typeof option.name !== 'string' ||
        !option.name.trim() ||
        !validMoney(option.extraPrice),
    ) ||
    (menu.options.length > 0 && selectedOptions.length !== 1)
  ) {
    throw new CartError(
      '선택할 수 없는 옵션입니다. 옵션을 다시 선택해 주세요.',
    );
  }
  const optionIds = [...selection.optionIds].sort((a, b) => a - b);
  const unitPrice =
    menu.basePrice +
    selectedOptions.reduce((sum, option) => sum + option.extraPrice, 0);
  const total = unitPrice * selection.quantity;
  if (!validMoney(unitPrice) || !validMoney(total)) {
    throw new CartError('메뉴 금액을 확인할 수 없습니다.');
  }
  return {
    key: JSON.stringify([selection.menuId, optionIds]),
    menuId: selection.menuId,
    optionIds,
    quantity: selection.quantity,
    name: menu.name,
    imageUrl: menu.imageUrl,
    optionNames: selectedOptions.map((option) => option.name),
    unitPrice,
    total,
  };
}

function entry(item) {
  return {
    menuId: item.menuId,
    optionIds: item.optionIds,
    quantity: item.quantity,
  };
}

export function cartView(items, getMenu, options) {
  const rows = items.map((item) => describeItem(item, getMenu, options));
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (!validMoney(total))
    throw new CartError('장바구니 금액을 확인할 수 없습니다.');
  return { rows, total };
}

export function addItem(items, selection, getMenu, options) {
  const item = describeItem(selection, getMenu, options);
  const existing = items.find(
    (candidate) =>
      describeItem(candidate, getMenu, { allowPaused: true }).key === item.key,
  );
  const requestedQuantity = (existing?.quantity ?? 0) + item.quantity;
  const quantity = Math.min(MAX_QUANTITY, requestedQuantity);
  const next = existing
    ? items.map((candidate) =>
        describeItem(candidate, getMenu, { allowPaused: true }).key === item.key
          ? entry({ ...item, quantity })
          : candidate,
      )
    : [...items, entry(item)];
  cartView(next, getMenu, { allowPaused: true });
  return { items: next, limited: requestedQuantity > MAX_QUANTITY };
}

export function changeQuantity(items, key, quantity, getMenu, options) {
  const next = items.map((item) =>
    describeItem(item, getMenu, options).key === key
      ? { ...item, quantity }
      : item,
  );
  cartView(next, getMenu, options);
  return next;
}

export function removeItem(items, key, getMenu, options) {
  return items.filter(
    (item) => describeItem(item, getMenu, options).key !== key,
  );
}

export function browserStorage() {
  return window.localStorage;
}

export function loadCart(storageProvider, getMenu, options) {
  try {
    const raw = storageProvider().getItem(CART_STORAGE_KEY);
    if (raw === null) return { items: [], warning: '' };
    const data = JSON.parse(raw);
    if (!data || data.version !== CART_VERSION || !Array.isArray(data.items)) {
      throw new CartError('이전 장바구니 형식');
    }
    let items = [];
    let discarded = false;
    for (const selection of data.items) {
      try {
        const result = addItem(items, selection, getMenu, options);
        items = result.items;
        discarded ||= result.limited;
      } catch {
        discarded = true;
      }
    }
    return {
      items,
      warning: discarded
        ? '판매 상태·옵션이 변경됐거나 올바르지 않은 일부 항목은 복원하지 못했어요.'
        : '',
    };
  } catch {
    return {
      items: [],
      warning: '장바구니를 복원하지 못했어요. 메뉴를 다시 담아 주세요.',
    };
  }
}

export function saveCart(items, storageProvider, getMenu, options) {
  try {
    cartView(items, getMenu, options);
    storageProvider().setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ version: CART_VERSION, items: items.map(entry) }),
    );
    return '';
  } catch {
    return '이 브라우저에 저장할 수 없어요. 새로고침하면 변경 내용이 사라질 수 있어요.';
  }
}
