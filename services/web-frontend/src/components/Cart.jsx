import { formatPrice, MAX_QUANTITY } from '../menu.js';
import MenuPhoto from './MenuPhoto.jsx';

export default function Cart({
  rows,
  total,
  warning,
  feedback,
  onQuantity,
  onRemove,
  onBack,
  backLabel = '메뉴로 돌아가기',
  onOrder,
  pending = false,
  failure = '',
  onRetry,
  onMenu,
  stockStates,
  stockBlocked = false,
  stockLoading = false,
  stockError,
  onStockRetry,
  stockChecking = false,
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
          <span className="sr-only">{backLabel}</span>
        </button>
      </header>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {!pending && !failure
          ? `장바구니 상품 ${rows.reduce((count, row) => count + row.quantity, 0)}개`
          : ''}
      </p>
      {feedback && (
        <p className="cart-feedback" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
      {warning && (
        <p className="cart-warning" role="status">
          {warning}
        </p>
      )}
      {stockStates && !pending && !failure && rows.length > 0 && (
        <div className="stock-notice" role="status">
          <p>
            {stockChecking
              ? '주문 전 최신 재고 확인 중…'
              : stockLoading
                ? '재고 확인 중'
                : stockError
                  ? '재고 확인 불가. 품절 여부를 확인하지 못했어요.'
                  : stockBlocked
                    ? '품절·재고 부족·판매 중지 항목을 확인해 주세요.'
                    : '주문 가능한 재고를 확인했어요.'}
          </p>
          <button
            className="text-button"
            disabled={stockLoading || stockChecking}
            onClick={onStockRetry}
          >
            재고 다시 확인
          </button>
        </div>
      )}
      {pending || failure ? (
        <div className="empty-state" role={failure ? 'alert' : 'status'}>
          <h2>
            {failure ? '장바구니를 확인하지 못했어요' : '장바구니 메뉴 확인 중'}
          </h2>
          <p>{failure || '최신 메뉴와 옵션 가격을 확인하고 있어요.'}</p>
          {failure && (
            <button className="pill-button" onClick={onRetry}>
              다시 확인
            </button>
          )}
        </div>
      ) : rows.length ? (
        <div className="cart-layout">
          <ul className="cart-items" aria-label="장바구니 항목">
            {rows.map((row) => (
              <li key={row.key} className="cart-item">
                <button
                  className="cart-photo"
                  onClick={(event) => onMenu?.(row.menuId, event)}
                  aria-label={`${row.name} 상세 보기`}
                  data-cart-menu-id={row.menuId}
                >
                  <MenuPhoto name={row.name} imageUrl={row.imageUrl} />
                </button>
                <div className="cart-item-info">
                  <h2>
                    <button
                      className="cart-menu-name"
                      onClick={(event) => onMenu?.(row.menuId, event)}
                    >
                      {row.name}
                    </button>
                  </h2>
                  {stockStates?.get(row.menuId)?.label && (
                    <p className="stock-warning">
                      {stockStates.get(row.menuId).label}
                    </p>
                  )}
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
              재고는 예약되지 않으며 주문 서버의 최종 확보 결과에 따라 달라질 수
              있어요.
              <br />
            </p>
            <button
              className="pill-button"
              onClick={onOrder}
              disabled={stockBlocked || stockChecking}
            >
              {stockChecking ? '재고 확인 중…' : '주문하기'}
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
