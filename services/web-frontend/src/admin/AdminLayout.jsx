import { useEffect, useRef, useState } from 'react';
import { ADMIN_ROUTES } from './adminRoute.js';
import './adminLayout.css';

function Navigation({ route }) {
  return (
    <nav aria-label="관리자 화면">
      {ADMIN_ROUTES.map((item, index) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={route.id === item.id ? 'page' : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            {index === 0 ? (
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
            ) : index === 1 ? (
              <path d="M5 3h14v18H5zM8 7h8M8 12h8M8 17h5" />
            ) : index === 2 ? (
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6" />
            ) : index === 3 ? (
              <path d="M3 4h18v4H3zM5 8v13h14V8M9 12h6" />
            ) : (
              <path d="M7 15a5 5 0 0 1-2-9 5 5 0 0 1 7-2 5 5 0 0 1 7 2 5 5 0 0 1-2 9v6H7zM7 17h10" />
            )}
          </svg>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function AdminLayout({ route, session, onLogout, children }) {
  const main = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError('');
    // Wait for dialog unmount/scroll-lock cleanup before focusing the destination.
    const frame = requestAnimationFrame(() => {
      const target = main.current?.querySelector('h1') ?? main.current;
      target?.setAttribute('tabindex', '-1');
      target?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [route.id]);
  return (
    <div className="admin-layout">
      <a
        className="admin-skip"
        href="#admin-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <aside className="admin-navigation" aria-label="매장 관리">
        <a
          className="admin-logo"
          href="#admin"
          aria-label="Peak Order 관리자 대시보드"
        >
          <img src="/images/brand/peakorder-logo-a.png" alt="Peak Order" />
        </a>
        <Navigation route={route} />
        <div className="admin-account">
          <span>{session.user.nickname || session.user.email}</span>
          <small>매장 관리자</small>
          <button
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await onLogout();
              } catch {
                setError(
                  '로그아웃 요청을 확인하지 못했어요. 다시 로그인하기 전에 연결을 확인해 주세요.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      </aside>
      <main
        ref={main}
        id="admin-content"
        className="admin-content"
        tabIndex={-1}
      >
        {error && <p role="alert">{error}</p>}
        {children}
      </main>
    </div>
  );
}
