import { useEffect, useRef, useState } from 'react';
import useDialog from '../useDialog.js';

export default function LoginModal({ onClose, onLogin, waiting = false }) {
  const active = useRef(false);
  const request = useRef(null);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { close, ...dialog } = useDialog(() => {
    request.current?.abort();
    onClose();
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || waiting || !onLogin) return;
    submitting.current = true;
    setPending(true);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      await onLogin(
        { email: email.trim(), password, rememberMe },
        { signal: controller.signal },
      );
    } catch (failure) {
      if (active.current && !controller.signal.aborted)
        setError(
          failure.status === 401
            ? '이메일 또는 비밀번호를 확인해 주세요.'
            : failure.kind === 'network'
              ? '인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
              : failure.status === 403
                ? '로그인이 허용되지 않았어요. 계정 또는 요청 출처를 확인해 주세요.'
                : '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
    } finally {
      submitting.current = false;
      if (active.current) {
        setPending(false);
        setPassword('');
      }
    }
  }
  return (
    <dialog
      {...dialog}
      className="login-modal"
      aria-labelledby="login-title"
      aria-describedby="login-description"
    >
      <div className="detail-toolbar">
        <button
          className="close-button"
          aria-label="로그인 안내 닫기"
          onClick={close}
          autoFocus
        >
          ×
        </button>
        <h2 id="login-title">로그인이 필요해요</h2>
      </div>
      <div className="login-content">
        <p id="login-description">
          장바구니와 주문은 로그인 후 이용할 수 있어요.
          <br />
          선택한 메뉴와 옵션, 수량은 그대로 유지됩니다.
        </p>
        <form
          className="login-form"
          onSubmit={submit}
          aria-busy={pending || waiting}
        >
          <label>
            이메일
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending || waiting}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending || waiting}
            />
          </label>
          <label className="remember-login">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              disabled={pending || waiting}
            />
            로그인 유지
          </label>
          <p className="login-error" role={error ? 'alert' : 'status'}>
            {error || (waiting ? '기존 로그인 세션을 확인하고 있어요.' : '')}
          </p>
          <button
            className="pill-button"
            type="submit"
            disabled={pending || waiting || !onLogin}
          >
            {pending ? '로그인 중' : '로그인'}
          </button>
        </form>
        <button className="text-button" onClick={close}>
          선택한 화면으로 돌아가기
        </button>
      </div>
    </dialog>
  );
}
