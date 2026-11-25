export default function PaymentFailureNotice({
  state,
  onCheck,
  onRecover,
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
              ? '로그인 상태가 변경됐어요'
              : mock
                ? 'Mock 주문을 진행하지 못했어요'
                : '주문을 진행하지 못했어요'}
        </h2>
        <p>{state.error}</p>
        {unknown && (
          <>
            <p>
              먼저 주문 상태를 확인해 주세요. 아직 확정되지 않은 주문의 처리를
              이어갈 수 있어요. 중복 결제를 막기 위해 새 주문을 만들거나 결제를
              반복하지 마세요.
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
                주문번호를 확인하지 못해 이 화면에서는 결과를 조회할 수 없어요.
              </p>
            )}
            {state.recoverable && (
              <button
                className="pill-button"
                disabled={state.checking}
                onClick={onRecover}
              >
                같은 주문 처리 이어가기
              </button>
            )}
          </>
        )}
        {state.stage === 'failed' && (
          <button className="pill-button" onClick={onRestart}>
            주문 다시 확인
          </button>
        )}
      </div>
    </section>
  );
}
