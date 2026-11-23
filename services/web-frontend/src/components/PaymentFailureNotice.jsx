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
  const createRetryable = state.createRetryable === true && !state.order;
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
          {createRetryable
            ? '임시 주문을 준비하지 못했어요'
            : unknown
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
        {createRetryable && (
          <p>
            결제 요청 전 단계예요. 선택한 메뉴를 다시 확인하고 새 임시 주문을
            준비할 수 있어요.
            {unknown &&
              ' 이전 요청의 재고 확보가 잠시 남아 있을 수 있으니 바로 재시도하기 어렵다면 잠시 후 다시 확인해 주세요.'}
          </p>
        )}
        {unknown && !createRetryable && (
          <>
            <p>
              먼저 주문 상태를 확인해 주세요. 아직 확정되지 않은 주문의 처리를
              이어갈 수 있어요. 새 임시 주문은 만들지 않으며, 처리 재개도
              자동으로 반복하지 않습니다.
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
        {(state.stage === 'failed' || (unknown && createRetryable)) && (
          <button className="pill-button" onClick={onRestart}>
            새 임시 주문으로 다시 확인
          </button>
        )}
      </div>
    </section>
  );
}
