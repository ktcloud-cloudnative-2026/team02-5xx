import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createCookingApi } from './cookingApi.js';
import { createCookingStore } from './cookingStore.js';
import {
  cookingDisagreement,
  cookingDuration,
  cookingKst,
  cookingNumber,
} from './cookingView.js';
import './cooking.css';

function Freshness({ name, label, state, store }) {
  const region = useRef(null);
  return (
    <div className="ac-freshness" aria-live="polite" tabIndex={-1} ref={region}>
      {state.phase === 'loading' && (
        <span>{state.data ? '새로 확인 중…' : '불러오는 중…'}</span>
      )}
      {state.phase === 'paused' && (
        <span>화면 비가시성으로 갱신 일시 정지</span>
      )}
      {state.phase === 'error' && (
        <>
          <span className="ac-error">{state.error.message}</span>
          <button
            onClick={(event) => {
              const restore = document.activeElement === event.currentTarget;
              void store.refresh(name).finally(() => {
                if (
                  restore &&
                  region.current?.isConnected &&
                  document.activeElement === document.body &&
                  document.visibilityState !== 'hidden'
                )
                  region.current.focus({ preventScroll: true });
              });
            }}
            aria-label={`${label} 다시 조회`}
          >
            다시 조회
          </button>
        </>
      )}
      {state.stale && (
        <span className="ac-warning">이전 조회값 · 최신 상태 확인 필요</span>
      )}
      {state.updatedAt != null && (
        <span>마지막 조회 성공 {cookingKst(state.updatedAt)}</span>
      )}
    </div>
  );
}
function Metric({ title, value, unit = '', dark = false, children, testId }) {
  return (
    <article
      className={`ac-metric ${dark ? 'ac-metric-dark' : ''}`}
      data-testid={testId}
    >
      <h2>{title}</h2>
      <p className="ac-value">
        {value}
        <small>{unit}</small>
      </p>
      <div className="ac-metric-caption">{children}</div>
    </article>
  );
}

