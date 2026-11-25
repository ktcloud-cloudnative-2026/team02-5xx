import { useEffect, useRef, useState } from 'react';
import useDialog from '../useDialog.js';
import RegistrationForm from '../registration/RegistrationForm.jsx';

export default function LoginModal({
  onClose,
  onLogin,
  waiting = false,
  registrationApi,
  registrationTerms,
}) {
  const active = useRef(false);
  const request = useRef(null);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registrationNotice, setRegistrationNotice] = useState('');
  const registrationLink = useRef(null);
  useEffect(() => {
    if (!registering && registrationLink.current)
      registrationLink.current.focus();
  }, [registering]);
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
              ? '로그인에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
              : failure.status === 403
                ? '이 계정으로 로그인할 수 없어요. 다른 계정을 확인해 주세요.'
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
      aria-labelledby={registering ? 'registration-title' : 'login-title'}
      aria-describedby={registering ? undefined : 'login-description'}
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
        <h2 id={registering ? 'registration-title' : 'login-title'}>
          {registering ? '회원가입' : '로그인'}
        </h2>
      </div>
      {registering ? (
        <RegistrationForm
          api={registrationApi}
          terms={registrationTerms}
          initialEmail={email}
          onBack={({ email, registered }) => {
            setEmail(email);
            setPassword('');
            setError('');
            setRegistering(false);
            setRegistrationNotice(
              registered
                ? '회원가입을 완료했어요. 자동 로그인되지 않으니 새 계정으로 로그인해 주세요.'
                : '',
            );
          }}
        />
      ) : (
        <div className="login-content">
          {registrationNotice && <p role="status">{registrationNotice}</p>}
          <p id="login-description">
            장바구니는 로그인 없이 이용할 수 있어요. 주문할 때 로그인해 주세요.
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
              {error || (waiting ? '로그인 정보를 확인하고 있어요.' : '')}
            </p>
            <button
              className="pill-button"
              type="submit"
              disabled={pending || waiting || !onLogin}
            >
              {pending ? '로그인 중' : '로그인'}
            </button>
          </form>
          <button
            ref={registrationLink}
            className="text-button"
            disabled={pending || waiting}
            onClick={() => {
              setPassword('');
              setError('');
              setRegistrationNotice('');
              setRegistering(true);
            }}
          >
            회원가입
          </button>
          <button className="text-button" onClick={close}>
            선택한 화면으로 돌아가기
          </button>
        </div>
      )}
    </dialog>
  );
}
