-- 매장당 COOKING 전표는 최대 1건 (확정 업무 규칙: 조리 중인 주문이 없을 때만 다음 주문을 시작)
-- 단일 매장 기준. 자동 조리 진행 코드(행 잠금·advisory lock)와 별개로 DB가 최종 보장한다.
-- 매장이 여러 개가 되면 store_id를 포함한 제약으로 바꾼다.
CREATE UNIQUE INDEX uk_cooking_tickets_single_cooking
    ON cooking_tickets (status)
    WHERE status = 'COOKING';
