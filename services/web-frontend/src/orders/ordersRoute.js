import { useSyncExternalStore } from 'react';

export function parseOrdersRoute(hash) {
  if (!hash.startsWith('#orders')) return null;
  const match = /^#orders(?:\/([1-9]\d*))?(?:\?page=(0|[1-9]\d*))?$/.exec(hash);
  const page = Number(match?.[2] ?? 0),
    id = match?.[1] ? Number(match[1]) : null;
  if (
    !match ||
    !Number.isSafeInteger(page) ||
    page > 2147483647 ||
    (id !== null && !Number.isSafeInteger(id))
  )
    return { invalid: true, page: 0, id: null };
  return { page, id };
}
export const ordersHref = (page = 0, id = null) =>
  `#orders${id ? `/${id}` : ''}${page ? `?page=${page}` : ''}`;
const subscribe = (listener) => {
  for (const event of ['hashchange', 'popstate', 'peak-order-route'])
    window.addEventListener(event, listener);
  return () => {
    for (const event of ['hashchange', 'popstate', 'peak-order-route'])
      window.removeEventListener(event, listener);
  };
};
export function useOrdersRoute() {
  return parseOrdersRoute(
    useSyncExternalStore(
      subscribe,
      () => window.location.hash,
      () => '',
    ),
  );
}
