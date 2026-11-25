import { useSyncExternalStore } from 'react';
const subscribe = (listener) => {
  const events = ['hashchange', 'popstate', 'peak-order-route'];
  events.forEach((event) => window.addEventListener(event, listener));
  return () =>
    events.forEach((event) => window.removeEventListener(event, listener));
};
export function useAccountRoute() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  if (!hash.startsWith('#account')) return null;
  return (
    {
      '#account': 'home',
      '#account/profile': 'profile',
      '#account/password': 'password',
    }[hash] ?? 'invalid'
  );
}
