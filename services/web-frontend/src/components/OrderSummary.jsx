import { formatPrice } from '../menu.js';

export default function OrderSummary({ input, order }) {
  const rows =
    order?.items?.map((item, i) => ({
      key: i,
      name: item.menuName,
      optionNames: item.options.map((o) => o.optionName),
      quantity: item.quantity,
      total: item.lineAmount,
    })) ?? input.rows;
  return (
    <section className="checkout-summary" aria-labelledby="summary-title">
      <h2 id="summary-title">
        <strong>주문</strong> 메뉴
      </h2>
      <ul className="checkout-items">
        {rows.map((row, index) => (
          <li key={index}>
            <span className="checkout-thumb" aria-hidden="true" />
            <div>
              <h3>{row.name}</h3>
              <p>{row.optionNames.join(' · ') || '기본 구성'}</p>
              <p>{formatPrice(row.total)}</p>
            </div>
            <strong>× {row.quantity}</strong>
          </li>
        ))}
      </ul>
      <dl className="checkout-totals">
        <div>
          <dt>총 수량</dt>
          <dd>{rows.reduce((n, row) => n + row.quantity, 0)}개</dd>
        </div>
        <div>
          <dt>{order ? 'Mock 주문 확인 금액' : '예상 주문 금액'}</dt>
          <dd>
            <strong>{formatPrice(order?.totalAmount ?? input.total)}</strong>
          </dd>
        </div>
      </dl>
      <p className="checkout-caption">
        {order
          ? '임시 주문 응답의 항목과 금액을 확인했어요.'
          : '현재 Mock 메뉴 기준입니다. 실제 금액은 Order 서버가 다시 계산합니다.'}
      </p>
    </section>
  );
}
