import {
  STATUSES,
  validateCreate,
  validateId,
  validatePatch,
  validateStatus,
} from './adminMenuContract.js';

export class AdminMenuError extends Error {
  constructor(
    message,
    { status = 0, code = '', kind = 'http', uncertain = false } = {},
  ) {
    super(message);
    Object.assign(this, { status, code, kind, uncertain });
  }
}
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const whole = (n) => Number.isInteger(n) && n >= 0 && n <= 2147483647;
const text = (s) => typeof s === 'string' && s.trim().length > 0;
const nullable = (s) => s === null || typeof s === 'string';
const protocol = () => {
  throw new AdminMenuError(
    '메뉴 응답을 확인할 수 없어요. 다시 조회해 주세요.',
    { kind: 'protocol' },
  );
};
export function validateAdminMenu(menu, detail = false) {
  if (
    !menu ||
    !positive(menu.id) ||
    !positive(menu.categoryId) ||
    !text(menu.name) ||
    !nullable(menu.imageUrl) ||
    !whole(menu.basePrice) ||
    !whole(menu.cookTimeSec) ||
    !STATUSES.includes(menu.status)
  )
    protocol();
  if (detail) {
    if (
      !nullable(menu.description) ||
      !text(menu.createdAt) ||
      !Number.isFinite(Date.parse(menu.createdAt)) ||
      !text(menu.updatedAt) ||
      !Number.isFinite(Date.parse(menu.updatedAt)) ||
      !Array.isArray(menu.options)
    )
      protocol();
    const ids = new Set();
    for (const option of menu.options) {
      if (
        !positive(option?.id) ||
        ids.has(option.id) ||
        !text(option.name) ||
        !whole(option.extraPrice) ||
        !whole(option.extraCookTimeSec) ||
        typeof option.isDefault !== 'boolean' ||
        typeof option.active !== 'boolean'
      )
        protocol();
      ids.add(option.id);
    }
  }
  return menu;
}

/** ME-03~07. Same-origin HTTP only; no mock fallback or mutation replay. */
export function createAdminMenuApi({
  request = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  async function call(path, { method = 'GET', body, signal } = {}, validate) {
    const write = method !== 'GET';
    try {
      const response = await request(`/api/v1/admin/menus${path}`, {
        method,
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(write ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401 || response.status === 403)
        throw new AdminMenuError(
          response.status === 401
            ? '로그인이 만료됐어요. 다시 로그인해 주세요.'
            : '메뉴 관리 권한이 없어요. 관리자 접근 설정을 확인해 주세요.',
          {
            status: response.status,
            code: response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          },
        );
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        protocol();
      }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
        protocol();
      if (!response.ok || envelope.success !== true)
        throw new AdminMenuError(
          response.status === 404
            ? '메뉴를 찾을 수 없어요. 목록을 다시 조회해 주세요.'
            : write && response.status >= 500
              ? '저장 결과를 확인할 수 없어요. 다시 저장하기 전에 메뉴를 조회해 주세요.'
              : '요청을 처리하지 못했어요. 입력과 연결을 확인해 주세요.',
          {
            status: response.status,
            code: envelope.errorCode,
            uncertain: write && response.status >= 500,
          },
        );
      validate(envelope.data);
      signal?.throwIfAborted();
      return envelope;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof AdminMenuError) {
        if (write && error.kind === 'protocol') error.uncertain = true;
        throw error;
      }
      throw new AdminMenuError(
        write
          ? '저장 결과를 확인할 수 없어요. 다시 저장하기 전에 메뉴를 조회해 주세요.'
          : '메뉴를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
        { kind: 'network', uncertain: write },
      );
    }
  }
  return {
    kind: 'http',
    list(
      { categoryId = null, query = '', status = null, sort = 'default' } = {},
      options = {},
    ) {
      if (categoryId !== null) validateId(categoryId, 'categoryId');
      if (status !== null) validateStatus(status);
      if (
        typeof query !== 'string' ||
        !['default', 'priceAsc', 'priceDesc'].includes(sort)
      )
        throw new AdminMenuError('조회 조건을 확인해 주세요.', {
          kind: 'input',
        });
      const params = new URLSearchParams({ query, sort });
      if (categoryId !== null) params.set('categoryId', categoryId);
      if (status !== null) params.set('status', status);
      return call(`?${params}`, options, (data) => {
        if (!Array.isArray(data?.categories) || !Array.isArray(data?.menus))
          protocol();
        for (const rows of [data.categories, data.menus])
          if (new Set(rows.map((row) => row?.id)).size !== rows.length)
            protocol();
        data.categories.forEach((row) => {
          if (!positive(row?.id) || !text(row.name)) protocol();
        });
        data.menus.forEach((menu) => validateAdminMenu(menu));
      });
    },
    detail(id, options = {}) {
      validateId(id);
      return call(`/${id}`, options, (data) => {
        validateAdminMenu(data, true);
        if (data.id !== id) protocol();
      });
    },
    create(body, options = {}) {
      validateCreate(body);
      return call('', { ...options, method: 'POST', body }, (data) => {
        if (!positive(data?.menuId)) protocol();
      });
    },
    update(id, body, options = {}) {
      validateId(id);
      validatePatch(body);
      return call(`/${id}`, { ...options, method: 'PATCH', body }, (data) => {
        if (data?.menuId !== id) protocol();
      });
    },
    changeStatus(id, status, options = {}) {
      validateId(id);
      validateStatus(status);
      return call(
        `/${id}/status`,
        { ...options, method: 'PATCH', body: { status } },
        (data) => {
          if (data?.menuId !== id || data.status !== status) protocol();
        },
      );
    },
  };
}
