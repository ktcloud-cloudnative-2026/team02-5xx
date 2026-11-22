-- 관리자 주문 목록·검색(OR-08)은 기간(주문 시각)으로 거른 뒤 최신순으로 정렬한다 (이슈 #168).
-- 기존 idx_orders_user_id_ordered_at은 사용자 조건이 없는 이 조회에 쓸 수 없어 주문 시각 단독 인덱스를 추가한다.
-- 인덱스만 추가하므로 기존 데이터 내용과 스키마 호환성에는 영향이 없다.
-- 다만 일반 CREATE INDEX는 생성이 끝날 때까지 orders 테이블의 쓰기(주문 생성·상태 변경)를 대기시킬 수 있다.
-- 주문 데이터가 쌓인 환경(특히 prod)에 적용하기 전에 건수와 적용 시점(저트래픽 시간)을 DB 담당과 확인한다.
-- CONCURRENTLY는 Flyway 트랜잭션 처리(트랜잭션 밖 실행)를 따로 검토해야 해서 이 마이그레이션에서는 쓰지 않았다.
CREATE INDEX idx_orders_ordered_at ON orders (ordered_at DESC, id DESC);
