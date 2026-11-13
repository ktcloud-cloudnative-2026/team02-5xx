-- 재고 임시 확보 정보 저장 (OR-04 확보 만료 시각 조회, 결제 후 확정·해제 호출에 필요)
ALTER TABLE orders
    ADD COLUMN hold_id         BIGINT,
    ADD COLUMN hold_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.hold_id IS 'Inventory 임시 확보 ID (FK 없음)';
COMMENT ON COLUMN orders.hold_expires_at IS '재고 임시 확보 만료 시각';
