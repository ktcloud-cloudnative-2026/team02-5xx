import { formatPrice } from '../menu.js';

export default function OrderSummary({ input, order, mock = true }) {
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
          <dt>
            {order
              ? mock
                ? 'Mock 주문 확인 금액'
                : '결제 금액'
              : '예상 주문 금액'}
          </dt>
          <dd>
            <strong>{formatPrice(order?.totalAmount ?? input.total)}</strong>
          </dd>
        </div>
      </dl>
      <p className="checkout-caption">
        {order
          ? '결제할 메뉴와 금액을 확인해 주세요.'
          : mock
            ? '미리보기 메뉴 기준의 예상 금액입니다.'
            : '예상 금액이며 결제 전에 최종 금액을 확인할 수 있어요.'}
      </p>
    </section>
  );
}
