-- 결제 확정(OR-02) 지원
-- 1) 결제 ID 저장: 이후 환불(PI-03) 호출에 필요하다. 다른 서비스 ID이므로 FK 없음.
ALTER TABLE orders
    ADD COLUMN payment_id           BIGINT,
    ADD COLUMN payment_requested_at TIMESTAMPTZ,
    ADD COLUMN pay_lock_until       TIMESTAMPTZ;

COMMENT ON COLUMN orders.payment_id IS 'Payment 결제 ID (FK 없음)';
COMMENT ON COLUMN orders.payment_requested_at IS
    '결제를 처음 요청한 시각. 값이 있으면 결제가 이미 됐을 수 있으므로 재고 확보가 만료돼도 결과를 확인하기 전에는 주문을 종료하지 않는다';
COMMENT ON COLUMN orders.pay_lock_until IS
    '결제 처리 독점 만료 시각. 같은 주문을 동시에 결제 처리하지 않도록 한 요청만 잡는다. 처리 중 서버가 죽어도 이 시각이 지나면 다른 요청이 이어받는다';

-- 2) 고객 표시용 주문번호 일련번호: 날짜별로 1부터 증가한다. 확정 트랜잭션과 함께 커밋·롤백된다.
CREATE TABLE order_no_counters (
    order_date DATE    PRIMARY KEY,
    last_seq   INTEGER NOT NULL,
    CONSTRAINT ck_order_no_counters_last_seq CHECK (last_seq > 0)
);
