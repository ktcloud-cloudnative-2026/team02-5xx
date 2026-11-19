import { formatPrice, MAX_QUANTITY } from '../menu.js';

export default function Cart({
  rows,
  total,
  warning,
  notice,
  onQuantity,
  onRemove,
  onBack,
  onOrder,
}) {
  return (
    <section className="cart-page" aria-labelledby="cart-title">
      <header className="page-heading">
        <div>
          <h1 id="cart-title" tabIndex="-1">
            내 장바구니
          </h1>
        </div>
        <button className="close-button" onClick={onBack}>
          <span aria-hidden="true">×</span>
          <span className="sr-only">메뉴로 돌아가기</span>
        </button>
      </header>
      {notice && (
        <p className="action-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {warning && (
        <p className="cart-warning" role="status">
          {warning}
        </p>
      )}
      {rows.length ? (
        <div className="cart-layout">
          <ul className="cart-items" aria-label="장바구니 항목">
            {rows.map((row) => (
              <li key={row.key} className="cart-item">
                <span className="cart-photo" aria-hidden="true">
                  메뉴 사진
                </span>
                <div className="cart-item-info">
                  <h2>{row.name}</h2>
                  <p>{row.optionNames.join(', ') || '추가 옵션 없음'}</p>
                  <span className="cart-unit sr-only">
                    단가 {formatPrice(row.unitPrice)}
                  </span>
                  <strong className="cart-line-total">
                    {formatPrice(row.total)}
                  </strong>
                </div>
                <div className="cart-item-actions">
                  <button
                    className="text-button"
                    aria-label={`${row.name} ${row.optionNames.join(', ')} 삭제`}
                    onClick={() => onRemove(row.key)}
                  >
                    삭제
                  </button>
                  <div
                    className="quantity-control"
                    role="group"
                    aria-label={`${row.name} ${row.optionNames.join(', ')} 수량`}
                  >
                    <button
                      aria-label={`${row.name} 수량 줄이기`}
                      disabled={row.quantity <= 1}
                      onClick={() => onQuantity(row.key, row.quantity - 1)}
                    >
                      −
                    </button>
                    <output aria-label={`${row.name} 수량`}>
                      {row.quantity}
                    </output>
                    <button
                      aria-label={`${row.name} 수량 늘리기`}
                      disabled={row.quantity >= MAX_QUANTITY}
                      onClick={() => onQuantity(row.key, row.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <aside className="cart-summary" aria-label="장바구니 금액">
            <h2>주문 예정 금액</h2>
            <div className="cart-count-row">
              <span>총 수량</span>
              <span>
                {rows.reduce((count, row) => count + row.quantity, 0)}개
              </span>
            </div>
            <div className="total-row">
              <span>합계</span>
              <output aria-label="장바구니 전체 합계" aria-live="polite">
                {formatPrice(total)}
              </output>
            </div>
            <p>
              표시 금액은 예상 금액이에요.
              <br />
              주문 시 가격과 재고를 다시 확인합니다.
            </p>
            <button className="pill-button" onClick={onOrder}>
              주문하기
            </button>
          </aside>
        </div>
      ) : (
        <div className="empty-state" role="status">
          <h2>장바구니가 비어 있어요</h2>
          <p>마음에 드는 메뉴를 골라 담아 보세요.</p>
          <button className="pill-button" onClick={onBack}>
            메뉴 보러 가기
          </button>
        </div>
      )}
    </section>
  );
}
