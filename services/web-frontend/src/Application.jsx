import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocationHash } from './orders/ordersRoute.js';
import { authSession } from './authSession.js';
import {
  applicationRoute,
  replaceApplicationRoute,
  sessionIdentity,
} from './applicationRoute.js';
const CustomerApp = lazy(() => import('./App.jsx'));
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function CustomerSurface(props) {
  useEffect(() => {
    if (window.location.hash !== '#home') return;
    const frame = requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]')) return;
      document.getElementById('home-heading')?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <CustomerApp {...props} />;
}

export default function Application({
  sessionSource = authSession,
  ...customerProps
}) {
  const hash = useLocationHash();
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot ?? sessionSource.getSnapshot,
  );
  const [restored, setRestored] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const identity = sessionIdentity(session);
  const [boundary, setBoundary] = useState({
    identity,
    generation: 0,
    ended: false,
  });
  // A CUSTOMER login from a guest keeps the mounted App and its exact selection.
  // Leaving an authenticated identity resets private UI before children commit.
  if (boundary.identity !== identity) {
    setBoundary({
      identity,
      generation: boundary.generation + (boundary.identity !== null ? 1 : 0),
      ended: boundary.identity !== null && identity === null,
    });
  }
  useEffect(() => {
    let active = true;
    Promise.resolve(sessionSource.restore())
      .catch(() => {})
      .finally(() => {
        if (active) setRestored(true);
      });
    return () => {
      active = false;
    };
  }, [sessionSource]);
  const logout = useCallback(async () => {
    setLogoutError('');
    try {
      await sessionSource.logout();
    } catch (error) {
      setLogoutError(
        '로그아웃 요청을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
      );
      throw error;
    }
  }, [sessionSource]);
  const login = useCallback(
    async (...args) => {
      const result = await sessionSource.login(...args);
      setLogoutError('');
      return result;
    },
    [sessionSource],
  );
  const sharedSession = useMemo(
    () => ({ ...sessionSource, login, logout }),
    [sessionSource, login, logout],
  );
  const decision = applicationRoute(session, hash, {
    restored,
    sessionEnded: boundary.ended,
  });
  useEffect(() => {
    if (decision.redirect) replaceApplicationRoute(decision.redirect);
    if (boundary.ended && restored)
      setBoundary((current) => ({ ...current, ended: false }));
  }, [decision.redirect, boundary.ended, restored]);
  if (decision.screen === 'restoring' || decision.redirect || boundary.ended)
    return <p role="status">로그인 정보를 확인하고 있어요</p>;
  if (decision.screen === 'unsupported')
    return (
      <section role="alert">
        <h1>이 계정으로 이용할 수 없어요</h1>
        <p>계정 권한을 확인하거나 다시 로그인해 주세요.</p>
        <button
          onClick={() => {
            void logout().catch(() => {});
          }}
        >
          로그아웃
        </button>
      </section>
    );
  return (
    <>
      {logoutError && <p role="alert">{logoutError}</p>}
      <Suspense
        key={decision.screen}
        fallback={<p role="status">화면을 불러오는 중…</p>}
      >
        {decision.screen === 'admin' ? (
          <AdminApp
            key={identity}
            route={decision.route}
            sessionSource={sharedSession}
          />
        ) : (
          <CustomerSurface
            key={boundary.generation}
            {...customerProps}
            sessionSource={sharedSession}
          />
        )}
      </Suspense>
    </>
  );
}
