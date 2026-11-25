import { useRef, useState } from 'react';
import {
  formToRequest,
  menuToForm,
  STATUSES,
  STATUS_LABELS,
} from '../../data/admin/adminMenuContract.js';
import AdminDialog from './AdminDialog.jsx';

export default function AdminMenuEditor({
  menu,
  categories,
  adapter,
  onSaved,
  onClose,
  returnFocusRef,
}) {
  const [form, setForm] = useState(() => menuToForm(menu, categories));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const nextKey = useRef(0);
  const formRef = useRef(null);
  const editing = Boolean(menu);
  const set = (field, value) =>
    setForm((before) => ({ ...before, [field]: value }));
  const setOption = (key, field, value) =>
    setForm((before) => ({
      ...before,
      options: before.options.map((option) =>
        option.key === key ? { ...option, [field]: value } : option,
      ),
    }));
  const field = (name, label, type = 'text') => (
    <label className="am-field">
      <span>{label}</span>
      <input
        name={name}
        data-initial-focus={name === 'name' ? '' : undefined}
        type={type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 2147483647 : undefined}
        step={type === 'number' ? 1 : undefined}
        value={form[name]}
        onChange={(event) => set(name, event.target.value)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `am-error-${name}` : undefined}
      />
      {errors[name] && (
        <small id={`am-error-${name}`} className="am-field-error">
          {errors[name]}
        </small>
      )}
    </label>
  );
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || uncertain) return;
    submitting.current = true;
    setError('');
    setErrors({});
    try {
      const request = formToRequest(form, menu);
      setSaving(true);
      const response = editing
        ? await adapter.update(menu.id, request)
        : await adapter.create(request);
      onSaved(
        response.data.menuId,
        editing ? '메뉴를 수정했습니다.' : '메뉴를 등록했습니다.',
      );
    } catch (failure) {
      setError(failure.message);
      setUncertain(failure.uncertain === true);
      setErrors(failure.fields ?? {});
      requestAnimationFrame(() => {
        const name = Object.keys(failure.fields ?? {})[0];
        const target = [...(formRef.current?.elements ?? [])].find(
          (element) => element.name === name,
        );
        (target ?? formRef.current?.querySelector('[role="alert"]'))?.focus();
      });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <AdminDialog
      drawer
      title={editing ? '메뉴 수정' : '새 메뉴 등록'}
      onClose={onClose}
      busy={saving}
      returnFocusRef={returnFocusRef}
    >
      <form ref={formRef} onSubmit={submit} noValidate>
        <div className="am-dialog-body">
          <div className="am-image-placeholder" aria-hidden="true">
            <span>▧</span>
            <strong>메뉴 이미지</strong>
            <small>이미지 주소 입력 · 파일 업로드 미지원</small>
          </div>
          <p className="am-help">
            {editing
              ? '판매 상태는 목록의 ‘상태 변경’에서 관리합니다. 기존 옵션은 삭제하지 않고 비활성화할 수 있습니다.'
              : '초기 판매 상태를 선택해 주세요.'}
          </p>
          {error && (
            <div className="am-alert" role="alert" tabIndex="-1">
              {error}
            </div>
          )}
          <fieldset disabled={saving}>
            <legend>기본 정보</legend>
            <div className="am-form-grid">
              {field('name', '메뉴 이름 *')}
              <label className="am-field">
                <span>카테고리 *</span>
                <select
                  name="categoryId"
                  value={form.categoryId}
                  onChange={(event) => set('categoryId', event.target.value)}
                  aria-invalid={Boolean(errors.categoryId)}
                >
                  <option value="">선택해 주세요</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && (
                  <small className="am-field-error">{errors.categoryId}</small>
                )}
              </label>
              {field('basePrice', '기본 가격 (원) *', 'number')}
              {field('cookTimeSec', '기본 조리시간 (초) *', 'number')}
              <label className="am-field am-wide">
                <span>설명</span>
                <textarea
                  name="description"
                  rows="3"
                  value={form.description}
                  onChange={(event) => set('description', event.target.value)}
                  aria-invalid={Boolean(errors.description)}
                />
                {errors.description && (
                  <small className="am-field-error">{errors.description}</small>
                )}
              </label>
              <div className="am-wide">
                {field('imageUrl', '이미지 주소 (선택)')}
              </div>
              {!editing && (
                <label className="am-field">
                  <span>초기 판매 상태 *</span>
                  <select
                    name="status"
                    value={form.status}
                    onChange={(event) => set('status', event.target.value)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <small>
                    입력 초깃값은 판매 중지이며, 등록 전에 확인해 주세요.
                  </small>
                </label>
              )}
            </div>
          </fieldset>
          <fieldset disabled={saving}>
            <legend>
              메뉴 옵션{' '}
              <span className="am-muted">{form.options.length}개</span>
            </legend>
            <p className="am-help">
              옵션 0개도 가능합니다. 기본 여부와 활성 여부는 독립적으로
              설정합니다.
            </p>
            {form.options.map((option, index) => (
              <div className="am-option-editor" key={option.key}>
                <div className="am-option-heading">
                  <strong>
                    옵션 {index + 1}{' '}
                    {option.id ? (
                      <small>#{option.id}</small>
                    ) : (
                      <small>신규</small>
                    )}
                  </strong>
                  {!option.id && (
                    <button
                      type="button"
                      className="am-text-button"
                      aria-label={`신규 옵션 ${index + 1} 제거`}
                      onClick={() =>
                        set(
                          'options',
                          form.options.filter(
                            (item) => item.key !== option.key,
                          ),
                        )
                      }
                    >
                      제거
                    </button>
                  )}
                </div>
                <div className="am-option-fields">
                  {[
                    ['name', '옵션 이름', 'text'],
                    ['extraPrice', '추가 가격 (원)', 'number'],
                    ['extraCookTimeSec', '추가 시간 (초)', 'number'],
                  ].map(([name, label, type]) => {
                    const path = `options.${index}.${name}`;
                    return (
                      <label className="am-field" key={name}>
                        <span>{label} *</span>
                        <input
                          name={path}
                          type={type}
                          min={type === 'number' ? 0 : undefined}
                          step={type === 'number' ? 1 : undefined}
                          value={option[name]}
                          onChange={(event) =>
                            setOption(option.key, name, event.target.value)
                          }
                          aria-invalid={Boolean(errors[path])}
                          aria-describedby={
                            errors[path]
                              ? `am-error-option-${index}-${name}`
                              : undefined
                          }
                        />
                        {errors[path] && (
                          <small
                            id={`am-error-option-${index}-${name}`}
                            className="am-field-error"
                          >
                            {errors[path]}
                          </small>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="am-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={option.isDefault}
                      onChange={(event) =>
                        setOption(option.key, 'isDefault', event.target.checked)
                      }
                    />{' '}
                    기본 옵션
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={option.active}
                      onChange={(event) =>
                        setOption(option.key, 'active', event.target.checked)
                      }
                    />{' '}
                    활성 옵션
                  </label>
                  {!option.active && (
                    <span className="am-muted">비활성 · 관리자에게만 표시</span>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="am-button am-secondary"
              onClick={() =>
                set('options', [
                  ...form.options,
                  {
                    key: `new-${nextKey.current++}`,
                    name: '',
                    extraPrice: '0',
                    extraCookTimeSec: '0',
                    isDefault: false,
                    active: true,
                  },
                ])
              }
            >
              + 옵션 추가
            </button>
          </fieldset>
        </div>
        <footer className="am-dialog-footer">
          <span className="am-help">
            {uncertain
              ? '창을 닫고 목록을 새로 조회해 저장 결과를 확인해 주세요.'
              : '* 필수 항목'}
          </span>
          <div>
            <button
              type="button"
              className="am-button am-secondary"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </button>
            <button
              className="am-button"
              type="submit"
              disabled={saving || uncertain}
            >
              {saving ? '저장 중…' : editing ? '변경 저장' : '메뉴 등록'}
            </button>
          </div>
        </footer>
      </form>
    </AdminDialog>
  );
}
