import { AuthError, authFailure, createAuthApi } from './authApi.js';

const ANONYMOUS = Object.freeze({
  authenticated: false,
  phase: 'anonymous',
  user: null,
});
const cancelled = () =>
  new AuthError('이전 인증 요청은 적용하지 않았어요.', { kind: 'cancelled' });
const busy = () =>
  new AuthError('진행 중인 인증 요청이 끝난 뒤 다시 시도해 주세요.', {
    kind: 'busy',
  });

export function createAuthSession({ api = createAuthApi() } = {}) {
  let snapshot = ANONYMOUS;
  let accessToken = null; // Deliberately absent from snapshots, storage and URLs.
  let generation = 0;
  let refreshAllowed = true;
  let refreshFlight = null;
  let loginFlight = null;
  let logoutFlight = null;
  let restoration = null;
  const listeners = new Set();
  const publish = (next) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const clear = (reason) => {
    generation++;
    accessToken = null;
    refreshAllowed = false;
    publish({ ...ANONYMOUS, reason });
  };
  const check = (epoch, signal) => {
    if (generation !== epoch || signal?.aborted) throw cancelled();
  };
  async function verified(data, epoch, signal) {
    check(epoch, signal);
    const user = await api.me(data.accessToken, { signal });
    check(epoch, signal);
    if (user.id !== data.user.id)
      throw new AuthError('인증 사용자 응답이 일치하지 않아요.', {
        kind: 'protocol',
      });
    accessToken = data.accessToken;
    refreshAllowed = true;
    publish({
      authenticated: true,
      phase: 'authenticated',
      user,
      role: user.role,
    });
    return snapshot;
  }

  function refresh() {
    if (logoutFlight || !refreshAllowed) return Promise.resolve(null);
    if (loginFlight) return loginFlight;
    if (refreshFlight) return refreshFlight;
    const epoch = generation;
    if (!snapshot.authenticated) publish({ ...ANONYMOUS, phase: 'restoring' });
    const operation = Promise.resolve()
      .then(async () => {
        const data = await api.refresh();
        return verified(data, epoch);
      })
      .catch((error) => {
        if (generation === epoch) clear('expired');
        throw error;
      })
      .finally(() => {
        if (refreshFlight === operation) refreshFlight = null;
      });
    refreshFlight = operation;
    return operation;
  }

  function login(credentials, { signal } = {}) {
    if (loginFlight || logoutFlight) return Promise.reject(busy());
    const priorRefresh = refreshFlight;
    const epoch = ++generation;
    accessToken = null;
    refreshAllowed = false;
    publish({ ...ANONYMOUS, phase: 'authenticating' });
    const operation = Promise.resolve()
      .then(async () => {
        // Let a rotating response finish before sending a new login cookie.
        if (priorRefresh) await Promise.allSettled([priorRefresh]);
        check(epoch, signal);
        const data = await api.login(credentials, { signal });
        return verified(data, epoch, signal);
      })
      .catch((error) => {
        if (generation === epoch) clear('login-failed');
        throw error;
      })
      .finally(() => {
        if (loginFlight === operation) loginFlight = null;
      });
    loginFlight = operation;
    return operation;
  }

  function logout() {
    if (logoutFlight) return logoutFlight;
    const pending = [refreshFlight, loginFlight].filter(Boolean);
    clear('logout'); // Synchronously invalidate every older response.
    const operation = Promise.allSettled(pending)
      .then(() => api.logout())
      .finally(() => {
        if (logoutFlight === operation) logoutFlight = null;
      });
    logoutFlight = operation;
    return operation;
  }

  async function authorized(operation, retryOn401) {
    const epoch = generation;
    const originalToken = accessToken;
    try {
      const result = await operation(originalToken);
      check(epoch);
      return result;
    } catch (error) {
      if (error.status !== 401 || generation !== epoch) throw error;
      if (!retryOn401) {
        clear('expired');
        throw error;
      }
      // Another concurrent 401 may already have completed rotation.
      if (!accessToken || accessToken === originalToken) await refresh();
      check(epoch);
      if (!accessToken) throw error;
      try {
        const result = await operation(accessToken);
        check(epoch);
        return result;
      } catch (retryError) {
        if (retryError.status === 401 && generation === epoch) clear('expired');
        throw retryError;
      }
    }
  }

  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => ANONYMOUS,
    // No cleanup abort: StrictMode's setup/cleanup/setup shares this one operation.
    restore() {
      if (!restoration) restoration = refresh().catch(() => null);
      return restoration;
    },
    login,
    logout,
    refresh,
    async loadUser() {
      const epoch = generation;
      const user = await authorized((token) => api.me(token), true);
      check(epoch);
      if (!snapshot.authenticated || user.id !== snapshot.user.id) {
        clear('expired');
        throw new AuthError('인증 사용자 응답이 일치하지 않아요.', {
          kind: 'protocol',
        });
      }
      publish({ ...snapshot, user, role: user.role });
      return user;
    },
    async request(
      path,
      { retryOn401 = false, method = 'GET', headers, ...options } = {},
    ) {
      const retry =
        retryOn401 === true && ['GET', 'HEAD'].includes(method.toUpperCase());
      try {
        return await authorized(async (token) => {
          const outgoing = new Headers(headers);
          outgoing.delete('Authorization');
          if (token) outgoing.set('Authorization', `Bearer ${token}`);
          const response = await api.send(path, {
            ...options,
            method,
            headers: outgoing,
          });
          if (response.status === 401) throw authFailure(401, response);
          return response; // 403 never enters refresh handling.
        }, retry);
      } catch (error) {
        if (error.response) return error.response;
        throw error;
      }
    },
  });
}

export const authSession = createAuthSession();
