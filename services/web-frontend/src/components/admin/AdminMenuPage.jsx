import { useEffect, useRef, useState } from 'react';
import { STATUSES, STATUS_LABELS } from '../../data/admin/adminMenuContract.js';
import AdminDialog from './AdminDialog.jsx';
import AdminMenuEditor from './AdminMenuEditor.jsx';
import './admin.css';

const won = (value) => `${value.toLocaleString('ko-KR')}원`;
const date = (value) => new Date(value).toLocaleString('ko-KR');
function StatusBadge({ status }) {
  return (
    <span className={`am-badge am-${status}`}>
      <i aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatusDialog({ menu, adapter, onSaved, onClose, returnFocusRef }) {
  const [status, setStatus] = useState(menu.status);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adapter.changeStatus(menu.id, status);
      onSaved(
        menu.id,
        status === menu.status
          ? '동일한 모의 상태를 유지했습니다.'
          : '모의 판매 상태를 변경했습니다.',
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <AdminDialog
      title="판매 상태 변경"
      onClose={onClose}
      busy={saving}
      returnFocusRef={returnFocusRef}
    >
      <form onSubmit={save}>
        <div className="am-dialog-body">
          <h3>{menu.name}</h3>
          <p className="am-help">
            세 상태 사이의 전이와 비공개 메뉴 복귀를 허용하는 제안 계약입니다.
            재고·품절과는 별개입니다.
          </p>
          {error && (
            <div className="am-alert" role="alert">
              {error}
            </div>
          )}
          <label className="am-field">
            <span>변경할 판매 상태</span>
            <select
              data-initial-focus=""
              disabled={saving}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {STATUSES.map((state) => (
                <option value={state} key={state}>
                  {STATUS_LABELS[state]}
                </option>
              ))}
            </select>
          </label>
          <p className="am-help">
            동일한 상태를 저장하면 수정 시각이 유지됩니다.
          </p>
        </div>
        <footer className="am-dialog-footer">
          <span className="am-help">실제 서버 변경 없음</span>
          <div>
            <button
              type="button"
              className="am-button am-secondary"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </button>
            <button className="am-button" disabled={saving}>
              {saving ? '모의 저장 중…' : '상태 저장'}
            </button>
          </div>
        </footer>
      </form>
    </AdminDialog>
  );
}

export default function AdminMenuPage({ adapter }) {
  const [filters, setFilters] = useState({
    query: '',
    categoryId: '',
    status: '',
    sort: 'default',
  });
  const [result, setResult] = useState({ categories: [], menus: [] });
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [modal, setModal] = useState(null);
  const opener = useRef(null);
  const detailTicket = useRef(0);
  useEffect(() => {
    let current = true;
    setPhase('loading');
    setError('');
    adapter
      .list({
        ...filters,
        categoryId: filters.categoryId ? Number(filters.categoryId) : null,
        status: filters.status || null,
      })
      .then((response) => {
        if (current) {
          setResult(response.data);
          setPhase('ready');
        }
      })
      .catch((failure) => {
        if (current) {
          setError(`목록을 불러오지 못했습니다. ${failure.message}`);
          setPhase('error');
        }
      });
    return () => {
      current = false;
    };
  }, [adapter, filters, epoch]);
  useEffect(() => {
    if (
      !modal &&
      phase !== 'loading' &&
      document.activeElement === document.body &&
      opener.current
    ) {
      if (opener.current.isConnected && !opener.current.disabled)
        opener.current.focus();
      else document.querySelector('[data-admin-focus-fallback]')?.focus();
    }
  }, [modal, phase]);
  const filter = (name, value) =>
    setFilters((previous) => ({ ...previous, [name]: value }));
  function close() {
    detailTicket.current++;
    setModal(null);
  }
  function saved(id, message) {
    setNotice(`${message} (메뉴 #${id})`);
    setModal(null);
    setEpoch((value) => value + 1);
  }
  async function open(menuId, type, event) {
    opener.current = event.currentTarget;
    const ticket = ++detailTicket.current;
    setModal({ type: 'loading' });
    try {
      const response = await adapter.detail(menuId);
      if (ticket === detailTicket.current)
        setModal({ type, menu: response.data });
    } catch (failure) {
      if (ticket === detailTicket.current) {
        setModal(null);
        setError(`메뉴를 불러오지 못했습니다. ${failure.message}`);
      }
    }
  }
  const categoryName = (id) =>
    result.categories.find((category) => category.id === id)?.name ?? '미지정';
  return (
    <div className="am-shell">
      <a className="am-skip" href="#am-menu-list">
        메뉴 목록으로 건너뛰기
      </a>
      <aside className="am-sidebar">
        <div className="am-brand">
          <span className="am-brand-mark" aria-hidden="true">
            P
          </span>
          PEAK ORDER
        </div>
        <span className="am-workspace">매장 워크스페이스</span>
        <div className="am-nav-current" aria-current="page">
          <span aria-hidden="true">▦</span> 메뉴 관리
        </div>
        <div className="am-sidebar-note">
          <span className="am-dot" />
          독립 Mock 미리보기
          <br />
          <small>실제 서버·인증 미연동</small>
        </div>
      </aside>
      <main className="am-main">
        <div className="am-preview-banner">
          <strong>MOCK PREVIEW</strong>
          <span>
            모의 데이터만 사용합니다. 실제 관리자 인증과 API는 연결되지
            않았습니다. 새로고침하면 샘플로 돌아갑니다.
          </span>
        </div>
        <header className="am-page-heading">
          <div>
            <span className="am-eyebrow">STORE / MENU MANAGEMENT</span>
            <h1>
              메뉴 관리<span className="am-title-dot">.</span>
            </h1>
            <p>메뉴 정보와 옵션, 판매 상태를 한곳에서 관리하세요.</p>
          </div>
          <button
            data-admin-focus-fallback=""
            className="am-button am-create"
            disabled={!result.categories.length}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setModal({ type: 'create' });
            }}
          >
            <span aria-hidden="true">＋</span> 새 메뉴 등록
          </button>
        </header>
        {notice && (
          <div className="am-notice" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="am-alert am-list-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="am-text-button"
              onClick={() => setEpoch((value) => value + 1)}
            >
              다시 불러오기
            </button>
          </div>
        )}
        <section className="am-panel" aria-label="메뉴 조회 조건">
          <div className="am-filter-grid">
            <label className="am-field am-search">
              <span>메뉴 검색</span>
              <input
                type="search"
                placeholder="메뉴 이름으로 검색"
                value={filters.query}
                onChange={(event) => filter('query', event.target.value)}
              />
            </label>
            <label className="am-field">
              <span>카테고리</span>
              <select
                value={filters.categoryId}
                onChange={(event) => filter('categoryId', event.target.value)}
              >
                <option value="">전체 카테고리</option>
                {result.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="am-field">
              <span>판매 상태</span>
              <select
                value={filters.status}
                onChange={(event) => filter('status', event.target.value)}
              >
                <option value="">전체 상태</option>
                {STATUSES.map((state) => (
                  <option key={state} value={state}>
                    {STATUS_LABELS[state]}
                  </option>
                ))}
              </select>
            </label>
            <label className="am-field">
              <span>정렬</span>
              <select
                value={filters.sort}
                onChange={(event) => filter('sort', event.target.value)}
              >
                <option value="default">기본 순서</option>
                <option value="priceAsc">낮은 가격순</option>
                <option value="priceDesc">높은 가격순</option>
              </select>
            </label>
          </div>
          <div className="am-filter-bottom">
            <p>비공개 메뉴와 비활성 옵션도 관리자에게 표시합니다.</p>
            <button
              type="button"
              className="am-text-button"
              onClick={() =>
                setFilters({
                  query: '',
                  categoryId: '',
                  status: '',
                  sort: 'default',
                })
              }
            >
              조회 조건 초기화
            </button>
          </div>
        </section>
        <section
          id="am-menu-list"
          aria-labelledby="am-list-heading"
          aria-busy={phase === 'loading'}
          tabIndex="-1"
        >
          <div className="am-list-heading">
            <h2 id="am-list-heading">
              전체 메뉴 <span>{result.menus.length}</span>
            </h2>
            <div className="am-list-meta">
              <span role="status">
                {phase === 'loading' ? '불러오는 중…' : '현재 조회 조건 기준'}
              </span>
              <button
                type="button"
                className="am-text-button"
                disabled={phase === 'loading'}
                onClick={() => setEpoch((value) => value + 1)}
              >
                새로고침
              </button>
            </div>
          </div>
          <div className="am-table-head" aria-hidden="true">
            <span>메뉴 정보</span>
            <span>기본 가격 / 조리시간</span>
            <span>판매 상태</span>
            <span>관리</span>
          </div>
          {phase === 'loading' && !result.menus.length && (
            <div className="am-skeleton" aria-label="메뉴 목록을 불러오는 중">
              <i />
              <i />
              <i />
            </div>
          )}
          <ul className="am-menu-list">
            {result.menus.map((menu) => (
              <li key={menu.id} className="am-menu-row">
                <div className="am-menu-cell">
                  <span
                    className={`am-menu-avatar am-category-${menu.categoryId}`}
                    aria-hidden="true"
                  >
                    {[...menu.name][0]}
                  </span>
                  <div>
                    <span className="am-category-label">
                      {categoryName(menu.categoryId)} · #{menu.id}
                    </span>
                    <button
                      className="am-menu-name"
                      disabled={phase === 'loading'}
                      onClick={(event) => open(menu.id, 'detail', event)}
                    >
                      {menu.name}
                    </button>
                  </div>
                </div>
                <div className="am-price-cell">
                  <strong>{won(menu.basePrice)}</strong>
                  <span>{menu.cookTimeSec}초</span>
                </div>
                <div className="am-status-cell">
                  <StatusBadge status={menu.status} />
                </div>
                <div className="am-row-actions">
                  <button
                    disabled={phase === 'loading'}
                    className="am-text-button"
                    aria-label={`${menu.name} 수정`}
                    onClick={(event) => open(menu.id, 'edit', event)}
                  >
                    수정
                  </button>
                  <button
                    disabled={phase === 'loading'}
                    className="am-row-state"
                    aria-label={`${menu.name} 상태 변경`}
                    onClick={(event) => open(menu.id, 'status', event)}
                  >
                    상태 변경
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {phase === 'ready' && result.menus.length === 0 && (
            <div className="am-empty">
              <span aria-hidden="true">⌕</span>
              <h3>표시할 메뉴가 없습니다</h3>
              <p>조회 조건을 바꾸거나 새 메뉴를 등록해 보세요.</p>
              <button
                className="am-button am-secondary"
                onClick={() =>
                  setFilters({
                    query: '',
                    categoryId: '',
                    status: '',
                    sort: 'default',
                  })
                }
              >
                조회 조건 초기화
              </button>
            </div>
          )}
        </section>
        <footer className="am-page-footer">
          <span>PEAK ORDER · 관리자 메뉴 관리</span>
          <span>ME-03~07 제안 계약 기반 · 재고 연동 없음</span>
        </footer>
      </main>
      {modal?.type === 'loading' && (
        <AdminDialog
          title="메뉴 불러오는 중"
          onClose={close}
          returnFocusRef={opener}
        >
          <div className="am-dialog-body" role="status">
            모의 상세 데이터를 불러오고 있습니다…
          </div>
        </AdminDialog>
      )}
      {['create', 'edit'].includes(modal?.type) && (
        <AdminMenuEditor
          key={`${modal.type}-${modal.menu?.id ?? 'new'}`}
          menu={modal.menu}
          categories={result.categories}
          adapter={adapter}
          onSaved={saved}
          onClose={close}
          returnFocusRef={opener}
        />
      )}
      {modal?.type === 'status' && (
        <StatusDialog
          menu={modal.menu}
          adapter={adapter}
          onSaved={saved}
          onClose={close}
          returnFocusRef={opener}
        />
      )}
      {modal?.type === 'detail' && (
        <AdminDialog title="메뉴 상세" onClose={close} returnFocusRef={opener}>
          <div className="am-dialog-body">
            <div className="am-detail-title">
              <div>
                <span className="am-category-label">
                  {categoryName(modal.menu.categoryId)} · #{modal.menu.id}
                </span>
                <h3>{modal.menu.name}</h3>
              </div>
              <StatusBadge status={modal.menu.status} />
            </div>
            <p className="am-description">
              {modal.menu.description ?? '등록된 설명이 없습니다.'}
            </p>
            <dl className="am-detail-grid">
              <div>
                <dt>기본 가격</dt>
                <dd>{won(modal.menu.basePrice)}</dd>
              </div>
              <div>
                <dt>기본 조리시간</dt>
                <dd>{modal.menu.cookTimeSec}초</dd>
              </div>
              <div className="am-wide">
                <dt>이미지 주소</dt>
                <dd>{modal.menu.imageUrl || '미등록'}</dd>
              </div>
              <div>
                <dt>등록 시각</dt>
                <dd>{date(modal.menu.createdAt)}</dd>
              </div>
              <div>
                <dt>수정 시각</dt>
                <dd>{date(modal.menu.updatedAt)}</dd>
              </div>
            </dl>
            <h3>
              옵션{' '}
              <span className="am-muted">{modal.menu.options.length}개</span>
            </h3>
            {modal.menu.options.length ? (
              <ul className="am-detail-options">
                {modal.menu.options.map((option) => (
                  <li key={option.id}>
                    <div>
                      <strong>{option.name}</strong>
                      <span className="am-muted">
                        #{option.id} ·{' '}
                        {option.isDefault ? '기본 옵션' : '추가 옵션'} ·{' '}
                        {option.active ? '활성' : '비활성'}
                      </span>
                    </div>
                    <span>
                      +{won(option.extraPrice)}
                      <small>+{option.extraCookTimeSec}초</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="am-help">등록된 옵션이 없습니다.</p>
            )}
          </div>
          <footer className="am-dialog-footer">
            <button className="am-button am-secondary" onClick={close}>
              닫기
            </button>
            <button
              className="am-button"
              onClick={() => setModal({ type: 'edit', menu: modal.menu })}
            >
              이 메뉴 수정
            </button>
          </footer>
        </AdminDialog>
      )}
    </div>
  );
}
