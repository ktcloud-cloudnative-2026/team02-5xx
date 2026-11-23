import { CART_STORAGE_KEY, CART_VERSION } from '../cart.js';
import { MAX_QUANTITY } from '../menu.js';

// Reconcile quantities, never stored names/prices or menu sale status. An
// unrelated item must survive even if its catalog entry has since changed.
function itemKey(item) {
  if (
    !item ||
    !Number.isSafeInteger(item.menuId) ||
    item.menuId <= 0 ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > MAX_QUANTITY ||
    !Array.isArray(item.optionIds) ||
    item.optionIds.length > 1 ||
    !item.optionIds.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    throw new Error('Invalid cart');
  return JSON.stringify([
    item.menuId,
    [...item.optionIds].sort((a, b) => a - b),
  ]);
}
export function subtractPurchasedItems(currentItems, orderedItems) {
  if (!Array.isArray(currentItems) || !Array.isArray(orderedItems))
    throw new Error('Invalid cart');
  const remaining = new Map();
  for (const item of orderedItems) {
    const key = itemKey(item);
    remaining.set(key, (remaining.get(key) ?? 0) + item.quantity);
  }
  return currentItems.flatMap((item) => {
    const key = itemKey(item);
    const removed = Math.min(item.quantity, remaining.get(key) ?? 0);
    remaining.set(key, (remaining.get(key) ?? 0) - removed);
    return item.quantity === removed
      ? []
      : [
          {
            menuId: item.menuId,
            optionIds: [...item.optionIds],
            quantity: item.quantity - removed,
          },
        ];
  });
}
export function captureCartStorage(storageProvider) {
  try {
    return { readable: true, raw: storageProvider().getItem(CART_STORAGE_KEY) };
  } catch {
    return { readable: false };
  }
}
function parseCart(raw) {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (value?.version !== CART_VERSION || !Array.isArray(value.items))
    throw new Error('Invalid cart');
  value.items.forEach(itemKey);
  return value.items;
}
export function completePaidCart({
  orderedItems,
  currentItems,
  storageProvider,
  baseline,
  canApply,
}) {
  const unchanged = { items: currentItems, warning: '' };
  if (!canApply()) return unchanged;
  try {
    const storage = storageProvider();
    const raw = storage.getItem(CART_STORAGE_KEY);
    const persisted = parseCart(raw);
    // Prefer current in-memory edits when storage is unchanged. If another
    // writer changed storage, subtract from that latest value rather than
    // overwrite later additions using the checkout entry snapshot.
    const latest =
      baseline.readable && raw === baseline.raw ? currentItems : persisted;
    const items = subtractPurchasedItems(latest, orderedItems);
    if (!canApply()) return unchanged;
    if (JSON.stringify(items) !== JSON.stringify(latest))
      storage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ version: CART_VERSION, items }),
      );
    if (!canApply()) return unchanged;
    return { items, warning: '' };
  } catch {
    return {
      ...unchanged,
      warning:
        '결제 성공은 확인했지만 장바구니 정리를 저장하지 못했어요. 남은 품목을 다시 주문하기 전에 확인해 주세요.',
    };
  }
}
