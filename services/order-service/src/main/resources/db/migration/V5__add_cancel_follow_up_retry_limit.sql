-- 취소 후속 처리(재고 복원 II-04·환불 PI-03) 재시도 상한과 수동 확인 표시 (이슈 #125)
-- 다시 호출해도 결과가 같은 실패(환불 불가 409, 복원 불가 409, 계약과 다른 응답)나 오래 풀리지 않는 장애가
-- 스케줄러에서 30초마다 무한히 반복되지 않도록, 실패 횟수와 다음 시도 시각을 기록해 점점 늦게 재시도하고
-- 상한에 닿으면 수동 확인 필요로 표시하고 스케줄러 대상에서 뺀다.
ALTER TABLE orders
    ADD COLUMN cancel_follow_up_attempts       INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN cancel_follow_up_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN cancel_follow_up_manual_at      TIMESTAMPTZ,
    ADD COLUMN cancel_follow_up_manual_reason  VARCHAR(100);

COMMENT ON COLUMN orders.cancel_follow_up_attempts IS
    '취소 후속 처리가 실패한 횟수. 상한(기본 12회)에 닿으면 수동 확인 필요로 표시한다';
COMMENT ON COLUMN orders.cancel_follow_up_next_attempt_at IS
    '스케줄러가 다음에 후속 처리를 다시 시도할 시각(실패할수록 간격이 길어진다). NULL이면 바로 시도할 수 있다';
COMMENT ON COLUMN orders.cancel_follow_up_manual_at IS
    '사람이 확인해야 한다고 표시한 시각. 값이 있으면 스케줄러가 더 이상 자동 재시도하지 않는다';
COMMENT ON COLUMN orders.cancel_follow_up_manual_reason IS
    '수동 확인이 필요한 이유(예: REFUND_NOT_REFUNDABLE, RESTORE_NOT_APPLICABLE, RETRY_LIMIT_EXCEEDED)';

-- 수동 확인이 필요한 취소 주문만 빠르게 세고 찾는다(지표·운영 조회용).
CREATE INDEX idx_orders_cancel_follow_up_manual
    ON orders (cancel_follow_up_manual_at)
    WHERE cancel_follow_up_manual_at IS NOT NULL;
