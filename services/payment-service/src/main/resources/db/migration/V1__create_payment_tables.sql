-- Payment 서비스 초기 테이블 (ERD 3-5)
-- payments: 주문당 결제 기록 최대 1건(order_id UNIQUE), 같은 요청 중복 결제 방지(idempotency_key UNIQUE)
CREATE TABLE payments (
    id              BIGSERIAL    PRIMARY KEY,
    order_id        BIGINT       NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    amount          INTEGER      NOT NULL,
    method          VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    mock_tx_id      VARCHAR(50),
    fail_reason     VARCHAR(100),
    requested_at    TIMESTAMPTZ  NOT NULL,
    approved_at     TIMESTAMPTZ,
    canceled_at     TIMESTAMPTZ,
    CONSTRAINT uk_payments_order_id UNIQUE (order_id),
    CONSTRAINT uk_payments_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT ck_payments_amount CHECK (amount > 0),
    CONSTRAINT ck_payments_status
        CHECK (status IN ('REQUESTED', 'APPROVED', 'FAILED', 'CANCELED', 'REFUNDED'))
);

COMMENT ON COLUMN payments.order_id IS 'Order 주문 ID (FK 없음, 주문당 결제 1건)';
COMMENT ON COLUMN payments.idempotency_key IS '중복 결제 방지 키 (Order가 보냄)';

-- payment_refunds: 환불 이력. 결제당 완료된 환불은 1건만 허용해 중복 환불을 막는다.
CREATE TABLE payment_refunds (
    id           BIGSERIAL    PRIMARY KEY,
    payment_id   BIGINT       NOT NULL REFERENCES payments (id),
    amount       INTEGER      NOT NULL,
    reason       VARCHAR(100),
    status       VARCHAR(20)  NOT NULL,
    requested_at TIMESTAMPTZ  NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT ck_payment_refunds_amount CHECK (amount > 0),
    CONSTRAINT ck_payment_refunds_status CHECK (status IN ('REQUESTED', 'COMPLETED', 'FAILED'))
);

CREATE UNIQUE INDEX uk_payment_refunds_completed
    ON payment_refunds (payment_id) WHERE status = 'COMPLETED';
