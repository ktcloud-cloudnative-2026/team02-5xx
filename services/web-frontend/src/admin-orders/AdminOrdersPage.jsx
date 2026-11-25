import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import useDialog from '../useDialog.js';
import {
  ORDER_STATUSES,
  createAdminOrderApi,
  defaultSearch,
  adminSearchParams,
} from './adminOrderApi.js';
import { createAdminOrderStore } from './adminOrderStore.js';
import {
  parseAdminRoute,
  navigateAdmin,
  useAdminRoute,
} from './adminOrderRoute.js';
import './adminOrders.css';

const defaultApi = createAdminOrderApi();
const money = (value) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;
const date = (value) =>
  value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '기록 없음';
const reasonLabels = {
  REFUND_NOT_REFUNDABLE: '환불할 수 없는 결제 상태',
  RESTORE_NOT_APPLICABLE: '재고 복원을 적용할 수 없는 상태',
  RETRY_LIMIT_EXCEEDED: '자동 재시도 횟수 초과',
};
function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {name === 'grid' ? (
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      ) : name === 'box' ? (
        <path d="M3 4h18v5H3zM5 9v12h14V9M9 13h6" />
      ) : name === 'menu' ? (
        <path d="M5 3h14v18H5zM9 3v18M12 7h4M12 11h4" />
      ) : (
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />
      )}
    </svg>
  );
}
function Status({ value }) {
  return (
    <span className={`ao-badge ao-status-${value.toLowerCase()}`}>
      {ORDER_STATUSES[value]}
    </span>
  );
}
function Failure({ error, retry }) {
  return (
    <div className="ao-message" role="alert">
      <h2>
        {error.status === 401
          ? '관리자 인증 확인이 필요해요'
          : error.status === 403
            ? '조회 권한이 없어요'
            : '주문을 확인하지 못했어요'}
      </h2>
      <p>{error.message}</p>
      {![401, 403, 404].includes(error.status) && (
        <button className="ao-button" onClick={retry}>
          다시 조회
        </button>
      )}
    </div>
  );
}
function Detail({ state, retry, onClose }) {
  const { close, ...dialog } = useDialog(onClose);
  const order = state.data;
  const refundNeeded =
    order?.status === 'FAILED' && order.failReason?.endsWith('_REFUND_NEEDED');
  return (
    <dialog {...dialog} className="ao-detail" aria-labelledby="ao-detail-title">
      <header className="ao-detail-header">
        <div>
          <p className="ao-eyebrow">주문 상세</p>
          <h2 id="ao-detail-title">
            {order?.orderNo ||
              (order ? `주문번호 미발급 · #${order.orderId}` : '주문 조회')}
          </h2>
          {order && (
            <p className="ao-muted">
              내부 주문 ID #{order.orderId} · 사용자 ID {order.userId}
            </p>
          )}
        </div>
        <button
          className="ao-close"
          aria-label="주문 상세 닫기"
          onClick={close}
          autoFocus
        >
          ×
        </button>
      </header>
      <div className="ao-detail-body">
        {state.phase === 'loading' || state.phase === 'idle' ? (
          <p role="status">주문 상세를 불러오는 중이에요.</p>
        ) : state.phase === 'error' ? (
          <Failure error={state.error} retry={retry} />
        ) : (
          order && (
            <>
              <div className="ao-detail-status">
                <Status value={order.status} />
                {order.manualReviewRequired && (
                  <span className="ao-badge ao-attention">수동 확인 필요</span>
                )}
              </div>
              {order.manualReviewRequired && (
                <div className="ao-warning" role="status">
                  <strong>취소 후속 처리 · 수동 확인 필요</strong>
                  <p>
                    {reasonLabels[order.manualReviewReason] ??
                      '상세 사유를 확인해 주세요.'}
                  </p>
                  <code>{order.manualReviewReason || '사유 기록 없음'}</code>
                </div>
              )}
              {refundNeeded && (
                <div className="ao-warning" role="status">
                  <strong>실패 주문 · 환불 미완료 확인 필요</strong>
                  <p>
                    취소 후속 처리의 수동 확인 필터와 별도로 확인해야 하는
                    주문이에요.
                  </p>
                  <code>{order.failReason}</code>
                </div>
              )}
              <section aria-labelledby="ao-times-title">
                <h3 id="ao-times-title">주문 기록</h3>
                <dl className="ao-records">
                  {[
                    ['주문 시각', order.orderedAt],
                    ['결제 시각', order.paidAt],
                    ['완료 시각', order.completedAt],
                    ['취소 시각', order.canceledAt],
                    ['취소 요청 시각', order.cancelRequestedAt],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{date(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-labelledby="ao-items-title">
                <div className="ao-section-heading">
                  <h3 id="ao-items-title">주문 상품</h3>
                  <span className="ao-badge">{order.items.length}종</span>
                </div>
                <ul className="ao-items">
                  {order.items.map((item, index) => (
                    <li key={index}>
                      <div>
                        <strong>{item.menuName}</strong>
                        <p>
                          메뉴 ID {item.menuId} · 기본 단가{' '}
                          {money(item.unitPrice)}
                        </p>
                        {item.options.length ? (
                          <ul className="ao-options">
                            {item.options.map((option) => (
                              <li key={option.optionId}>
                                {option.optionName} (+{money(option.extraPrice)}
                                )
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>추가 옵션 없음</p>
                        )}
                      </div>
                      <div className="ao-item-amount">
                        <span>× {item.quantity}</span>
                        <strong>{money(item.lineAmount)}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="ao-follow-title">
                <h3 id="ao-follow-title">결제·취소 후속 처리</h3>
                <dl className="ao-records">
                  <div>
                    <dt>결제 ID</dt>
                    <dd>{order.paymentId ?? '기록 없음'}</dd>
                  </div>
                  <div>
                    <dt>취소 사유</dt>
                    <dd>{order.cancelReason || '기록 없음'}</dd>
                  </div>
                  <div>
                    <dt>실패 사유</dt>
                    <dd>{order.failReason || '기록 없음'}</dd>
                  </div>
                  <div>
                    <dt>환불</dt>
                    <dd>
                      {order.refundedAt
                        ? `완료 · ${date(order.refundedAt)}`
                        : refundNeeded
                          ? '환불 미완료 · 확인 필요'
                          : '완료 기록 없음 · 미완료 또는 대상 아님'}
                    </dd>
                  </div>
                  <div>
                    <dt>재고 복원</dt>
                    <dd>
                      {order.stockRestoredAt
                        ? `완료 · ${date(order.stockRestoredAt)}`
                        : '완료 기록 없음 · 미완료 또는 대상 아님'}
                    </dd>
                  </div>
                  <div>
                    <dt>후속 처리 시도</dt>
                    <dd>{order.cancelFollowUpAttempts}회</dd>
                  </div>
                  <div>
                    <dt>수동 확인</dt>
                    <dd>{order.manualReviewRequired ? '필요' : '대상 아님'}</dd>
                  </div>
                </dl>
              </section>
            </>
          )
        )}
      </div>
      <footer className="ao-detail-footer">
        {order && (
          <div className="ao-detail-total">
            <span>주문 금액</span>
            <strong>{money(order.totalAmount)}</strong>
          </div>
        )}
        <button className="ao-button ao-primary" onClick={close}>
          목록으로 돌아가기
        </button>
      </footer>
    </dialog>
  );
}
function Search({ query, onSearch }) {
  const [draft, setDraft] = useState(query);
  const [mode, setMode] = useState(
    query.orderNo && !query.from && !query.to ? 'number' : 'period',
  );
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(query);
    setMode(query.orderNo && !query.from && !query.to ? 'number' : 'period');
    setError('');
  }, [query]);
  const update = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  function submit(event) {
    event.preventDefault();
    try {
      if (mode === 'number' && !draft.orderNo.trim())
        throw new Error('전체 기간 검색에는 주문번호를 입력해 주세요.');
      const next = {
        ...draft,
        from: mode === 'number' ? '' : draft.from,
        to: mode === 'number' ? '' : draft.to,
        page: 0,
      };
      adminSearchParams(next);
      setError('');
      onSearch(next);
    } catch (failure) {
      setError(failure.message);
    }
  }
  return (
    <form
      className="ao-search"
      onSubmit={submit}
      noValidate
      aria-label="주문 검색"
    >
      <fieldset className="ao-search-mode">
        <legend className="ao-sr-only">검색 기준</legend>
        {[
          ['period', '기간 기준'],
          ['number', '주문번호 · 전체 기간'],
        ].map(([value, label]) => (
          <label key={value} className={mode === value ? 'ao-selected' : ''}>
            <input
              type="radio"
              name="search-mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                setMode(value);
                if (value === 'period' && !draft.from && !draft.to)
                  setDraft({
                    ...draft,
                    from: defaultSearch().from,
                    to: defaultSearch().to,
                  });
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="ao-search-fields">
        <label className="ao-order-search">
          주문번호
          <input
            type="search"
            value={draft.orderNo}
            placeholder="주문번호 정확히 일치"
            onChange={(e) => update('orderNo', e.target.value)}
          />
        </label>
        <label>
          시작일 (KST)
          <input
            type="date"
            value={draft.from}
            disabled={mode === 'number'}
            onChange={(e) => update('from', e.target.value)}
          />
        </label>
        <label>
          종료일 (KST)
          <input
            type="date"
            value={draft.to}
            disabled={mode === 'number'}
            onChange={(e) => update('to', e.target.value)}
          />
        </label>
        <label>
          주문 상태
          <select
            aria-label="주문 상태"
            value={draft.status}
            onChange={(e) => update('status', e.target.value)}
          >
            <option value="">전체 상태</option>
            {Object.entries(ORDER_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          표시 건수
          <select
            aria-label="표시 건수"
            value={draft.size}
            onChange={(e) => update('size', Number(e.target.value))}
          >
            {[20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}건
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ao-search-bottom">
        <div>
          <label className="ao-checkbox">
            <input
              type="checkbox"
              checked={draft.manualReviewRequired}
              onChange={(e) => update('manualReviewRequired', e.target.checked)}
            />
            취소 후속 처리 수동 확인만
          </label>
          <p className="ao-muted">
            {mode === 'number'
              ? '날짜 조건 없이 전체 기간에서 주문번호를 정확히 찾아요.'
              : '최대 31일 · 날짜를 비우면 서버의 최근 31일 기준으로 조회해요.'}
          </p>
        </div>
        <div className="ao-actions">
          <button
            className="ao-button"
            type="button"
            onClick={() => onSearch(defaultSearch())}
          >
            초기화
          </button>
          <button className="ao-button ao-primary" type="submit">
            검색
          </button>
        </div>
      </div>
      <p className="ao-search-error" role="alert">
        {error}
      </p>
    </form>
  );
}
export default function AdminOrdersPage({
  api = defaultApi,
  environmentNotice,
}) {
  const hash = useAdminRoute();
  const route = useMemo(() => parseAdminRoute(hash), [hash]);
  const fallbackQuery = useMemo(() => defaultSearch(), []);
  const query = route.query ?? fallbackQuery;
  const store = useMemo(() => createAdminOrderStore(api), [api]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const title = useRef(null);
  useEffect(() => {
    store.activate();
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    if (!route.error) store.setRoute(route.query, route.selectedId);
    else store.clear();
  }, [store, route]);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);
  const list =
    JSON.stringify(state.query) === JSON.stringify(route.query)
      ? state.list
      : { phase: 'loading' };
  function search(next) {
    if (!route.error && JSON.stringify(next) === JSON.stringify(state.query)) {
      if (list.phase !== 'loading') store.retryList();
    } else navigateAdmin(next);
  }
  function closeDetail() {
    if (window.history.state?.adminOrderDetail) window.history.back();
    else navigateAdmin(query, null, true);
  }
  const totalPages = list.data
    ? Math.ceil(list.data.totalElements / list.data.size)
    : 0;
  return (
    <div className="ao-app">
      <a
        className="ao-skip"
        href="#ao-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('ao-main')?.focus();
        }}
      >
        주문 목록으로 건너뛰기
      </a>
      <aside className="ao-sidebar" aria-label="관리자 메뉴">
        <div className="ao-brand" aria-label="Peak Order">
          P
        </div>
        <nav aria-label="매장 관리">
          <span className="ao-nav-muted">
            <Icon name="grid" />
            대시보드
          </span>
          <span className="ao-nav-muted">
            <Icon name="box" />
            재고관리
          </span>
          <span className="ao-nav-muted">
            <Icon name="menu" />
            메뉴관리
          </span>
          <a className="ao-nav-active" href="#admin-orders" aria-current="page">
            <Icon name="order" />
            주문 관리
          </a>
        </nav>
        <span className="ao-admin-label">관리자</span>
      </aside>
      <main className="ao-main" id="ao-main" tabIndex={-1}>
        <header className="ao-page-heading">
          <div>
            <p className="ao-eyebrow">STORE MANAGEMENT</p>
            <h1 tabIndex={-1} ref={title}>
              주문 관리
            </h1>
            <p className="ao-muted">
              주문을 찾고 결제·취소 처리 기록을 확인하세요.
            </p>
          </div>
          <div className="ao-heading-actions">
            <span className="ao-badge">조회 전용</span>
            <button
              className="ao-icon-button"
              aria-label="목록 새로고침"
              disabled={list.phase === 'loading'}
              onClick={() => store.retryList()}
            >
              ↻
            </button>
          </div>
        </header>
        {environmentNotice && (
          <aside className="ao-environment" role="note">
            {environmentNotice}
          </aside>
        )}
        <section className="ao-card" aria-label="주문 목록·검색">
          <Search query={query} onSearch={search} />
          <div className="ao-list-heading">
            <h2>
              전체 주문{' '}
              <strong>
                {list.data
                  ? new Intl.NumberFormat('ko-KR').format(
                      list.data.totalElements,
                    )
                  : '—'}
              </strong>
            </h2>
            <p className="ao-muted">주문 시각 최신순 · KST 기준</p>
          </div>
          {route.error ? (
            <Failure
              error={route.error}
              retry={() => navigateAdmin(defaultSearch())}
            />
          ) : list.phase === 'loading' || list.phase === 'idle' ? (
            <div className="ao-message" role="status">
              주문 목록을 불러오는 중이에요.
            </div>
          ) : list.phase === 'error' ? (
            <Failure error={list.error} retry={() => store.retryList()} />
          ) : list.data.items.length ? (
            <>
              <table className="ao-table">
                <caption className="ao-sr-only">관리자 주문 목록</caption>
                <thead>
                  <tr>
                    {[
                      '주문번호 / 상품',
                      '사용자 ID',
                      '주문 시각',
                      '주문 상태',
                      '금액',
                      '확인 사항',
                      '상세',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((order) => (
                    <tr
                      key={order.orderId}
                      data-order-id={order.orderId}
                      onClick={(event) => {
                        if (!event.target.closest('button'))
                          navigateAdmin(query, order.orderId);
                      }}
                    >
                      <td data-label="주문번호 / 상품">
                        <strong>{order.orderNo || '주문번호 미발급'}</strong>
                        <span className="ao-row-secondary">
                          내부 ID #{order.orderId} ·{' '}
                          {order.representativeMenuName || '상품명 기록 없음'}
                          {order.itemCount > 1
                            ? ` 외 ${order.itemCount - 1}종`
                            : ''}
                        </span>
                      </td>
                      <td data-label="사용자 ID">{order.userId}</td>
                      <td data-label="주문 시각">{date(order.orderedAt)}</td>
                      <td data-label="주문 상태">
                        <Status value={order.status} />
                      </td>
                      <td data-label="금액" className="ao-amount">
                        {money(order.totalAmount)}
                      </td>
                      <td data-label="확인 사항">
                        {order.manualReviewRequired ? (
                          <span className="ao-badge ao-attention">
                            수동 확인 필요
                          </span>
                        ) : (
                          <span className="ao-muted">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="ao-button ao-row-detail"
                          aria-label={`주문 ${order.orderNo || `ID ${order.orderId}`} 상세`}
                          onClick={() => navigateAdmin(query, order.orderId)}
                        >
                          주문 상세 <span aria-hidden="true">↗</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="ao-message" role="status">
              <h2>검색 결과가 없어요</h2>
              <p>기간·주문번호·상태 조건을 다시 확인해 주세요.</p>
              {query.page > 0 && (
                <button
                  className="ao-button"
                  onClick={() => navigateAdmin({ ...query, page: 0 })}
                >
                  첫 페이지로
                </button>
              )}
            </div>
          )}
          {list.phase === 'ready' && (
            <footer className="ao-pagination">
              <p>
                {list.data.totalElements
                  ? list.data.items.length
                    ? `${query.page * query.size + 1}–${query.page * query.size + list.data.items.length} / 총 ${list.data.totalElements}건`
                    : `표시할 주문 없음 / 총 ${list.data.totalElements}건`
                  : '0건'}
              </p>
              <nav aria-label="주문 목록 페이지">
                <button
                  className="ao-button"
                  disabled={query.page === 0}
                  onClick={() =>
                    navigateAdmin({ ...query, page: query.page - 1 })
                  }
                >
                  이전
                </button>
                <span aria-live="polite">
                  {query.page + 1} / {Math.max(1, totalPages)}
                </span>
                <button
                  className="ao-button"
                  disabled={query.page + 1 >= totalPages}
                  onClick={() =>
                    navigateAdmin({ ...query, page: query.page + 1 })
                  }
                >
                  다음
                </button>
              </nav>
            </footer>
          )}
        </section>
        <footer className="ao-page-footer">
          PEAK ORDER · 관리자 주문 조회
        </footer>
      </main>
      {!route.error && route.selectedId !== null && (
        <Detail
          state={
            state.selectedId === route.selectedId
              ? state.detail
              : { phase: 'loading' }
          }
          retry={() => store.retryDetail()}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
