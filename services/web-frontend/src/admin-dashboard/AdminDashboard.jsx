import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createDashboardApi } from './dashboardApi.js';
import { createDashboardStore } from './dashboardStore.js';
import './dashboard.css';

const time = (value) =>
  value == null
    ? '—'
    : new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(value));
const number = (value) => (value == null ? '—' : value.toLocaleString('ko-KR'));
const duration = (seconds) =>
  seconds == null
    ? '—'
    : seconds === 0
      ? '0초'
      : `${Math.floor(seconds / 60) ? `${Math.floor(seconds / 60)}분 ` : ''}${seconds % 60 ? `${seconds % 60}초` : ''}`.trim();

function ResourceStatus({ label, resource, retry }) {
  return (
    <div className="ad-resource" aria-live="polite">
      {resource.phase === 'loading' && (
        <span>{resource.data ? '새로 확인 중…' : '불러오는 중…'}</span>
      )}
      {resource.phase === 'paused' && (
        <span>화면이 숨겨져 갱신을 쉬고 있어요.</span>
      )}
      {resource.phase === 'error' && (
        <>
          <span className="ad-error">{resource.error.message}</span>
          <button
            className="ad-text-button"
            onClick={retry}
            aria-label={`${label} 다시 조회`}
          >
            다시 조회
          </button>
        </>
      )}
      {resource.stale && (
        <span className="ad-warning">이전 조회값 · 최신 상태 확인 필요</span>
      )}
      {resource.updatedAt != null && (
        <span className="ad-muted">
          조회 완료 {time(resource.updatedAt)} KST
        </span>
      )}
    </div>
  );
}

function Kpi({ title, value, unit = '건', children, dark = false, testId }) {
  return (
    <article
      className={`ad-kpi ${dark ? 'ad-kpi-dark' : ''}`}
      data-testid={testId}
    >
      <h2>{title}</h2>
      <div className="ad-kpi-value">
        {value}
        <small>{unit}</small>
      </div>
      {children}
    </article>
  );
}

