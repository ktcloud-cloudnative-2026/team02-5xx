import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import useDialog from '../useDialog.js';
import { formatPrice } from '../menu.js';
import OrderSummary from './OrderSummary.jsx';
import PaymentMethodSelector, {
  PAYMENT_METHODS,
} from './PaymentMethodSelector.jsx';
import OrderEstimateDialog, {
  EstimateDetails,
} from './OrderEstimateDialog.jsx';
import PaymentFailureNotice from './PaymentFailureNotice.jsx';
import '../checkout/checkout.css';
import { cancelTopDialog } from '../dialogFocus.js';

export default function CheckoutPage({ flow, source, onClose }) {
  const mock = flow.mode === 'mock';
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getSnapshot,
    flow.getSnapshot,
  );
  const [showEstimate, setShowEstimate] = useState(false);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mountVersion = useRef(0);
  const needsExitWarning = ['creating', 'ready', 'paying', 'unknown'].includes(
    state.stage,
  );
  const requestClose = () => (needsExitWarning ? setLeaving(true) : onClose());
  const { close: _close, ...dialog } = useDialog(requestClose);
  useEffect(() => {
    setShowEstimate(source === 'immediate');
  }, [source]);
  useEffect(() => {
    const version = ++mountVersion.current;
    void flow.estimate();
    // StrictMode effect replay must not permanently dispose an event-created flow.
    return () =>
      queueMicrotask(() => {
        if (version === mountVersion.current) flow.dispose();
      });
  }, [flow]);
  useEffect(() => {
    if (state.stage !== 'ready') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.stage]);
  useEffect(() => {
    if (!['paid', 'failed', 'unknown', 'session-ended'].includes(state.stage))
      return;
    const heading = dialog.ref.current?.querySelector(
      '.payment-success h2, #payment-notice-title',
    );
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'center' });
  }, [state.stage]);
  const remaining = state.order?.holdExpiresAt
    ? Math.max(
        0,
        Math.ceil((Date.parse(state.order.holdExpiresAt) - now) / 1000),
      )
    : 0;
  const pending = ['creating', 'paying'].includes(state.stage);
  return (
    <>
      <dialog
        {...dialog}
        onCancel={(event) => cancelTopDialog(event, requestClose)}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
        className="checkout-page"
        aria-labelledby="checkout-title"
      >
        <div className="checkout-brand" aria-hidden="true">
          PEAK
          <br />
          ORDER<span>주문 확인</span>
        </div>
        <div className="checkout-main">
          <header className="checkout-header">
            <button
              className="checkout-back"
              aria-label="주문 확인에서 뒤로가기"
              onClick={requestClose}
              autoFocus
            >
              ‹
            </button>
            <h1 id="checkout-title">
              <strong>주문 확인</strong> · 결제
            </h1>
          </header>
          <ol className="checkout-steps" aria-label="주문 단계">
            <li>{source === 'cart' ? '장바구니' : '메뉴 선택'}</li>
            <li aria-current={state.stage !== 'paid' ? 'step' : undefined}>
              2　주문 확인 · 결제
            </li>
            <li aria-current={state.stage === 'paid' ? 'step' : undefined}>
              3　결제 완료
            </li>
          </ol>
          <p className="mock-banner">
            {mock ? (
              <>
                <strong>MOCK UI 체험</strong> 실제 주문·결제·재고 확보·조리
                등록은 수행하지 않습니다.
              </>
            ) : (
              <>
                <strong>주문 확인</strong> 금액·판매 상태·재고는 임시 주문
                단계에서 서버가 다시 확인합니다. 결제는 모의 결제입니다.
              </>
            )}
          </p>
          <PaymentFailureNotice
            mock={mock}
            state={state}
            onCheck={flow.check}
            onRecover={flow.recover}
            onRestart={() => {
              flow.restart();
              void flow.estimate();
            }}
          />
          {state.stage === 'paid' ? (
            <section className="checkout-card payment-success" role="status">
              <span aria-hidden="true">✓</span>
              <p className="checkout-eyebrow">
                {mock ? 'MOCK 결제 완료' : '모의 결제 확정'}
              </p>
              <h2 tabIndex="-1">
                {mock ? '주문 흐름을 확인했어요' : '주문이 확정됐어요'}
              </h2>
              <p>{mock ? '테스트 전용 주문번호' : '주문번호'}</p>
              <strong className="mock-order-number">
                {state.order.orderNo}
              </strong>
              <p>
                {mock
                  ? '실제 주문번호가 아닙니다. 실제 재고 차감·조리 등록은 이루어지지 않았어요.'
                  : 'Order 서버에서 확인한 결제 확정 결과입니다.'}
              </p>
              <p>조리 전표 등록은 결제 확정 이후 비동기로 진행됩니다.</p>
              <button className="pill-button" onClick={onClose}>
                메뉴로 돌아가기
              </button>
              {state.completionWarning && (
                <p role="alert">{state.completionWarning}</p>
              )}
            </section>
          ) : (
            <>
              <section className="checkout-card">
                <PaymentMethodSelector
                  value={method}
                  onChange={setMethod}
                  disabled={state.stage !== 'review' && state.stage !== 'ready'}
                />
              </section>
              <section className="checkout-card">
                <h2>예상 대기 · 조리시간</h2>
                <EstimateDetails
                  state={state}
                  onRetry={flow.estimate}
                  mock={mock}
                />
              </section>
              <section
                className="checkout-card checkout-progress"
                aria-live="polite"
                aria-busy={pending}
              >
                <h2>주문 진행</h2>
                <p>
                  {{
                    review:
                      '먼저 임시 주문을 만들고 검증된 금액을 확인해 주세요.',
                    creating: '메뉴 검증·임시 주문 생성을 확인하고 있어요…',
                    ready:
                      '임시 주문 준비 완료. 아래 금액을 확인한 후 모의 결제를 진행해 주세요.',
                    paying:
                      '모의 결제 결과를 기다리고 있어요. 중복 제출하지 마세요.',
                  }[state.stage] ?? '상단 안내를 확인해 주세요.'}
                </p>
                {state.stage === 'ready' && (
                  <p
                    className="hold-time"
                    role="timer"
                    aria-label={
                      mock ? 'Mock 임시 확보 남은 시간' : '임시 확보 남은 시간'
                    }
                  >
                    {mock ? 'Mock 임시 확보 남은 시간' : '임시 확보 남은 시간'}{' '}
                    <strong>
                      {Math.floor(remaining / 60)}:
                      {String(remaining % 60).padStart(2, '0')}
                    </strong>
                    {remaining === 0 && ' · 만료됨'}
                  </p>
                )}
                {state.stage === 'ready' &&
                  state.order.totalAmount !== flow.input.total && (
                    <p role="status">
                      메뉴 가격이 변경되어 서버 확인 금액이 예상 금액과 달라요.
                      결제 전 주문 금액을 다시 확인해 주세요.
                    </p>
                  )}
                <p className="checkout-caption">
                  화면 이동은 주문 취소나 재고 해제를 뜻하지 않아요. 실제 처리와
                  최종 금액은 서버에서 확인해야 합니다.
                </p>
              </section>
            </>
          )}
          {leaving && (
            <section className="checkout-card exit-confirmation" role="alert">
              <h2>선택 화면으로 돌아갈까요?</h2>
              <p>
                화면을 닫아도 처리 중인 주문의 취소·환불은 보장되지 않아요.
                결과가 불명확하면 다시 결제하지 마세요. 장바구니와 선택은 그대로
                유지됩니다.
              </p>
              <button className="pill-button" onClick={() => setLeaving(false)}>
                이 화면에서 계속 확인
              </button>
              <button className="text-button" onClick={onClose}>
                안내 확인 후 나가기
              </button>
            </section>
          )}
        </div>
        <aside className="checkout-side">
          <OrderSummary input={flow.input} order={state.order} mock={mock} />
          {['review', 'creating', 'ready', 'paying'].includes(state.stage) && (
            <button
              className="pill-button checkout-submit"
              disabled={
                pending ||
                (state.stage === 'review' && state.estimatePhase !== 'ready') ||
                (state.stage === 'ready' && remaining === 0)
              }
              onClick={state.stage === 'ready' ? flow.pay : flow.create}
            >
              {state.stage === 'creating'
                ? '임시 주문 생성 중…'
                : state.stage === 'paying'
                  ? '모의 결제 진행 중…'
                  : state.stage === 'ready'
                    ? `${formatPrice(state.order.totalAmount)} 모의 결제`
                    : mock
                      ? 'Mock 임시 주문 만들기'
                      : '임시 주문 만들기'}
            </button>
          )}
          {state.stage === 'ready' && remaining === 0 && (
            <button className="text-button" onClick={flow.pay}>
              만료 상태 확인
            </button>
          )}
        </aside>
      </dialog>
      {showEstimate && state.stage === 'review' && (
        <OrderEstimateDialog
          mock={mock}
          state={state}
          input={flow.input}
          onRetry={flow.estimate}
          onContinue={() => setShowEstimate(false)}
          onClose={onClose}
        />
      )}
    </>
  );
}
