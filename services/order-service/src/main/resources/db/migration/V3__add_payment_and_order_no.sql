-- 결제 확정(OR-02) 지원
-- 1) 결제 ID 저장: 이후 환불(PI-03) 호출에 필요하다. 다른 서비스 ID이므로 FK 없음.
ALTER TABLE orders
    ADD COLUMN payment_id BIGINT;

COMMENT ON COLUMN orders.payment_id IS 'Payment 결제 ID (FK 없음)';

-- 2) 고객 표시용 주문번호 일련번호: 날짜별로 1부터 증가한다. 확정 트랜잭션과 함께 커밋·롤백된다.
CREATE TABLE order_no_counters (
    order_date DATE    PRIMARY KEY,
    last_seq   INTEGER NOT NULL,
    CONSTRAINT ck_order_no_counters_last_seq CHECK (last_seq > 0)
);