/** Independent administrator surface. Caller supplies the authenticated same-origin HTTP adapter. */
export default function AdminDashboard({
  api,
  store: suppliedStore,
  navigation = {},
  environmentNotice,
}) {
  const store = useMemo(
    () => suppliedStore ?? createDashboardStore(api ?? createDashboardApi()),
    [api, suppliedStore],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { resources: r, write } = state;
  useEffect(() => {
    store.start({ visible: document.visibilityState !== 'hidden' });
    const visibility = () =>
      store.setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      store.dispose();
    };
  }, [store]);
  const operations = r.operations.data;
  const overview = r.overview.data;
  const congestion = r.congestion.data;
  const stock = r.stock.data;
  const pending = write.phase === 'pending';
  const focusReturn = useRef(null);
  useEffect(() => {
    if (pending) return;
    const button = focusReturn.current;
    focusReturn.current = null;
    if (
      button?.isConnected &&
      !button.disabled &&
      document.activeElement === document.body &&
      document.visibilityState !== 'hidden'
    )
      button.focus({ preventScroll: true });
  }, [write.phase, pending]);
  const uncertain = write.phase === 'uncertain';
  const locked =
    pending || uncertain || r.operations.phase !== 'ready' || !state.visible;
  const busy = Object.values(r).some(
    (resource) => resource.phase === 'loading',
  );
  const status = (key, label) => (
    <ResourceStatus
      label={label}
      resource={r[key]}
      retry={() =>
        void (key === 'operations' && uncertain
          ? store.review()
          : store.refresh(key))
      }
    />
  );
  const menuNames = new Map(
    (r.menus.data ?? []).map((menu) => [menu.id, menu.name]),
  );

  return (
    <div className="ad-shell">
      <aside className="ad-sidebar" aria-label="관리자 탐색">
        <a
          className="ad-brand"
          href="#dashboard"
          aria-label="Peak Order 대시보드"
        >
          PEAK
          <br />
          ORDER<span>ADMIN</span>
        </a>
        <nav>
          <a className="ad-nav-active" href="#dashboard" aria-current="page">
            <span aria-hidden="true">▦</span>대시보드
          </a>
          {navigation.menu ? (
            <a href={navigation.menu.href}>
              <span aria-hidden="true">☷</span>
              {navigation.menu.label ?? '메뉴 관리'}
            </a>
          ) : (
            <span className="ad-nav-pending">
              메뉴 관리<small>연결 환경 필요</small>
            </span>
          )}
          <span className="ad-nav-pending">
            주문 관리<small>연동 준비 중</small>
          </span>
          <span className="ad-nav-pending">
            재고 관리<small>연동 준비 중</small>
          </span>
          <span className="ad-nav-pending">
            조리 현황<small>연동 준비 중</small>
          </span>
        </nav>
        <span className="ad-sidebar-foot">관리자 전용</span>
      </aside>
      <main id="dashboard" className="ad-main">
        {environmentNotice && (
          <div className="ad-environment" role="note">
            {environmentNotice}
          </div>
        )}
        <header className="ad-header">
          <div>
            <p className="ad-eyebrow">PEAK ORDER / OVERVIEW</p>
            <h1>대시보드</h1>
            <p className="ad-subtitle">매장과 주문 현황을 한눈에 확인하세요.</p>
          </div>
          <section className="ad-operations" aria-label="매장 운영 상태">
            <div className="ad-switches">
              {[
                ['isOpen', '영업', '영업 중', '영업 종료'],
                ['acceptingOrders', '주문 접수', '접수 중', '접수 중단'],
              ].map(([field, label, on, off]) => (
                <div className="ad-switch-row" key={field}>
                  <span>
                    {label}
                    <strong>
                      {operations
                        ? operations[field]
                          ? on
                          : off
                        : '확인 필요'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={`${label} 상태 변경`}
                    aria-checked={operations?.[field] ?? false}
                    disabled={locked}
                    className="ad-switch"
                    onClick={(event) => {
                      focusReturn.current =
                        document.activeElement === event.currentTarget
                          ? event.currentTarget
                          : null;
                      void store
                        .change(field, !operations[field])
                        .catch(() => {});
                    }}
                  >
                    <span />
                  </button>
                </div>
              ))}
            </div>
            {operations && (
              <p className="ad-operation-note">
                {r.operations.stale && '이전 조회 기준 · '}
                {operations.isOpen && operations.acceptingOrders
                  ? '신규 주문을 받을 수 있어요.'
                  : !operations.isOpen
                    ? '영업 종료 상태에서는 신규 주문을 받지 않아요.'
                    : '영업 중이며 신규 주문 접수는 중단되어 있어요.'}
                <br />
                <span>서버 변경 시각 {time(operations.updatedAt)} KST</span>
              </p>
            )}
            {status('operations', '운영 상태')}
            <div aria-live="polite">
              {pending && (
                <p className="ad-feedback">
                  변경 결과를 확인하고 있어요. 잠시 기다려 주세요.
                </p>
              )}
              {write.phase === 'success' && (
                <p className="ad-feedback">서버의 운영 상태를 반영했어요.</p>
              )}
              {write.phase === 'error' && (
                <p className="ad-error">
                  {write.error.message} 입력한 변경은 자동 재전송하지 않아요.
                </p>
              )}
              {uncertain && (
                <div className="ad-uncertain" role="alert">
                  <p>
                    변경 결과를 확인할 수 없어요. 이전 표시를 실제 상태로
                    판단하지 마세요. 다시 변경하기 전에 서버 상태를 조회해
                    주세요.
                  </p>
                  <button
                    onClick={() => void store.review()}
                    disabled={r.operations.phase === 'loading'}
                  >
                    현재 서버 상태 확인
                  </button>
                </div>
              )}
              {write.phase === 'reviewed' && (
                <p className="ad-feedback">
                  서버 상태를 다시 확인했어요. 필요한 변경은 직접 선택해 주세요.
                </p>
              )}
            </div>
          </section>
        </header>
        <div className="ad-toolbar">
          <p>
            <span className="ad-live-dot" />
            30초마다 영역별 갱신 · 숨긴 화면에서는 일시 정지
            <span className="ad-poll-note">
              실패한 영역은 다시 조회할 때 재개됩니다.
            </span>
          </p>
          <button
            className="ad-button ad-button-light"
            onClick={() => void store.refreshAll()}
            disabled={busy}
          >
            ↻ 전체 새로고침
          </button>
        </div>
        <section className="ad-kpis" aria-label="운영 지표">
          <Kpi
            title="대기 주문"
            value={number(overview?.waitingCount)}
            dark
            testId="waiting-kpi"
          >
            <p>조리 시작을 기다리는 주문</p>
          </Kpi>
          <Kpi
            title="조리 중"
            value={number(overview?.cookingCount)}
            testId="cooking-kpi"
          >
            <p>
              {overview?.cookingOrderNo
                ? `현재 주문 ${overview.cookingOrderNo}`
                : '현재 주문번호 정보 없음'}
            </p>
          </Kpi>
          <Kpi
            title="오늘 조리 완료"
            value={number(overview?.completedToday)}
            testId="completed-kpi"
          >
            <p>KST 기준 · 취소 {number(overview?.canceledToday)}건</p>
          </Kpi>
          <Kpi
            title="현재 혼잡도"
            value={
              congestion
                ? congestion.level === 'NORMAL'
                  ? '보통'
                  : '혼잡'
                : '—'
            }
            unit=""
            testId="congestion-kpi"
          >
            <p>조리 시작까지 약 {duration(congestion?.expectedWaitSec)}</p>
            <small>
              대기 {number(congestion?.waitingCount)} · 조리{' '}
              {number(congestion?.cookingCount)}
            </small>
          </Kpi>
          <Kpi
            title="재고 알림"
            value={number(stock?.length)}
            unit="항목"
            testId="stock-kpi"
          >
            <p>
              품절{' '}
              {stock
                ? stock.filter((item) => item.availableQty === 0).length
                : '—'}{' '}
              · 부족{' '}
              {stock
                ? stock.filter((item) => item.availableQty > 0).length
                : '—'}
            </p>
          </Kpi>
        </section>
        <div className="ad-metric-status">
          <section aria-label="조리 지표 조회 상태">
            <strong>조리 현황</strong>
            {status('overview', '조리 현황')}
            <small>
              조리 시작 예상 대기 {duration(overview?.expectedWaitSec)} ·
              혼잡도와 조회 시점이 다를 수 있어요.
            </small>
          </section>
          <section aria-label="혼잡도 조회 상태">
            <strong>혼잡도</strong>
            {status('congestion', '혼잡도')}
          </section>
        </div>
        <div className="ad-content-grid">
          <section className="ad-card ad-queue" aria-labelledby="queue-title">
            <div className="ad-card-heading">
              <div>
                <h2 id="queue-title">
                  FIFO 대기열{' '}
                  <span className="ad-count">
                    {number(r.queue.data?.count)}
                  </span>
                </h2>
                <p>서버가 정한 조리 대기 순서입니다.</p>
              </div>
              <button
                className="ad-refresh"
                aria-label="대기열 새로고침"
                disabled={r.queue.phase === 'loading'}
                onClick={() => void store.refresh('queue')}
              >
                ↻
              </button>
            </div>
            {status('queue', '대기열')}
            {r.queue.data?.count === 0 && (
              <p className="ad-empty">현재 대기 중인 주문이 없어요.</p>
            )}
            {r.queue.data?.count > 0 && (
              <div
                className="ad-table-wrap"
                role="region"
                aria-label="대기열 표 · 가로 스크롤"
                tabIndex={0}
              >
                <table>
                  <caption className="ad-sr-only">FIFO 조리 대기열</caption>
                  <thead>
                    <tr>
                      <th>순서</th>
                      <th>주문번호</th>
                      <th>대기 등록 · KST</th>
                      <th>예상 조리시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.queue.data.items.map((item) => (
                      <tr key={item.orderId}>
                        <td>
                          <span className="ad-position">{item.position}</span>
                        </td>
                        <td>
                          <strong>{item.orderNo}</strong>
                          <small>주문 ID {item.orderId}</small>
                        </td>
                        <td>{time(item.queuedAt)}</td>
                        <td>{duration(item.estimatedCookSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="ad-card ad-stock" aria-labelledby="stock-title">
            <div className="ad-card-heading">
              <div>
                <h2 id="stock-title">재고 부족 · 품절</h2>
                <p>부족 기준에 도달한 재고 알림</p>
              </div>
              <button
                className="ad-refresh"
                aria-label="재고 새로고침"
                disabled={r.stock.phase === 'loading'}
                onClick={() => void store.refresh('stock')}
              >
                ↻
              </button>
            </div>
            {status('stock', '재고')}
            {r.menus.phase === 'error' && (
              <div className="ad-catalog-error">
                <span>
                  메뉴 이름 조회 불가 · 재고 수량은 별도로 확인됩니다.
                  {r.menus.stale && ' 메뉴 이름은 이전 조회값입니다.'}
                </span>
                <button
                  className="ad-text-button"
                  onClick={() => void store.refresh('menus')}
                >
                  메뉴 이름 다시 조회
                </button>
              </div>
            )}
            {stock?.length === 0 && (
              <p className="ad-empty">재고 부족·품절 알림이 없어요.</p>
            )}
            {stock && (
              <ul className="ad-stock-list">
                {stock.map((item) => (
                  <li key={item.stockItemId}>
                    <div className="ad-stock-title">
                      <h3>
                        {item.menuId == null
                          ? '메뉴 미연결 재고'
                          : (menuNames.get(item.menuId) ??
                            `메뉴 ID ${item.menuId}`)}
                      </h3>
                      <span
                        className={`ad-badge ${item.availableQty === 0 ? 'ad-badge-out' : ''}`}
                      >
                        {item.availableQty === 0 ? '품절' : '재고 부족'}
                      </span>
                    </div>
                    <p className="ad-muted">
                      재고 ID {item.stockItemId} ·{' '}
                      {item.menuId == null
                        ? '연결된 메뉴 없음'
                        : `메뉴 ID ${item.menuId}${!menuNames.has(item.menuId) ? (r.menus.phase === 'loading' ? ' · 이름 조회 중' : ' · 이름 조회 불가') : ''}`}
                    </p>
                    <dl className="ad-quantities">
                      <div>
                        <dt>실제</dt>
                        <dd>{number(item.stockQty)}</dd>
                      </div>
                      <div>
                        <dt>예약</dt>
                        <dd>{number(item.reservedQty)}</dd>
                      </div>
                      <div>
                        <dt>가용</dt>
                        <dd>{number(item.availableQty)}</dd>
                      </div>
                      <div>
                        <dt>부족 기준</dt>
                        <dd>{number(item.lowStockThreshold)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section className="ad-related" aria-label="관련 관리자 화면">
          <h2>관리자 바로가기</h2>
          <div>
            {navigation.menu ? (
              <a href={navigation.menu.href}>
                {navigation.menu.label ?? '메뉴 관리'} <span>↗</span>
              </a>
            ) : (
              <span>
                메뉴 관리 <small>연결 환경 필요</small>
              </span>
            )}
            <span>
              주문 관리 <small>연동 준비 중</small>
            </span>
            <span>
              재고 관리 <small>연동 준비 중</small>
            </span>
            <span>
              조리 현황 <small>연동 준비 중</small>
            </span>
          </div>
          <p>
            현재 대시보드는 조회와 영업·접수 상태 변경만 제공합니다. 조리
            조작·재고 수정 기능은 포함하지 않습니다.
          </p>
        </section>
        <footer className="ad-footer">
          PEAK ORDER ADMIN · 모든 시각은 KST · 각 영역은 독립적으로 조회됩니다.
        </footer>
      </main>
    </div>
  );
}
