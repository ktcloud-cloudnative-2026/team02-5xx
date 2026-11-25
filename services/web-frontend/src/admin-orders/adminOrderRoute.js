import { useSyncExternalStore } from 'react';
import { defaultSearch, adminSearchParams } from './adminOrderApi.js';
const subscribe = (listener) => {
  for (const event of ['hashchange', 'popstate', 'admin-orders-route'])
    window.addEventListener(event, listener);
  return () => {
    for (const event of ['hashchange', 'popstate', 'admin-orders-route'])
      window.removeEventListener(event, listener);
  };
};
export function parseAdminRoute(hash, now) {
  hash = hash.replace(/^#admin\/orders(?=\?|$)/, '#admin-orders');
  if (!hash || hash === '#admin-orders')
    return { query: defaultSearch(now), selectedId: null };
  try {
    if (!hash.startsWith('#admin-orders?'))
      throw new Error('주문 조회 주소를 확인해 주세요.');
    const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
    if (
      [...params.keys()].some(
        (key) =>
          ![
            'from',
            'to',
            'orderNo',
            'status',
            'manualReviewRequired',
            'page',
            'size',
            'orderId',
          ].includes(key) || params.getAll(key).length > 1,
      )
    )
      throw new Error('주문 조회 주소를 확인해 주세요.');
    const numeric = (name, fallback) => {
      const value = params.get(name);
      if (value === null) return fallback;
      if (!/^\d+$/.test(value))
        throw new Error('페이지 또는 주문 ID를 확인해 주세요.');
      return Number(value);
    };
    const query = {
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      orderNo: params.get('orderNo') ?? '',
      status: params.get('status') ?? '',
      manualReviewRequired: params.get('manualReviewRequired') === 'true',
      page: numeric('page', 0),
      size: numeric('size', 20),
    };
    if (
      params.has('manualReviewRequired') &&
      !['true', 'false'].includes(params.get('manualReviewRequired'))
    )
      throw new Error('수동 확인 검색 조건을 확인해 주세요.');
    const selectedId = numeric('orderId', null);
    if (
      selectedId !== null &&
      (!Number.isSafeInteger(selectedId) || selectedId < 1)
    )
      throw new Error('주문 ID를 확인해 주세요.');
    adminSearchParams(query);
    return { query, selectedId };
  } catch (error) {
    return { error, query: null, selectedId: null };
  }
}
export function adminHref(query, selectedId = null) {
  const params = adminSearchParams(query);
  if (selectedId !== null) params.set('orderId', String(selectedId));
  const base =
    typeof window !== 'undefined' &&
    window.location.hash.startsWith('#admin/orders')
      ? '#admin/orders'
      : '#admin-orders';
  return `${base}?${params}`;
}
export function navigateAdmin(query, selectedId = null, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState'](
    { adminOrderDetail: selectedId !== null },
    '',
    adminHref(query, selectedId),
  );
  window.dispatchEvent(new Event('admin-orders-route'));
  window.dispatchEvent(new Event('peak-order-route'));
}
export function useAdminRoute() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
}
