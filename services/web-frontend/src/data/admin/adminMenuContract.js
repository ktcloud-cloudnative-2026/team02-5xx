export const STATUSES = ['ON_SALE', 'PAUSED', 'HIDDEN'];
export const STATUS_LABELS = {
  ON_SALE: '판매 중',
  PAUSED: '판매 중지',
  HIDDEN: '비공개',
};
export const MAX_INTEGER = 2147483647;

export class MockMenuError extends Error {
  constructor(message, code = 'INVALID_REQUEST', fields = {}) {
    super(message);
    this.name = 'MockMenuError';
    this.code = code;
    this.fields = fields;
  }
}

const fail = (field, message) => {
  throw new MockMenuError(message, 'INVALID_REQUEST', { [field]: message });
};
function text(
  value,
  field,
  { nullable = false, max = Infinity, blank = true } = {},
) {
  if (nullable && value === null) return;
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    [...value].length > max ||
    (!blank && !value.trim())
  )
    fail(field, `${field}: 올바른 문자열을 입력해 주세요.`);
}
function integer(value, field, min = 0, max = MAX_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(
      field,
      `${field}: ${min.toLocaleString()}~${max.toLocaleString()} 범위의 정수를 입력해 주세요.`,
    );
}
function keys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object))
    fail('request', '요청 형식이 올바르지 않습니다.');
  if (Object.keys(object).some((key) => !allowed.includes(key)))
    fail('request', '지원하지 않는 필드가 있습니다.');
}
export function validateStatus(status) {
  if (!STATUSES.includes(status)) fail('status', '판매 상태를 선택해 주세요.');
}
export function validateId(id, field = 'id') {
  integer(id, field, 1, Number.MAX_SAFE_INTEGER);
}
function optionFields(option, prefix, creating, nullDefaults = false) {
  for (const field of ['name', 'extraPrice', 'extraCookTimeSec']) {
    if (!creating && !Object.hasOwn(option, field)) continue;
    if (field === 'name')
      text(option[field], `${prefix}.name`, { blank: false, max: 255 });
    else integer(option[field], `${prefix}.${field}`);
  }
  for (const field of ['isDefault', 'active']) {
    if (
      !Object.hasOwn(option, field) ||
      (nullDefaults && option[field] === null)
    )
      continue;
    if (typeof option[field] !== 'boolean')
      fail(`${prefix}.${field}`, '옵션 설정은 참 또는 거짓이어야 합니다.');
  }
}
export function validateCreate(request) {
  keys(request, [
    'categoryId',
    'name',
    'description',
    'imageUrl',
    'basePrice',
    'cookTimeSec',
    'status',
    'options',
  ]);
  validateId(request.categoryId, 'categoryId');
  text(request.name, 'name', { blank: false, max: 255 });
  integer(request.basePrice, 'basePrice');
  integer(request.cookTimeSec, 'cookTimeSec');
  validateStatus(request.status);
  if (request.description != null) text(request.description, 'description');
  if (request.imageUrl != null)
    text(request.imageUrl, 'imageUrl', { max: 255 });
  if (request.options != null) {
    if (!Array.isArray(request.options))
      fail('options', '옵션은 목록이어야 합니다.');
    request.options.forEach((option, index) => {
      keys(option, [
        'name',
        'extraPrice',
        'extraCookTimeSec',
        'isDefault',
        'active',
      ]);
      optionFields(option, `options.${index}`, true, true);
    });
  }
}
export function validatePatch(request) {
  keys(request, [
    'categoryId',
    'name',
    'description',
    'imageUrl',
    'basePrice',
    'cookTimeSec',
    'options',
  ]);
  if (!Object.keys(request).length)
    fail('request', '변경할 내용을 입력해 주세요.');
  if (Object.hasOwn(request, 'categoryId'))
    validateId(request.categoryId, 'categoryId');
  if (Object.hasOwn(request, 'name'))
    text(request.name, 'name', { blank: false, max: 255 });
  if (Object.hasOwn(request, 'description'))
    text(request.description, 'description', { nullable: true });
  if (Object.hasOwn(request, 'imageUrl'))
    text(request.imageUrl, 'imageUrl', { nullable: true, max: 255 });
  for (const field of ['basePrice', 'cookTimeSec'])
    if (Object.hasOwn(request, field)) integer(request[field], field);
  if (Object.hasOwn(request, 'options')) {
    if (
      !Array.isArray(request.options) ||
      (Object.keys(request).length === 1 && request.options.length === 0)
    )
      fail('options', '변경할 옵션을 입력해 주세요.');
    const ids = new Set();
    request.options.forEach((option, index) => {
      keys(option, [
        'optionId',
        'name',
        'extraPrice',
        'extraCookTimeSec',
        'isDefault',
        'active',
      ]);
      const existing = Object.hasOwn(option, 'optionId');
      if (existing) {
        validateId(option.optionId, `options.${index}.optionId`);
        if (ids.has(option.optionId) || Object.keys(option).length === 1)
          fail('options', '중복 옵션 또는 빈 옵션 변경입니다.');
        ids.add(option.optionId);
      }
      optionFields(option, `options.${index}`, !existing);
    });
  }
}

