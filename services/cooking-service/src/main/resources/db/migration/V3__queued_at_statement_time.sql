-- 조리 전표 등록 시각(queued_at)을 "INSERT 문이 실행된 시각"으로 기록한다 (PR #109 리뷰).
-- now()·current_timestamp·localtimestamp는 트랜잭션 시작 시각이라, 먼저 시작했지만 늦게 INSERT한 전표가 더 이른 시각을 받아
-- FIFO(queued_at, id)가 실제 등록 순서와 뒤집힐 수 있다. clock_timestamp()는 문장 실행 시점의 실제 시각이다.
-- 애플리케이션은 이 컬럼에 값을 넣지 않고 DB 기본값을 읽어 온다(CookingTicket.queuedAt).
ALTER TABLE cooking_tickets
    ALTER COLUMN queued_at SET DEFAULT clock_timestamp();
