export default function PaymentFailureNotice({
  state,
  onCheck,
  onRestart,
  mock = true,
}) {
  if (!['failed', 'unknown', 'session-ended'].includes(state.stage))
    return null;
  const unknown = state.stage === 'unknown';
  return (
    <section
      className={`payment-notice ${unknown ? 'uncertain' : ''}`}
      role="alert"
      aria-labelledby="payment-notice-title"
    >
      <span className="notice-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <h2 id="payment-notice-title" tabIndex="-1">
          {unknown
            ? '결제·주문 결과 확인이 필요해요'
            : state.stage === 'session-ended'
              ? '고객 세션이 변경됐어요'
              : mock
                ? 'Mock 주문을 진행하지 못했어요'
                : '주문을 진행하지 못했어요'}
        </h2>
        <p>{state.error}</p>
        {state.errorCode && (
          <p className="checkout-caption">안내 코드: {state.errorCode}</p>
        )}
        {unknown && (
          <>
            <p>
              이 화면에서 새 주문이나 재결제는 실행하지 않습니다. 조회
              실패·CREATED 상태만으로 미결제를 단정할 수 없어요.
            </p>
            {state.order ? (
              <button
                className="pill-button"
                disabled={state.checking}
                onClick={onCheck}
              >
                {state.checking
                  ? '결과 확인 중…'
                  : mock
                    ? 'Mock 주문 상태 확인'
                    : '주문 상태 확인'}
              </button>
            ) : (
              <p>
                임시 주문 식별자를 받지 못해 이 화면에서는 결과를 조회할 수
                없어요.
              </p>
            )}
          </>
        )}
        {state.stage === 'failed' && (
          <button className="pill-button" onClick={onRestart}>
            새 임시 주문으로 다시 확인
          </button>
        )}
      </div>
    </section>
  );
}
