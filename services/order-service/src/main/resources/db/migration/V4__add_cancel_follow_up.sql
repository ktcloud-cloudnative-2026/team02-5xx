-- 주문 취소(OR-05) 후속 처리 기록
-- 확정된 주문을 취소하면 주문은 먼저 CANCELED로 바꾸고, 재고 복원(Inventory II-04)과 환불(Payment PI-03)은 그 뒤에 한다.
-- 두 단계 중 하나가 실패해도 주문은 CANCELED로 두고, 끝나지 않은 단계를 아래 컬럼으로 구분해 재시도한다.
ALTER TABLE orders
    ADD COLUMN stock_restored_at TIMESTAMPTZ,
    ADD COLUMN refunded_at       TIMESTAMPTZ;

COMMENT ON COLUMN orders.stock_restored_at IS
    '취소로 재고 복원(Inventory II-04)을 끝낸 시각. 확정(order_no 있음)된 주문을 취소했는데 NULL이면 복원이 아직 안 끝난 것이다';
COMMENT ON COLUMN orders.refunded_at IS
    '취소로 환불(Payment PI-03)을 끝낸 시각. 결제(payment_id 있음)된 주문을 취소했는데 NULL이면 환불이 아직 안 끝난 것이다';

-- 후속 처리가 남은 취소 주문만 빠르게 찾는다(재시도용).
CREATE INDEX idx_orders_cancel_follow_up
    ON orders (canceled_at)
    WHERE status = 'CANCELED'
      AND order_no IS NOT NULL
      AND (stock_restored_at IS NULL OR refunded_at IS NULL);