/** Body-only surface for the future #304 AdminLayout. No routing or auth role fabrication. */
export default function CookingPage({
  api,
  store: providedStore,
  embedded = false,
}) {
  const store = useMemo(
    () => providedStore ?? createCookingStore(api ?? createCookingApi()),
    [api, providedStore],
  );
  const resources = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const update = () => store.setActive(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      store.dispose();
    };
  }, [store]);
  const { overview, congestion, queue } = resources;
  const o = overview.data,
    c = congestion.data,
    q = queue.data;
  const loading = Object.values(resources).some(
    (resource) => resource.phase === 'loading',
  );
  const freshness = (name, label) => (
    <Freshness
      name={name}
      label={label}
      state={resources[name]}
      store={store}
    />
  );
  return (
    <section className="ac-page" aria-labelledby="ac-title">
      <header className="ac-header">
        <div>
          <p className="ac-eyebrow">PEAK ORDER / COOKING</p>
          <h1 id="ac-title">주문·조리 현황</h1>
          <p>현재 조리 중인 주문과 대기 순서를 확인하세요.</p>
        </div>
        <div className="ac-refresh-group">
          <span className="ac-readonly">조회 전용</span>
          <button
            className="ac-button"
            aria-disabled={loading}
            aria-busy={loading}
            onClick={() => {
              if (!loading) void store.refreshAll();
            }}
          >
            ↻ 전체 새로고침
          </button>
        </div>
      </header>
      <p className="ac-poll-note">
        30초마다 영역별 갱신 · 숨긴 화면에서는 일시 정지 · 실패한 영역은 다시
        조회할 때 재개
      </p>
      <section className="ac-metrics" aria-label="조리 운영 지표">
        <Metric
          title="현재 혼잡도"
          value={c ? (c.level === 'NORMAL' ? '보통' : '혼잡') : '—'}
          testId="congestion-metric"
        >
          서버 혼잡도 기준
        </Metric>
        <Metric
          title="조리 시작 예상 대기"
          value={cookingDuration(c?.expectedWaitSec)}
          testId="wait-metric"
        >
          지금 새로 주문할 때 · CO-01
        </Metric>
        <Metric
          title="대기 주문"
          value={cookingNumber(o?.waitingCount)}
          unit="건"
          testId="waiting-metric"
        >
          아직 조리를 시작하지 않은 주문
        </Metric>
        <Metric
          title="조리 중"
          value={cookingNumber(o?.cookingCount)}
          unit="건"
          dark
          testId="cooking-metric"
        >
          현재 조리 중인 주문
        </Metric>
        <Metric
          title="오늘 조리 완료"
          value={cookingNumber(o?.completedToday)}
          unit="건"
          testId="completed-metric"
        >
          KST 오늘 0시 이후 완료
        </Metric>
        <Metric
          title="오늘 조리 취소"
          value={cookingNumber(o?.canceledToday)}
          unit="건"
          testId="canceled-metric"
        >
          KST 오늘 0시 이후 취소
        </Metric>
      </section>
      <div className="ac-source-status">
        <section aria-label="혼잡도 조회 상태">
          <strong>혼잡도 · CO-01</strong>
          {freshness('congestion', '혼잡도')}
          <p>
            이 조회의 대기 {cookingNumber(c?.waitingCount)}건 · 조리 중{' '}
            {cookingNumber(c?.cookingCount)}건
          </p>
        </section>
        <section aria-label="현황 조회 상태">
          <strong>조리 현황 · CO-03</strong>
          {freshness('overview', '조리 현황')}
        </section>
      </div>
      {cookingDisagreement(resources) && (
        <div className="ac-disagreement" role="status">
          영역별 조회값이 일치하지 않아요. 조회 시점이 다를 수 있으므로 각
          영역의 마지막 조회 시각을 확인해 주세요. 한 영역의 값으로 다른 영역을
          덮어쓰지 않습니다.
        </div>
      )}
      <div className="ac-columns">
        <div className="ac-current-column">
          <section
            className="ac-card ac-current"
            aria-labelledby="ac-current-title"
          >
            <div className="ac-card-header">
              <h2 id="ac-current-title">현재 조리 중 주문</h2>
              <button
                className="ac-icon-button"
                aria-disabled={overview.phase === 'loading'}
                aria-busy={overview.phase === 'loading'}
                aria-label="조리 현황 새로고침"
                onClick={() => {
                  if (overview.phase !== 'loading')
                    void store.refresh('overview');
                }}
              >
                ↻
              </button>
            </div>
            {o ? (
              <>
                <span
                  className={`ac-badge ${o.cookingCount > 0 ? 'ac-badge-dark' : ''}`}
                >
                  {o.cookingCount > 0 ? '조리 중' : '조리 없음'}
                </span>
                <p className="ac-current-order" data-testid="current-order">
                  {o.cookingOrderNo ??
                    (o.cookingCount === 0 ? '없음' : '주문번호 미제공')}
                </p>
                <p className="ac-muted">
                  조리 중 {cookingNumber(o.cookingCount)}건
                </p>
                {o.cookingCount > 0 && (
                  <p className="ac-current-note">
                    조리 중인 주문 가운데 서버가 제공한 대표 주문번호를
                    표시해요.
                  </p>
                )}
                {o.cookingCount === 0 && o.cookingOrderNo && (
                  <p className="ac-warning">
                    서버의 조리 건수와 주문번호가 일치하지 않아요. 다시 조회해
                    주세요.
                  </p>
                )}
                <dl className="ac-overview-wait">
                  <dt>새 주문의 조리 시작 예상 대기 · CO-03</dt>
                  <dd>{cookingDuration(o.expectedWaitSec)}</dd>
                </dl>
              </>
            ) : (
              <p className="ac-empty">
                {overview.phase === 'error'
                  ? '현재 조리 주문을 확인할 수 없어요.'
                  : overview.phase === 'paused'
                    ? '조리 현황 갱신이 일시 정지됐어요.'
                    : '현재 조리 주문을 불러오는 중이에요.'}
              </p>
            )}
            {overview.stale && (
              <p className="ac-warning">이전 조회의 조리 현황입니다.</p>
            )}
          </section>
          <section
            className="ac-card ac-guide"
            aria-labelledby="ac-guide-title"
          >
            <h2 id="ac-guide-title">현황 읽는 법</h2>
            <ul>
              <li>
                <strong>예상 대기시간</strong>
                <p>지금 주문하면 조리를 시작하기까지의 예상 시간입니다.</p>
              </li>
              <li>
                <strong>예상 조리시간</strong>
                <p>대기열의 각 주문을 조리하는 데 필요한 예상 시간입니다.</p>
              </li>
              <li>
                <strong>오늘 완료·취소</strong>
                <p>Cooking 서비스가 KST 0시 이후 집계한 건수입니다.</p>
              </li>
            </ul>
            <p className="ac-guide-foot">
              현재 조리의 시작·완료 시각과 남은 시간은 제공되지 않습니다. 조리는
              서비스에서 자동으로 진행됩니다.
            </p>
          </section>
        </div>
        <section className="ac-card ac-queue" aria-labelledby="ac-queue-title">
          <div className="ac-card-header">
            <div>
              <h2 id="ac-queue-title">
                FIFO 대기 주문{' '}
                <span className="ac-count">{cookingNumber(q?.count)}</span>
              </h2>
              <p>대기 등록 순서 · 1번이 다음 조리 대상입니다.</p>
            </div>
            <button
              className="ac-icon-button"
              aria-disabled={queue.phase === 'loading'}
              aria-busy={queue.phase === 'loading'}
              aria-label="대기열 새로고침"
              onClick={() => {
                if (queue.phase !== 'loading') void store.refresh('queue');
              }}
            >
              ↻
            </button>
          </div>
          {freshness('queue', '대기열')}
          {!q && queue.phase === 'error' && (
            <p className="ac-empty">
              대기열을 확인할 수 없어요. 조회를 다시 시도해 주세요.
            </p>
          )}
          {q?.count === 0 && (
            <p className="ac-empty">대기 중인 주문이 없어요.</p>
          )}
          {q && q.count > 0 && (
            <div
              className="ac-queue-scroll"
              tabIndex={0}
              role="region"
              aria-label="FIFO 대기 주문 목록 · 스크롤 가능"
            >
              <ol className="ac-queue-list">
                {q.items.map((entry) => (
                  <li key={entry.orderId}>
                    <div className="ac-queue-order">
                      <span
                        className={`ac-position ${entry.position === 1 ? 'ac-next' : ''}`}
                      >
                        {entry.position}
                      </span>
                      <div>
                        <strong>{entry.orderNo}</strong>
                        <small>주문 ID {entry.orderId}</small>
                      </div>
                      {entry.position === 1 && (
                        <span className="ac-next-label">다음 조리</span>
                      )}
                    </div>
                    <dl className="ac-queue-detail">
                      <div>
                        <dt>대기 등록 시각</dt>
                        <dd>{cookingKst(entry.queuedAt)}</dd>
                      </div>
                      <div>
                        <dt>예상 조리시간</dt>
                        <dd>{cookingDuration(entry.estimatedCookSec)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="ac-queue-foot">
            현재 조리 중인 주문은 이 목록에 포함되지 않습니다. 서버 FIFO 순서를
            그대로 표시합니다.
          </p>
        </section>
      </div>
      {!embedded && (
        <footer className="ac-footer">
          각 영역은 독립적으로 조회됩니다. 관리자 화면 간 탐색은 #304 공통
          레이아웃에서 통합할 예정입니다.
        </footer>
      )}
    </section>
  );
}
