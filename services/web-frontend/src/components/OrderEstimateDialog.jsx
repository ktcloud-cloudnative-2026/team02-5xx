import useDialog from '../useDialog.js';
import { formatPrice } from '../menu.js';

export function durationLabel(seconds) {
  if (seconds === 0) return '바로 시작';
  return seconds < 60 ? `${seconds}초` : `약 ${Math.ceil(seconds / 60)}분`;
}
export function EstimateDetails({ state, onRetry, mock = true }) {
  return (
    <div
      className="estimate-details"
      aria-live="polite"
      aria-busy={state.estimatePhase === 'loading'}
    >
      {state.estimatePhase === 'loading' || state.estimatePhase === 'idle' ? (
        <p role="status">예상시간을 확인하고 있어요…</p>
      ) : state.estimatePhase === 'error' ? (
        <div role="alert">
          <p>{state.error}</p>
          <button className="pill-button" onClick={onRetry}>
            예상시간 다시 조회
          </button>
        </div>
      ) : (
        state.estimate && (
          <dl>
            <div className="estimate-primary">
              <dt>조리 시작까지 대기</dt>
              <dd>{durationLabel(state.estimate.expectedWaitSec)}</dd>
            </div>
            <div>
              <dt>선택 메뉴 조리시간</dt>
              <dd>{durationLabel(state.estimate.cookSec)}</dd>
            </div>
            <div>
              <dt>조리 완료까지</dt>
              <dd>{durationLabel(state.estimate.expectedReadySec)}</dd>
            </div>
          </dl>
        )
      )}
      <p className="checkout-caption">
        {mock ? 'Mock 예상시간이며 ' : '예상시간 조회는 '}주문 접수·재고
        확보·조리 예약을 의미하지 않습니다.
      </p>
    </div>
  );
}
export default function OrderEstimateDialog({
  mock = true,
  state,
  input,
  onRetry,
  onContinue,
  onClose,
}) {
  const { close, ...dialog } = useDialog(onClose);
  return (
    <dialog
      {...dialog}
      className="estimate-modal"
      aria-labelledby="estimate-title"
    >
      <header>
        <h2 id="estimate-title">바로 주문할까요?</h2>
        <button
          className="close-button"
          aria-label="예상시간 닫기"
          onClick={close}
          autoFocus
        >
          ×
        </button>
      </header>
      <p className="checkout-eyebrow">
        {mock ? 'MOCK 주문 미리보기' : '주문 전 예상시간'}
      </p>
      <EstimateDetails state={state} onRetry={onRetry} mock={mock} />
      <div className="estimate-selection">
        <strong>주문할 메뉴</strong>
        {input.rows.map((row, i) => (
          <p key={i}>
            <span>
              {row.name} ({row.optionNames.join(' · ') || '기본'}) ×{' '}
              {row.quantity}
            </span>
            <span>{formatPrice(row.total)}</span>
          </p>
        ))}
      </div>
      <footer>
        <button
          className="pill-button"
          disabled={state.estimatePhase !== 'ready'}
          onClick={onContinue}
        >
          주문 확인으로 이동 →
        </button>
      </footer>
    </dialog>
  );
}
