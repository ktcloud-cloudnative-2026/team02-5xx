import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createCongestionApi, formatWait } from './congestionApi.js';
import { createCongestionStore } from './congestionStore.js';
import { createOrderApi, orderStatus } from '../orders/orderApi.js';
import { createOrderHistoryStore } from '../orders/orderHistoryStore.js';
import { ordersHref } from '../orders/ordersRoute.js';
import { customerKey } from '../checkout/checkoutFlow.js';
import { formatPrice } from '../menu.js';
import './home.css';

const publicApi = createCongestionApi();
function Congestion({ api }) {
  const store = useMemo(() => createCongestionStore({ api }), [api]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    const visibility = () =>
      store.setActive(document.visibilityState === 'visible');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      store.dispose();
    };
  }, [store]);
  return (
    <section
      className="home-card congestion-card"
      aria-labelledby="congestion-heading"
      aria-busy={state.phase === 'loading'}
    >
      <div className="home-card-heading">
        <h2 id="congestion-heading">현재 매장 혼잡도</h2>
        <button
          className="text-button"
          disabled={state.phase === 'loading'}
          onClick={store.refresh}
        >
          혼잡도 새로고침
        </button>
      </div>
      {state.phase === 'loading' && <p role="status">혼잡도 갱신 중…</p>}
      {state.phase === 'idle' && !state.data && (
        <p role="status">혼잡도 확인을 기다리고 있어요.</p>
      )}
      {state.phase === 'error' && (
        <div role="alert">
          <p>{state.error.message}</p>
          <button className="pill-button" onClick={store.refresh}>
            혼잡도 다시 시도
          </button>
        </div>
      )}
      {state.data && (
        <>
          <p className="home-congestion-level">
            {state.stale ? '마지막 확인 정보 · ' : ''}
            {state.data.level === 'NORMAL' ? '보통' : '혼잡'}
          </p>
          <dl className="home-metrics">
            <div>
              <dt>대기 주문 수</dt>
              <dd>{state.data.waitingCount}건</dd>
            </div>
            <div>
              <dt>조리 중 주문 수</dt>
              <dd>{state.data.cookingCount}건</dd>
            </div>
            <div>
              <dt>예상 조리 시작 대기시간</dt>
              <dd>약 {formatWait(state.data.expectedWaitSec)}</dd>
            </div>
          </dl>
          <p className="home-caption">
            조리 완료까지의 시간이 아닌, 지금 주문하면 조리를 시작하기까지의
            추정 시간이에요.
          </p>
          <p className="home-caption">
            {state.stale ? '최신 정보가 아니에요. ' : '마지막 갱신: '}
            <time dateTime={new Date(state.updatedAt).toISOString()}>
              {new Date(state.updatedAt).toLocaleTimeString('ko-KR')}
            </time>
          </p>
        </>
      )}
      {!state.data && state.phase === 'error' && (
        <p>현재 혼잡도를 알 수 없어요. 메뉴는 계속 둘러볼 수 있어요.</p>
      )}
    </section>
  );
}

function RecentOrder({ sessionSource }) {
  const store = useMemo(
    () =>
      createOrderHistoryStore({
        api: createOrderApi({ sessionSource }),
        sessionSource,
      }),
    [sessionSource],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.start();
    store.navigate(0, null);
    return () => store.dispose();
  }, [store]);
  const row = state.list.data?.items[0];
  return (
    <section className="home-card" aria-labelledby="recent-heading">
      <h2 id="recent-heading">최근 주문</h2>
      {['idle', 'loading'].includes(state.list.phase) && (
        <p role="status">최근 주문 불러오는 중…</p>
      )}
      {state.list.phase === 'error' && (
        <div role="alert">
          <p>{state.list.error.message}</p>
          <button className="text-button" onClick={() => store.list(0)}>
            최근 주문 다시 시도
          </button>
        </div>
      )}
      {state.list.phase === 'ready' &&
        (row ? (
          <div className="home-recent">
            <p>주문번호 {row.orderNo ?? '미발급'}</p>
            <h3>{row.representativeMenuName}</h3>
            <p>
              {orderStatus(row)} · {formatPrice(row.totalAmount)}
            </p>
            <p className="home-caption">
              {new Date(row.orderedAt).toLocaleString('ko-KR')} ·{' '}
              {row.itemCount}개 항목
            </p>
            <a
              className="pill-button home-link"
              href={ordersHref(0, row.orderId)}
            >
              최근 주문 상세 보기
            </a>
          </div>
        ) : (
          <p>아직 주문 내역이 없어요.</p>
        ))}
      <a href="#orders">전체 주문 내역 보기</a>
    </section>
  );
}

export default function CustomerHome({
  session,
  sessionSource,
  onLogin,
  onCart,
  authBusy,
  notice,
  congestionApi = publicApi,
}) {
  const owner = customerKey(session);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let previous = customerKey(sessionSource.getSnapshot());
    return sessionSource.subscribe(() => {
      const next = customerKey(sessionSource.getSnapshot());
      if (next !== previous) {
        previous = next;
        setEpoch((value) => value + 1);
      }
    });
  }, [sessionSource]);
  return (
    <main className="customer-home" aria-labelledby="home-heading">
      <header className="home-welcome">
        <p>
          반가워요,{' '}
          {session?.authenticated ? session.user?.nickname || '회원' : '손님'}
        </p>
        <h1 id="home-heading" tabIndex="-1">
          오늘은 무엇을 드시고 싶으세요?
        </h1>
        <p>주문 전에 매장 혼잡도를 확인하고 메뉴를 골라보세요.</p>
        <div className="home-actions">
          <a className="pill-button home-link" href="#menu-list">
            메뉴 둘러보기
          </a>
          <button className="text-button" onClick={onCart}>
            장바구니 보기
          </button>
        </div>
      </header>
      {notice && <p role="status">{notice}</p>}
      <div className="home-columns">
        <Congestion api={congestionApi} />
        {owner ? (
          <RecentOrder
            key={`${owner}:${epoch}`}
            sessionSource={sessionSource}
          />
        ) : (
          <section className="home-card">
            <h2>
              {session?.authenticated
                ? '고객 주문 안내'
                : '로그인하고 주문하세요'}
            </h2>
            {session?.phase === 'restoring' ? (
              <p role="status">고객 세션 확인 중…</p>
            ) : session?.authenticated ? (
              <p>
                주문·결제와 내 주문 조회는 CUSTOMER 계정만 이용할 수 있어요.
              </p>
            ) : (
              <>
                <p>
                  메뉴와 장바구니는 비회원도 이용할 수 있어요. 주문·결제에는
                  CUSTOMER 로그인이 필요해요.
                </p>
                <button
                  className="pill-button"
                  onClick={onLogin}
                  disabled={authBusy}
                >
                  고객 로그인
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
