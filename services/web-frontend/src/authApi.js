export class AuthError extends Error {
  constructor(message, { status = 0, kind = 'http', response } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.response = response;
  }
}

export function authFailure(status, response) {
  return new AuthError(
    status === 401
      ? '인증 정보를 확인할 수 없어요. 다시 로그인해 주세요.'
      : status === 403
        ? '요청 권한 또는 요청 출처가 허용되지 않았어요.'
        : '인증 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    { status, response },
  );
}

function protocolFailure() {
  throw new AuthError('인증 서버 응답을 확인할 수 없어요.', {
    kind: 'protocol',
  });
}

export function validateAuthUser(user, { profile = false } = {}) {
  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.email !== 'string' ||
    !user.email.trim() ||
    !['CUSTOMER', 'STORE_ADMIN'].includes(user.role) ||
    (profile && user.nickname !== null && typeof user.nickname !== 'string')
  )
    protocolFailure();
  return Object.freeze({
    id: user.id,
    email: user.email,
    role: user.role,
    nickname: profile ? user.nickname : null,
  });
}

function tokenData(data) {
  if (
    !data ||
    typeof data.accessToken !== 'string' ||
    !data.accessToken ||
    /[\s\x00-\x1f\x7f]/.test(data.accessToken) ||
    data.tokenType !== 'Bearer' ||
    data.expiresIn !== 900
  )
    protocolFailure();
  return { accessToken: data.accessToken, user: validateAuthUser(data.user) };
}

export function createAuthApi({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  async function send(path, { signal, ...options } = {}) {
    // Never attach credentials to caller-selected external origins.
    if (
      typeof path !== 'string' ||
      !path.startsWith('/api/v1/') ||
      /[\\\r\n]/.test(path)
    ) {
      throw new AuthError('허용되지 않은 API 경로입니다.', { kind: 'request' });
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await fetchImpl(path, {
        ...options,
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted)
        throw new AuthError('인증 요청을 취소했어요.', { kind: 'cancelled' });
      throw new AuthError('인증 서버에 연결할 수 없어요. 다시 시도해 주세요.', {
        kind: 'network',
      });
    }
  }

  async function call(
    path,
    { method = 'POST', accessToken, body, signal, status = 200 } = {},
  ) {
    const headers = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await send(`/api/v1/auth/${path}`, {
      method,
      headers,
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status !== status) {
      const error = authFailure(response.status, response);
      try {
        const failure = await response.clone().json();
        error.errorCode = failure?.errorCode;
      } catch {
        /* Preserve HTTP status for non-JSON failures. */
      }
      throw error;
    }
    if (status === 204) return; // Logout has no JSON body.
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      protocolFailure();
    }
    if (envelope?.success !== true || !envelope.data) protocolFailure();
    return envelope.data;
  }

  return {
    send,
    async login({ email, password, rememberMe = false }, options = {}) {
      if (
        typeof email !== 'string' ||
        !email.trim() ||
        typeof password !== 'string' ||
        !password ||
        typeof rememberMe !== 'boolean'
      ) {
        throw new AuthError('이메일과 비밀번호를 확인해 주세요.', {
          kind: 'request',
        });
      }
      return tokenData(
        await call('login', {
          ...options,
          body: { email, password, rememberMe },
        }),
      );
    },
    async me(accessToken, options = {}) {
      return validateAuthUser(
        await call('me', { ...options, method: 'GET', accessToken }),
        { profile: true },
      );
    },
    async updateProfile(accessToken, nickname, options = {}) {
      return validateAuthUser(
        await call('me', {
          ...options,
          method: 'PATCH',
          accessToken,
          body: { nickname },
        }),
        { profile: true },
      );
    },
    async changePassword(
      accessToken,
      { currentPassword, newPassword },
      options = {},
    ) {
      await call('me/password', {
        ...options,
        method: 'PATCH',
        accessToken,
        body: { currentPassword, newPassword },
        status: 204,
      });
    },
    async refresh(options = {}) {
      return tokenData(await call('refresh', options));
    },
    async logout(options = {}) {
      await call('logout', { ...options, status: 204 });
    },
  };
}
