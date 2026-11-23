export const PAYMENT_METHODS = [
  '신용·체크카드',
  '간편결제',
  '계좌이체',
  '휴대폰 결제',
];
export default function PaymentMethodSelector({ value, onChange, disabled }) {
  return (
    <fieldset className="payment-methods" disabled={disabled}>
      <legend>지불 수단</legend>
      <p className="checkout-caption" id="method-hint">
        UI 선택 체험용 · 결제수단은 서버에 전송되지 않습니다.
      </p>
      <div className="payment-method-grid">
        {PAYMENT_METHODS.map((method, i) => (
          <label className={value === method ? 'selected' : ''} key={method}>
            <input
              type="radio"
              name="payment-method"
              value={method}
              checked={value === method}
              tabIndex={value === method ? 0 : -1}
              onChange={() => onChange(method)}
              aria-describedby="method-hint"
            />
            <svg
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              {i === 0 ? (
                <>
                  <rect x="3" y="6" width="26" height="20" rx="4" />
                  <path d="M3 12h26M8 21h7" />
                </>
              ) : i === 1 ? (
                <>
                  <rect x="5" y="4" width="22" height="24" rx="6" />
                  <path d="m11 16 4 4 7-9" />
                </>
              ) : i === 2 ? (
                <>
                  <path d="m3 11 13-7 13 7ZM5 27h22M8 14v9M16 14v9M24 14v9" />
                </>
              ) : (
                <>
                  <rect x="8" y="2" width="16" height="28" rx="4" />
                  <path d="M13 25h6" />
                </>
              )}
            </svg>
            <span>{method}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
