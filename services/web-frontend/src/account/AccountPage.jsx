import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import LoginModal from '../components/LoginModal.jsx';
import {
  nicknameError,
  passwordError,
  accountError,
  codePoints,
} from './accountValidation.js';
import './account.css';

function AccountForm({ route, user, sessionSource, onSaved }) {
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(false);
  const controller = useRef(null);
  const password = route === 'password';
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const failure = password
      ? passwordError(current, next, confirmation)
      : nicknameError(nickname);
    if (failure) {
      setError(failure);
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    controller.current = new AbortController();
    let preserveInputs = false;
    try {
      if (password)
        await sessionSource.changePassword(
          {
            currentPassword: current,
            newPassword: next,
          },
          { signal: controller.current.signal },
        );
      else
        await sessionSource.updateProfile(nickname, {
          signal: controller.current.signal,
        });
      if (active.current) onSaved(password);
    } catch (failure) {
      preserveInputs = failure.kind === 'account-retry';
      if (active.current && failure.kind !== 'cancelled')
        setError(accountError(failure));
    } finally {
      busy.current = false;
      if (active.current) {
        setPending(false);
        if (!preserveInputs) {
          setCurrent('');
          setNext('');
          setConfirmation('');
        }
      }
    }
  }
  return (
    <form
      className="account-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
    >
      {password ? (
        <>
          <p className="account-help" id="password-policy">
            새 비밀번호는 12~64자예요. 공백도 입력한 그대로 사용해요.
          </p>
          {[
            ['현재 비밀번호', current, setCurrent, 'current-password'],
            ['새 비밀번호', next, setNext, 'new-password'],
            ['새 비밀번호 확인', confirmation, setConfirmation, 'new-password'],
          ].map(([label, value, update, autocomplete]) => (
            <label key={label}>
              {label}
              <input
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={(event) => update(event.target.value)}
                autoComplete={autocomplete}
                disabled={pending}
                required
                aria-describedby="password-policy account-error"
              />
            </label>
          ))}
          <button
            className="text-button password-visibility"
            type="button"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? '비밀번호 숨기기' : '비밀번호 표시'}
          </button>
          <p className="account-help">
            변경하면 다시 로그인해야 해요. 모든 기기의 자동 로그인 세션은
            종료되며, 이미 발급된 인증 정보는 만료 전까지 유효할 수 있어요.
          </p>
        </>
      ) : (
        <>
          <label>
            이메일
            <input type="email" value={user.email} readOnly />
          </label>
          <label>
            닉네임
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              disabled={pending}
              required
              autoComplete="nickname"
              aria-describedby="nickname-policy account-error"
            />
          </label>
          <p className="account-help" id="nickname-policy">
            1~50자 · 현재 {codePoints(nickname)}자. 앞뒤 공백은 그대로 저장돼요.
          </p>
        </>
      )}
      <p id="account-error" role="alert">
        {error}
      </p>
      <div className="account-actions">
        <a className="text-button" href="#account">
          취소
        </a>
        <button className="pill-button" disabled={pending} type="submit">
          {pending ? '변경 중…' : password ? '비밀번호 변경' : '저장'}
        </button>
      </div>
    </form>
  );
}

function CustomerAccount({ route, sessionSource, session }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    sessionSource
      .loadUser({ signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setLoading(false);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(accountError(failure));
        }
      });
    return () => controller.abort();
  }, [sessionSource, attempt, route]);
  const user = session.user;
  return (
    <>
      <p role="status">{notice}</p>
      {loading ? (
        <p role="status">회원정보를 불러오는 중이에요.</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="pill-button"
            onClick={() => setAttempt(attempt + 1)}
          >
            다시 조회
          </button>
        </div>
      ) : route === 'home' ? (
        <>
          <div className="account-avatar" aria-hidden="true">
            {Array.from(user.nickname || 'P')[0]}
          </div>
          <h2>{user.nickname ?? '닉네임 미설정'}</h2>
          <dl className="account-details">
            <dt>이메일</dt>
            <dd>{user.email}</dd>
            <dt>회원 ID</dt>
            <dd>{user.id}</dd>
            <dt>역할</dt>
            <dd>{user.role}</dd>
          </dl>
          <div className="account-links">
            <a href="#account/profile">
              회원정보 수정 <span aria-hidden="true">→</span>
            </a>
            <a href="#account/password">
              비밀번호 변경 <span aria-hidden="true">→</span>
            </a>
          </div>
        </>
      ) : (
        <AccountForm
          key={route}
          route={route}
          user={user}
          sessionSource={sessionSource}
          onSaved={() => {
            setNotice('회원정보를 저장했어요.');
            window.location.hash = '#account';
          }}
        />
      )}
    </>
  );
}

export default function AccountPage({ route, sessionSource }) {
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot ?? sessionSource.getSnapshot,
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const title =
    route === 'profile'
      ? '회원정보 수정'
      : route === 'password'
        ? '비밀번호 변경'
        : '마이페이지';
  const heading = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [route]);
  useEffect(() => {
    if (session.authenticated) setLoginOpen(false);
  }, [session.authenticated]);
  const customer = session.authenticated && session.user?.role === 'CUSTOMER';
  return (
    <main className="account-page">
      <header className="page-heading">
        <div>
          <p className="account-eyebrow">MY ACCOUNT</p>
          <h1 id="account-heading" ref={heading} tabIndex={-1}>
            {title}
          </h1>
        </div>
        <a className="text-button" href="#menu-list">
          메뉴로 돌아가기
        </a>
      </header>
      <section className="account-card" aria-label={title}>
        {route === 'invalid' ? (
          <p role="alert">찾을 수 없는 회원정보 화면이에요.</p>
        ) : session.phase === 'restoring' ? (
          <p role="status">로그인 정보를 확인 중이에요.</p>
        ) : !session.authenticated ? (
          <>
            <h2>
              {session.reason === 'password-changed'
                ? '비밀번호를 변경했어요'
                : '로그인이 필요해요'}
            </h2>
            <p role="status">
              {session.reason === 'password-changed'
                ? '새 비밀번호로 다시 로그인해 주세요. 메뉴와 장바구니는 보존했어요.'
                : session.reason === 'expired'
                  ? '인증이 만료됐어요. 다시 로그인해 주세요.'
                  : '내 정보를 보려면 고객 계정으로 로그인해 주세요.'}
            </p>
            <button className="pill-button" onClick={() => setLoginOpen(true)}>
              다시 로그인
            </button>
          </>
        ) : !customer ? (
          <p role="alert">마이페이지는 CUSTOMER 계정만 이용할 수 있어요.</p>
        ) : (
          <CustomerAccount
            key={session.user.id}
            route={route}
            session={session}
            sessionSource={sessionSource}
          />
        )}
      </section>
      <nav className="account-return" aria-label="내 정보 탐색">
        <a href="#account">마이페이지</a>
        <a href="#orders">주문 내역</a>
        <a href="#menu-list">메뉴</a>
      </nav>
      {loginOpen && !session.authenticated && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLogin={sessionSource.login}
          waiting={session.phase === 'restoring'}
        />
      )}
    </main>
  );
}
