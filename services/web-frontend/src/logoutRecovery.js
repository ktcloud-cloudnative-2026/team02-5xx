import { AuthError } from './authApi.js';
import { sessionIdentity } from './applicationRoute.js';

export const LOGOUT_FAILURE_MESSAGE =
  '로그아웃 요청을 확인하지 못했어요. 다시 시도해 주세요. 새로고침하면 로그인 상태가 복원될 수 있어요.';
const stale = () =>
  new AuthError('이전 로그아웃 재시도는 적용하지 않았어요.', {
    kind: 'cancelled',
  });

/** UI recovery only. AuthSession still owns cookie requests and invalidation. */
export function createLogoutRecovery(source) {
  let snapshot = Object.freeze({ phase: 'idle', error: '', failureId: 0 });
  let revision = 0,
    flight = null,
    unsubscribe = null;
  let identity = sessionIdentity(source.getSnapshot());
  const listeners = new Set();
  function publish(next) {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }
  function observe() {
    const next = sessionIdentity(source.getSnapshot());
    if (next !== null && next !== identity) {
      revision++;
      publish({ phase: 'idle', error: '', failureId: snapshot.failureId + 1 });
    }
    identity = next;
  }
  function logout() {
    if (flight) return flight;
    const ticket = ++revision;
    publish({ ...snapshot, phase: 'pending' });
    let operation;
    try {
      operation = source.logout();
    } catch (error) {
      operation = Promise.reject(error);
    }
    const pending = Promise.resolve(operation)
      .then(
        (result) => {
          if (ticket === revision)
            publish({
              phase: 'idle',
              error: '',
              failureId: snapshot.failureId + 1,
            });
          return result;
        },
        (error) => {
          if (ticket === revision && !source.getSnapshot().authenticated)
            publish({
              phase: 'failed',
              error: LOGOUT_FAILURE_MESSAGE,
              failureId: snapshot.failureId + 1,
            });
          throw error;
        },
      )
      .finally(() => {
        if (flight === pending) flight = null;
      });
    flight = pending;
    return pending;
  }
  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      if (!unsubscribe) {
        observe();
        unsubscribe = source.subscribe(observe);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.();
          unsubscribe = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    logout,
    retry(failureId) {
      const session = source.getSnapshot();
      if (
        failureId !== snapshot.failureId ||
        !snapshot.error ||
        session.authenticated ||
        session.phase === 'authenticating' ||
        session.phase === 'restoring'
      )
        return Promise.reject(stale());
      return logout();
    },
    async login(...args) {
      // Wait for the old cookie-mutating logout to settle before issuing a login.
      if (flight)
        throw new AuthError('로그아웃 요청이 끝난 뒤 다시 로그인해 주세요.', {
          kind: 'busy',
        });
      const result = await source.login(...args);
      observe();
      return result;
    },
  });
}
