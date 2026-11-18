export const MAX_QUANTITY = 99;

export function formatPrice(value) {
  return `${value.toLocaleString('ko-KR')}원`;
}

export function calculateTotal(basePrice, extraPrice, quantity) {
  return (basePrice + extraPrice) * quantity;
}
