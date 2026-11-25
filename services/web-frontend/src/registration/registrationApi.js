import { createAuthApi } from '../authApi.js';

export class RegistrationError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const invalid = () =>
  new RegistrationError(
    'INVALID_REQUEST',
    '이메일과 가입 정보를 확인해 주세요.',
  );
export function normalizeRegistrationEmail(value) {
  if (typeof value !== 'string') throw invalid();
  const email = value.trim(),
    at = email.lastIndexOf('@');
  // Basic client check only; the server's Jakarta @Email policy is authoritative.
  if (
    email.length > 254 ||
    at <= 0 ||
    at === email.length - 1 ||
    /[\s\x00-\x1f\x7f]/u.test(email) ||
    email.indexOf('@') !== at
  )
    throw invalid();
  return email.slice(0, at + 1) + email.slice(at + 1).toLowerCase();
}
export function validateRegistration(request) {
  const { email, password, agreements } = request ?? {};
  const normalized = normalizeRegistrationEmail(email);
  if (
    typeof password !== 'string' ||
    [...password].length < 12 ||
    [...password].length > 64 ||
    !Array.isArray(agreements) ||
    agreements.length !== 2 ||
    !['TERMS', 'PRIVACY'].every(
      (type) =>
        agreements.filter(
          (a) =>
            a?.type === type &&
            typeof a.version === 'string' &&
            a.version.trim() &&
            a.version.length <= 64 &&
            a.agreed === true,
        ).length === 1,
    )
  )
    throw invalid();
  return {
    email: normalized,
    password,
    agreements: agreements.map(({ type, version, agreed }) => ({
      type,
      version,
      agreed,
    })),
  };
}
const messages = {
  INVALID_REQUEST: '가입 정보의 형식과 비밀번호 길이를 확인해 주세요.',
  REQUIRED_AGREEMENT_MISSING: '필수 약관에 모두 동의해 주세요.',
  INVALID_AGREEMENT_VERSION:
    '약관 버전이 변경됐거나 준비되지 않았어요. 가입을 진행할 수 없어요.',
  EMAIL_ALREADY_EXISTS:
    '이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 사용해 주세요.',
  REGISTRATION_UNAVAILABLE:
    '회원가입 서비스가 아직 준비되지 않았어요. 잠시 후 다시 확인해 주세요.',
};
export function createRegistrationApi({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const transport = createAuthApi({ fetchImpl, timeoutMs });
  async function call(path, method, body, signal, expected) {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await transport.send(`/api/v1/auth/${path}`, {
        method,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let json;
      try {
        json = await response.json();
      } catch {
        throw new RegistrationError(
          'INVALID_RESPONSE',
          '가입 결과를 확인하지 못했어요. 이메일 중복 확인이나 로그인으로 결과를 확인해 주세요.',
        );
      }
      if (signal?.aborted)
        throw new RegistrationError('CANCELLED', '요청을 취소했어요.');
      if (response.status !== expected || json?.success !== true) {
        const code =
          json?.success === false && typeof json.errorCode === 'string'
            ? json.errorCode
            : 'HTTP_ERROR';
        const valid =
          {
            INVALID_REQUEST: 400,
            REQUIRED_AGREEMENT_MISSING: 400,
            INVALID_AGREEMENT_VERSION: 400,
            EMAIL_ALREADY_EXISTS: 409,
            REGISTRATION_UNAVAILABLE: 503,
          }[code] === response.status;
        throw new RegistrationError(
          valid ? code : 'HTTP_ERROR',
          valid
            ? messages[code]
            : '가입 요청을 처리하지 못했어요. 결과가 불명확하면 이메일 중복 확인 또는 로그인으로 확인해 주세요.',
          response.status,
        );
      }
      if (typeof json.message !== 'string' || !json.data)
        throw new RegistrationError(
          'INVALID_RESPONSE',
          '가입 결과를 확인하지 못했어요. 이메일 중복 확인이나 로그인으로 결과를 확인해 주세요.',
        );
      return json.data;
    } catch (error) {
      if (signal?.aborted)
        throw new RegistrationError('CANCELLED', '요청을 취소했어요.');
      if (timeout.aborted)
        throw new RegistrationError(
          'TIMEOUT',
          '요청 시간이 초과됐어요. 가입 결과는 이메일 중복 확인 또는 로그인으로 확인해 주세요.',
        );
      if (error instanceof RegistrationError) throw error;
      throw new RegistrationError(
        'NETWORK_ERROR',
        '연결이 끊겼어요. 이메일 중복 확인이나 로그인으로 가입 결과를 확인해 주세요.',
      );
    }
  }
  return {
    async checkEmail(value, { signal } = {}) {
      const email = normalizeRegistrationEmail(value);
      const data = await call(
        `email-availability?email=${encodeURIComponent(email)}`,
        'GET',
        null,
        signal,
        200,
      );
      if (data.email !== email || typeof data.available !== 'boolean')
        throw new RegistrationError(
          'INVALID_RESPONSE',
          '이메일 확인 응답을 확인하지 못했어요.',
        );
      return { email, available: data.available };
    },
    async register(request, { signal } = {}) {
      const body = validateRegistration(request);
      const data = await call('register', 'POST', body, signal, 201);
      if (
        !Number.isSafeInteger(data.id) ||
        data.id <= 0 ||
        data.email !== body.email
      )
        throw new RegistrationError(
          'INVALID_RESPONSE',
          '가입 응답을 확인하지 못했어요. 이메일 중복 확인 또는 로그인으로 결과를 확인해 주세요.',
        );
      return { id: data.id, email: data.email };
    },
  };
}
