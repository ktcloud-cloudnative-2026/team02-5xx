import { useEffect, useRef, useState } from 'react';
import {
  createRegistrationApi,
  normalizeRegistrationEmail,
  validateRegistration,
} from './registrationApi.js';
import { registrationTerms, termsReady } from './registrationTerms.js';
import './registration.css';
const defaultApi = createRegistrationApi();

export default function RegistrationForm({
  onBack,
  initialEmail = '',
  api = defaultApi,
  terms: catalog = registrationTerms,
}) {
  const terms = Array.isArray(catalog) ? catalog : registrationTerms;
  const [email, setEmail] = useState(initialEmail),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false),
    [agreements, setAgreements] = useState({ TERMS: false, PRIVACY: false });
  const [availability, setAvailability] = useState({ phase: 'idle' }),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [rejectedTerms, setRejectedTerms] = useState(false);
  const mounted = useRef(false),
    checkRequest = useRef(null),
    submitRequest = useRef(null),
    checkEpoch = useRef(0),
    checking = useRef(false),
    submitting = useRef(false),
    allRef = useRef(null),
    emailRef = useRef(null);
  const ready = termsReady(terms) && !rejectedTerms;
  const all = agreements.TERMS && agreements.PRIVACY;
  useEffect(() => {
    setAgreements({ TERMS: false, PRIVACY: false });
    setRejectedTerms(false);
  }, [catalog]);
  useEffect(() => {
    if (allRef.current)
      allRef.current.indeterminate =
        !all && (agreements.TERMS || agreements.PRIVACY);
  }, [all, agreements]);
  useEffect(() => {
    mounted.current = true;
    emailRef.current?.focus();
    return () => {
      mounted.current = false;
      checkEpoch.current++;
      checking.current = false;
      submitting.current = false;
      checkRequest.current?.abort();
      submitRequest.current?.abort();
    };
  }, []);
  function changeEmail(value) {
    checkEpoch.current++;
    checkRequest.current?.abort();
    checking.current = false;
    setEmail(value);
    setAvailability({ phase: 'idle' });
    setError('');
  }
  async function checkEmail() {
    if (checking.current || submitting.current) return;
    let value;
    try {
      value = normalizeRegistrationEmail(email);
    } catch {
      setError('이메일 형식을 확인해 주세요.');
      emailRef.current?.focus();
      return;
    }
    const epoch = ++checkEpoch.current,
      controller = new AbortController();
    checkRequest.current = controller;
    checking.current = true;
    setAvailability({ phase: 'loading' });
    setError('');
    try {
      const data = await api.checkEmail(value, { signal: controller.signal });
      if (
        mounted.current &&
        !controller.signal.aborted &&
        epoch === checkEpoch.current
      )
        setAvailability({ phase: 'ready', ...data });
    } catch (failure) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        epoch === checkEpoch.current
      )
        setAvailability({ phase: 'error', message: failure.message });
    } finally {
      if (epoch === checkEpoch.current) checking.current = false;
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    let request;
    try {
      if (password !== confirm)
        throw new Error('비밀번호 확인이 일치하지 않아요.');
      request = validateRegistration({
        email,
        password,
        agreements: terms.map(({ type, version }) => ({
          type,
          version,
          agreed: agreements[type],
        })),
      });
      if (
        availability.phase !== 'ready' ||
        !availability.available ||
        availability.email !== request.email
      )
        throw new Error('현재 이메일의 중복 확인을 완료해 주세요.');
    } catch (failure) {
      setError(failure.message);
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    const controller = new AbortController();
    submitRequest.current = controller;
    try {
      const data = await api.register(request, { signal: controller.signal });
      if (mounted.current && !controller.signal.aborted)
        onBack({ email: data.email, registered: true });
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        setError(failure.message);
        setAvailability({ phase: 'idle' });
        if (failure.code === 'INVALID_AGREEMENT_VERSION') {
          setRejectedTerms(true);
          setAgreements({ TERMS: false, PRIVACY: false });
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setPending(false);
        setPassword('');
        setConfirm('');
        setShown(false);
      }
    }
  }
  return (
    <div className="registration-content">
      <p>이메일과 비밀번호로 고객 계정을 만들 수 있어요.</p>
      <form
        className="login-form registration-form"
        noValidate
        onSubmit={submit}
        aria-busy={pending}
      >
        <label>
          이메일
          <input
            ref={emailRef}
            type="email"
            autoComplete="username"
            required
            value={email}
            disabled={pending}
            onChange={(e) => changeEmail(e.target.value)}
          />
        </label>
        <button
          className="text-button"
          type="button"
          disabled={checking.current || pending}
          onClick={checkEmail}
        >
          이메일 중복 확인
        </button>
        <p role={availability.phase === 'error' ? 'alert' : 'status'}>
          {availability.phase === 'loading'
            ? '이메일 확인 중…'
            : availability.phase === 'error'
              ? availability.message
              : availability.phase === 'ready'
                ? availability.available
                  ? '사용할 수 있는 이메일이에요.'
                  : '이미 가입된 이메일이에요.'
                : '이메일을 입력하고 중복 확인해 주세요.'}
        </p>
        <label>
          가입 비밀번호
          <input
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={password}
            disabled={pending}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="registration-password-policy"
          />
        </label>
        <p id="registration-password-policy">
          비밀번호는 12~64자로 입력해 주세요. 공백도 사용할 수 있어요.
        </p>
        <label>
          가입 비밀번호 확인
          <input
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirm}
            disabled={pending}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button
          className="text-button"
          type="button"
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          disabled={pending}
        >
          {shown ? '비밀번호 숨기기' : '비밀번호 보기'}
        </button>
        {!ready && (
          <p role="alert">
            확정된 이용약관·개인정보 처리 동의 내용과 버전을 확인할 수 없어 현재
            회원가입을 진행할 수 없어요.
          </p>
        )}
        <fieldset disabled={pending || !ready}>
          <legend>필수 약관 동의</legend>
          <label>
            <input
              ref={allRef}
              type="checkbox"
              checked={all}
              onChange={(e) =>
                setAgreements({
                  TERMS: e.target.checked,
                  PRIVACY: e.target.checked,
                })
              }
            />
            전체 동의
          </label>
          {['TERMS', 'PRIVACY'].map((type) => {
            const term = terms.find((t) => t.type === type);
            return (
              <div key={type}>
                <label>
                  <input
                    type="checkbox"
                    checked={agreements[type]}
                    onChange={(e) =>
                      setAgreements({ ...agreements, [type]: e.target.checked })
                    }
                  />
                  {type === 'TERMS'
                    ? '이용약관 동의 (필수)'
                    : '개인정보 수집·이용 동의 (필수)'}
                </label>
                {term && (
                  <details
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && event.currentTarget.open) {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector('summary')?.focus();
                      }
                    }}
                  >
                    <summary>{term.title} 전문 보기</summary>
                    <div
                      className="registration-policy-text"
                      role="region"
                      aria-label={`${term.title} 전문`}
                      tabIndex={0}
                    >
                      <p>{term.text}</p>
                    </div>
                    <p>버전: {term.version}</p>
                  </details>
                )}
              </div>
            );
          })}
        </fieldset>
        <p className="login-error" role={error ? 'alert' : 'status'}>
          {error}
        </p>
        <button
          className="pill-button"
          type="submit"
          disabled={pending || !ready}
        >
          {pending ? '가입 요청 중…' : '회원가입 요청'}
        </button>
      </form>
      <button
        className="text-button"
        type="button"
        disabled={pending}
        onClick={() => onBack({ email })}
      >
        로그인으로 돌아가기
      </button>
    </div>
  );
}
