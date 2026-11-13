-- Order 서비스 초기 스키마 (ERD 초안 3-4, 3-8 기준)
-- 다른 서비스의 데이터는 FK 없이 ID만 저장한다.

CREATE TABLE orders (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no          VARCHAR(30) UNIQUE,
    user_id           BIGINT       NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    total_amount      INTEGER      NOT NULL,
    expected_wait_sec INTEGER,
    cancel_reason     VARCHAR(255),
    fail_reason       VARCHAR(255),
    ordered_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    paid_at           TIMESTAMPTZ,
    canceled_at       TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_orders_status CHECK (
        status IN ('CREATED', 'PAID', 'WAITING', 'COOKING', 'COMPLETED', 'CANCELED', 'FAILED')),
    CONSTRAINT ck_orders_total_amount CHECK (total_amount >= 0)
);

COMMENT ON COLUMN orders.order_no IS '고객 표시용 주문번호. 결제·재고 확정 후 발급, 임시 주문(CREATED)은 NULL';

CREATE INDEX idx_orders_user_id_ordered_at ON orders (user_id, ordered_at DESC);
CREATE INDEX idx_orders_status ON orders (status);

CREATE TABLE order_items (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT       NOT NULL REFERENCES orders (id),
    menu_id     BIGINT       NOT NULL,
    menu_name   VARCHAR(100) NOT NULL,
    unit_price  INTEGER      NOT NULL,
    quantity    INTEGER      NOT NULL,
    line_amount INTEGER      NOT NULL,
    CONSTRAINT ck_order_items_unit_price CHECK (unit_price >= 0),
    CONSTRAINT ck_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT ck_order_items_line_amount CHECK (line_amount >= 0)
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);

CREATE TABLE order_item_options (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_item_id BIGINT       NOT NULL REFERENCES order_items (id),
    option_id     BIGINT       NOT NULL,
    option_name   VARCHAR(100) NOT NULL,
    extra_price   INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT ck_order_item_options_extra_price CHECK (extra_price >= 0)
);

CREATE INDEX idx_order_item_options_order_item_id ON order_item_options (order_item_id);

CREATE TABLE order_status_histories (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT      NOT NULL REFERENCES orders (id),
    from_status VARCHAR(20),
    to_status   VARCHAR(20) NOT NULL,
    reason      VARCHAR(255),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_status_histories_order_id ON order_status_histories (order_id);

-- 단일 매장: 행은 항상 1건(id = 1)
CREATE TABLE store_operations (
    id               BIGINT      PRIMARY KEY DEFAULT 1,
    is_open          BOOLEAN     NOT NULL,
    accepting_orders BOOLEAN     NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_store_operations_single_row CHECK (id = 1)
);

-- 초기값은 영업 종료·주문 미접수. 관리자가 OR-07로 변경한다.
INSERT INTO store_operations (id, is_open, accepting_orders) VALUES (1, FALSE, FALSE);

CREATE TABLE outbox_events (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id   UUID        NOT NULL UNIQUE,
    event_type VARCHAR(50) NOT NULL,
    payload    JSONB       NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at    TIMESTAMPTZ,
    CONSTRAINT ck_outbox_events_status CHECK (status IN ('PENDING', 'SENT'))
);

CREATE INDEX idx_outbox_events_pending ON outbox_events (created_at) WHERE status = 'PENDING';

CREATE TABLE processed_events (
    event_id     UUID        PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
