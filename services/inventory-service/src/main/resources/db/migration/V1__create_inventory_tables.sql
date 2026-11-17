-- Inventory Service 재고 테이블
-- 기준: Notion ERD 초안 3-7. 재고 (inventory_svc)
-- 다른 서비스의 ID(menu_id, order_id)는 FK 없이 값만 저장한다.

CREATE TABLE inventories (
    id                  BIGSERIAL PRIMARY KEY,
    menu_id             BIGINT UNIQUE,                       -- NULL 허용, 관리자가 메뉴와 연결
    stock_qty           INTEGER     NOT NULL DEFAULT 0,      -- 실제 재고
    reserved_qty        INTEGER     NOT NULL DEFAULT 0,      -- 임시 확보 수량 합
    low_stock_threshold INTEGER     NOT NULL DEFAULT 0,      -- 재고 부족 기준
    version             BIGINT      NOT NULL DEFAULT 0,      -- 동시 수정 방지 번호
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_inventories_stock_qty_not_negative     CHECK (stock_qty >= 0),
    CONSTRAINT chk_inventories_reserved_qty_not_negative  CHECK (reserved_qty >= 0),
    CONSTRAINT chk_inventories_reserved_qty_le_stock_qty  CHECK (reserved_qty <= stock_qty),
    CONSTRAINT chk_inventories_low_stock_threshold        CHECK (low_stock_threshold >= 0)
);

CREATE TABLE inventory_reservations (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT      NOT NULL UNIQUE,                 -- 임시 주문 ID, 주문당 1건
    status      VARCHAR(20) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,                        -- 생성 시각 + STOCK_HOLD_TTL
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- RESTORED: 확정 후 주문 취소로 재고를 되돌린 상태 (II-04, 중복 복원 방지)
    CONSTRAINT chk_inventory_reservations_status
        CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'RESTORED'))
);

-- 만료 스케줄러가 "RESERVED 이면서 만료 시각이 지난 건"을 찾을 때 사용
CREATE INDEX idx_inventory_reservations_status_expires_at
    ON inventory_reservations (status, expires_at);

CREATE TABLE inventory_reservation_items (
    id              BIGSERIAL PRIMARY KEY,
    reservation_id  BIGINT  NOT NULL REFERENCES inventory_reservations (id),
    menu_id         BIGINT  NOT NULL,                        -- 메뉴 ID (FK 없음)
    quantity        INTEGER NOT NULL,
    CONSTRAINT chk_inventory_reservation_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT uk_inventory_reservation_items_reservation_menu UNIQUE (reservation_id, menu_id)
);

CREATE TABLE inventory_histories (
    id            BIGSERIAL PRIMARY KEY,
    inventory_id  BIGINT      NOT NULL REFERENCES inventories (id),
    order_id      BIGINT,                                    -- 입고·조정이면 NULL
    type          VARCHAR(20) NOT NULL,
    quantity      INTEGER     NOT NULL,                      -- 변동 수량
    before_qty    INTEGER     NOT NULL,
    after_qty     INTEGER     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_inventory_histories_type
        CHECK (type IN ('RESERVE', 'CONFIRM', 'RELEASE', 'RESTORE', 'RESTOCK', 'ADJUST'))
);

CREATE INDEX idx_inventory_histories_inventory_id_created_at
    ON inventory_histories (inventory_id, created_at);
