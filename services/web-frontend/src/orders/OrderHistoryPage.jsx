import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { customerKey } from '../checkout/checkoutFlow.js';
import { formatPrice } from '../menu.js';
import LoginModal from '../components/LoginModal.jsx';
import useDialog from '../useDialog.js';
import { createOrderApi, canCancel, orderStatus } from './orderApi.js';
import { createOrderHistoryStore } from './orderHistoryStore.js';
import { ordersHref } from './ordersRoute.js';
import './orders.css';

const date = (value) =>
  value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '미제공';
const duration = (n) => (n === 0 ? '곧' : `약 ${Math.ceil(n / 60)}분 후`);
function Failure({ error, retry }) {
  return (
    <div className="orders-message" role="alert">
      <p>{error.message}</p>
      {error.status !== 401 && (
        <button className="pill-button" onClick={retry}>
          다시 조회
        </button>
      )}
    </div>
  );
}
function CancelConfirmation({ onClose, onConfirm }) {
  const { close, ...dialog } = useDialog(onClose);
  return (
    <dialog
      {...dialog}
      className="order-confirm"
      aria-labelledby="order-confirm-title"
    >
      <h2 id="order-confirm-title">주문을 취소할까요?</h2>
      <p>조리가 시작된 주문은 취소가 어려울 수 있어요.</p>
      <div className="order-actions">
        <button className="text-button" onClick={close}>
          돌아가기
        </button>
        <button className="pill-button" onClick={onConfirm}>
          취소 요청 확인
        </button>
      </div>
    </dialog>
  );
}
function Detail({ state, store, onClose }) {
  const { close, ...dialog } = useDialog(onClose);
  const [confirm, setConfirm] = useState(false);
  const order = state.detail.data;
  useEffect(() => {
    if (
      state.detail.phase !== 'ready' ||
      !order ||
      state.pending ||
      state.review ||
      confirm ||
      ['CANCELED', 'FAILED', 'COMPLETED'].includes(order.status)
    )
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void store.detail();
    }, 10000);
    return () => clearInterval(timer);
  }, [state.detail.phase, order, state.pending, state.review, confirm, store]);
  const cooking = order?.cooking;
  const step =
    order?.status === 'COMPLETED'
      ? 3
      : cooking?.lookup === 'OK'
        ? { WAITING: 0, COOKING: 1, DONE: 2 }[cooking.status]
        : undefined;
  return (
    <>
      <dialog
        {...dialog}
        className="order-detail-modal"
        aria-labelledby="order-detail-title"
      >
        <div className="order-detail-heading">
          <div>
            <p className="order-caption">주문번호</p>
            <h2 id="order-detail-title">{order?.orderNo ?? '주문 상세'}</h2>
          </div>
          <button
            className="close-button"
            onClick={close}
            aria-label="주문 상세 닫기"
          >
            ×
          </button>
        </div>
        {state.detail.phase === 'loading' && (
          <p role="status">주문 상세 확인 중…</p>
        )}
        {state.detail.phase === 'error' && (
          <Failure
            error={state.detail.error}
            retry={() => store.detail({ review: true })}
          />
        )}
        {order && (
          <>
            <div className="order-status-line">
              <span className="order-badge">{orderStatus(order)}</span>
              <button
                className="text-button"
                disabled={state.pending || state.detail.phase === 'loading'}
                onClick={() => store.detail({ review: true })}
              >
                최신 상태 확인
              </button>
            </div>
            {cooking?.lookup === 'OK' &&
              cooking.status !== 'CANCELED' &&
              !['CANCELED', 'FAILED', 'COMPLETED'].includes(order.status) && (
                <div className="order-estimates">
                  <div>
                    <span>조리 시작까지</span>
                    <strong>
                      {['COOKING', 'DONE'].includes(cooking.status)
                        ? '시작됨'
                        : duration(cooking.expectedWaitSec)}
                    </strong>
                  </div>
                  <div>
                    <span>조리 완료까지</span>
                    <strong>
                      {cooking.status === 'DONE'
                        ? '조리 완료'
                        : duration(cooking.expectedReadySec)}
                    </strong>
                  </div>
                  <p>조회 시점 기준 예상이며 실제 시간은 달라질 수 있어요.</p>
                  {cooking.startedAt && (
                    <p>조리 시작 {date(cooking.startedAt)}</p>
                  )}
                </div>
              )}
            {step !== undefined &&
              !['CANCELED', 'FAILED'].includes(order.status) && (
                <ol className="order-progress" aria-label="주문 진행 상태">
                  {['조리 대기', '조리 중', '픽업 대기', '완료'].map(
                    (label, i) => (
                      <li
                        key={label}
                        aria-current={i === step ? 'step' : undefined}
                      >
                        <span>{i + 1}</span>
                        {label}
                      </li>
                    ),
                  )}
                </ol>
              )}
            {cooking?.lookup === 'PENDING' && (
              <p className="orders-message">
                조리 접수를 기다리고 있어요. 주문 확정과 조리 접수는 별도로
                처리됩니다.
              </p>
            )}
            {cooking?.lookup === 'UNAVAILABLE' && (
              <p className="orders-message">
                조리 상태를 지금 확인할 수 없어요. 예상 시간을 임의로 표시하지
                않습니다.
              </p>
            )}
            {order.status === 'CANCELED' && (
              <p className="orders-message">
                주문 취소를 확인했어요. 환불과 재고 복원 완료를 의미하지는
                않습니다.
              </p>
            )}
            <section
              className="order-lines"
              aria-labelledby="order-lines-title"
            >
              <h3 id="order-lines-title">주문 내역</h3>
              {order.items.map((row, i) => (
                <div className="order-line" key={i}>
                  <div>
                    <strong>
                      {row.menuName} × {row.quantity}
                    </strong>
                    <p>기본가 {formatPrice(row.unitPrice)}</p>
                    {row.options.map((o) => (
                      <p key={o.optionId}>
                        {o.optionName} +{formatPrice(o.extraPrice)}
                      </p>
                    ))}
                  </div>
                  <strong>{formatPrice(row.lineAmount)}</strong>
                </div>
              ))}
              <div className="order-line">
                <strong>총 금액</strong>
                <strong>{formatPrice(order.totalAmount)}</strong>
              </div>
            </section>
            <dl className="order-dates">
              {[
                ['주문 일시', order.orderedAt],
                ['결제 일시', order.paidAt],
                ['취소 일시', order.canceledAt],
                ['완료 일시', order.completedAt],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{date(value)}</dd>
                </div>
              ))}
            </dl>
            {state.notice && (
              <p className="orders-message" role="status">
                {state.notice}
              </p>
            )}
            {state.pending && (
              <p role="status">
                취소 요청 중… 화면을 닫아도 처리는 계속될 수 있어요.
              </p>
            )}
            <div className="order-actions">
              {state.review ? (
                <button
                  className="pill-button"
                  disabled={state.pending || state.detail.phase === 'loading'}
                  onClick={() => store.detail({ review: true })}
                >
                  취소 결과 다시 확인
                </button>
              ) : (
                <button
                  className="pill-button"
                  disabled={
                    state.pending ||
                    state.detail.phase !== 'ready' ||
                    !canCancel(order)
                  }
                  onClick={() => setConfirm(true)}
                >
                  {state.pending ? '취소 요청 중…' : '주문 취소'}
                </button>
              )}
            </div>
            <p className="order-caption">
              취소는 결제 전 또는 조리 시작 전 확인된 주문에 요청할 수 있어요.
              조리가 시작되면 취소가 어려울 수 있어요.
            </p>
          </>
        )}
      </dialog>
      {confirm && (
        <CancelConfirmation
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void store.cancel();
          }}
        />
      )}
    </>
  );
}
function CustomerOrders({
  route,
  sessionSource,
  onLogout,
  authBusy,
  accountActions,
}) {
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
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    store.navigate(route.page, route.id);
  }, [store, route.page, route.id]);
  const previousId = useRef(route.id);
  useEffect(() => {
    const closedId = previousId.current;
    previousId.current = route.id;
    if (closedId && !route.id) {
      const frame = requestAnimationFrame(() => {
        const target =
          document.querySelector(`[data-order-link="${closedId}"]`) ??
          document.getElementById('orders-heading');
        target?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [route.id]);
  const list = state.page === route.page ? state.list.data : undefined;
  const detailState =
    state.id === route.id
      ? state
      : {
          ...state,
          detail: { phase: 'loading' },
          pending: false,
          review: false,
          notice: '',
        };
  const closeDetail = () => {
    if (window.history.state?.peakOrderDetail) window.history.back();
    else {
      window.history.replaceState(null, '', ordersHref(route.page));
      window.dispatchEvent(new Event('peak-order-route'));
    }
  };
  return (
    <>
      <header className="orders-heading">
        <h1 id="orders-heading" tabIndex="-1">
          <strong>주문</strong> 내역
        </h1>
        <div className="order-actions">
          <a href="#menu-list">메뉴로 돌아가기</a>
          {accountActions && (
            <button
              className="text-button"
              disabled={authBusy}
              onClick={onLogout}
            >
              로그아웃
            </button>
          )}
        </div>
      </header>
      <p className="order-caption">내 주문을 최신순으로 확인할 수 있어요.</p>
      {state.list.phase === 'loading' && (
        <p className="orders-message" role="status">
          주문 목록 불러오는 중…
        </p>
      )}
      {state.list.phase === 'error' && (
        <Failure
          error={state.list.error}
          retry={() => store.list(route.page)}
        />
      )}
      {list && (
        <>
          {!list.items.length && (
            <div className="orders-message">
              <h2>
                {list.totalElements
                  ? '이 페이지에 주문이 없어요'
                  : '아직 주문 내역이 없어요'}
              </h2>
              <p>결제 전·실패한 주문은 목록에 표시되지 않아요.</p>
              <a href={ordersHref()}>첫 페이지로</a>
            </div>
          )}
          <ul className="order-cards">
            {list.items.map((row) => (
              <li className="order-card" key={row.orderId}>
                <div>
                  <h2>주문번호 {row.orderNo ?? '미발급'}</h2>
                  <p>
                    {row.representativeMenuName}
                    {row.itemCount > 1 ? ` 외 ${row.itemCount - 1}개 항목` : ''}
                  </p>
                  <p className="order-caption">{date(row.orderedAt)}</p>
                  <p className="order-caption">총 {row.itemCount}개 항목</p>
                </div>
                <strong>{formatPrice(row.totalAmount)}</strong>
                <span className="order-badge">{orderStatus(row)}</span>
                <a
                  className="order-detail-link"
                  data-order-link={row.orderId}
                  href={ordersHref(route.page, row.orderId)}
                  onClick={(event) => {
                    event.preventDefault();
                    window.history.pushState(
                      { peakOrderDetail: true },
                      '',
                      ordersHref(route.page, row.orderId),
                    );
                    window.dispatchEvent(new Event('peak-order-route'));
                  }}
                >
                  상세 보기 ›
                </a>
              </li>
            ))}
          </ul>
          <nav className="order-pagination" aria-label="주문 목록 페이지">
            <button
              className="text-button"
              disabled={!route.page}
              onClick={() => {
                window.location.hash = ordersHref(route.page - 1);
              }}
            >
              이전 페이지
            </button>
            <span>
              {route.page + 1} /{' '}
              {Math.max(1, Math.ceil(list.totalElements / list.size))}
            </span>
            <button
              className="text-button"
              disabled={(route.page + 1) * list.size >= list.totalElements}
              onClick={() => {
                window.location.hash = ordersHref(route.page + 1);
              }}
            >
              다음 페이지
            </button>
          </nav>
        </>
      )}
      {route.id && (
        <Detail
          key={route.id}
          state={detailState}
          store={store}
          onClose={closeDetail}
        />
      )}
    </>
  );
}
export default function OrderHistoryPage({
  accountActions = true,
  route,
  sessionSource,
  onLogout,
  authBusy,
}) {
  const session = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    sessionSource.getServerSnapshot ?? sessionSource.getSnapshot,
  );
  const [login, setLogin] = useState(false),
    [epoch, setEpoch] = useState(0);
  const owner = customerKey(session);
  useEffect(() => {
    let previous = customerKey(sessionSource.getSnapshot());
    return sessionSource.subscribe(() => {
      const next = customerKey(sessionSource.getSnapshot());
      if (previous !== next) {
        setEpoch((n) => n + 1);
        previous = next;
      }
    });
  }, [sessionSource]);
  return (
    <main className="orders-page" id="orders-page">
      {route.invalid ? (
        <div className="orders-message" role="alert">
          <h1>주문 주소를 확인해 주세요</h1>
          <a href={ordersHref()}>주문 내역으로</a>
        </div>
      ) : owner ? (
        <CustomerOrders
          key={`${owner}:${epoch}`}
          route={route}
          sessionSource={sessionSource}
          onLogout={onLogout}
          authBusy={authBusy}
          accountActions={accountActions}
        />
      ) : (
        <div className="orders-message">
          <h1>주문 내역</h1>
          {session?.phase === 'restoring' ? (
            <p role="status">로그인 정보를 확인하고 있어요…</p>
          ) : session?.authenticated ? (
            <p role="alert">주문 내역은 고객용 계정으로 확인해 주세요.</p>
          ) : (
            <>
              <p>본인의 주문을 확인하려면 로그인해 주세요.</p>
              <button className="pill-button" onClick={() => setLogin(true)}>
                로그인
              </button>
            </>
          )}
          <a href="#menu-list">메뉴로 돌아가기</a>
        </div>
      )}
      {login && !session?.authenticated && (
        <LoginModal
          onClose={() => setLogin(false)}
          onLogin={sessionSource.login}
          waiting={session?.phase === 'restoring'}
        />
      )}
    </main>
  );
}