export function menuToForm(menu, categories) {
  return {
    categoryId: String(menu?.categoryId ?? categories[0]?.id ?? ''),
    name: menu?.name ?? '',
    description: menu?.description ?? '',
    imageUrl: menu?.imageUrl ?? '',
    basePrice: String(menu?.basePrice ?? ''),
    cookTimeSec: String(menu?.cookTimeSec ?? ''),
    status: menu?.status ?? 'PAUSED',
    options: (menu?.options ?? []).map((option) => ({
      ...option,
      key: `existing-${option.id}`,
      extraPrice: String(option.extraPrice),
      extraCookTimeSec: String(option.extraCookTimeSec),
    })),
  };
}
function inputInteger(value, field, min = 0, max = MAX_INTEGER) {
  if (!/^\d+$/.test(value)) fail(field, '비어 있지 않은 정수를 입력해 주세요.');
  const parsed = Number(value);
  integer(parsed, field, min, max);
  return parsed;
}
export function formToRequest(form, original) {
  const values = {
    categoryId: inputInteger(
      form.categoryId,
      'categoryId',
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    name: form.name,
    description: form.description || null,
    imageUrl: form.imageUrl || null,
    basePrice: inputInteger(form.basePrice, 'basePrice'),
    cookTimeSec: inputInteger(form.cookTimeSec, 'cookTimeSec'),
  };
  const options = form.options.map((option, index) => ({
    name: option.name,
    extraPrice: inputInteger(option.extraPrice, `options.${index}.extraPrice`),
    extraCookTimeSec: inputInteger(
      option.extraCookTimeSec,
      `options.${index}.extraCookTimeSec`,
    ),
    isDefault: option.isDefault,
    active: option.active,
  }));
  options.forEach((option, index) =>
    optionFields(option, `options.${index}`, true),
  );
  if (!original) {
    const request = { ...values, status: form.status, options };
    validateCreate(request);
    return request;
  }
  const patch = {};
  for (const [field, value] of Object.entries(values))
    if (value !== original[field]) patch[field] = value;
  const changes = [];
  form.options.forEach((option, index) => {
    if (!option.id) {
      changes.push(options[index]);
      return;
    }
    const before = original.options.find((item) => item.id === option.id);
    if (!before) fail('options', '기존 옵션을 확인할 수 없습니다.');
    const changed = { optionId: option.id };
    for (const [field, value] of Object.entries(options[index]))
      if (value !== before[field]) changed[field] = value;
    if (Object.keys(changed).length > 1) changes.push(changed);
  });
  if (changes.length) patch.options = changes;
  validatePatch(patch);
  return patch;
}
